"use client";

// 칸반 상태. 카드와 표시 여부는 IndexedDB(BoardRepository)에, 게시 중과 실패 안내는 이 hook의 메모리에 둔다.
// 게시 완료 열은 블로그 저장소에 그 글이 있는지로 정한다(제품 명세 §5.1 R8). 열 때마다 GitHub에서 다시 읽는다.
import type { BoardColumn } from "@kanban-press/domain";
import type { NotionOutlineNode } from "@kanban-press/notion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type BoardRecord, BoardRepository } from "../lib/board/repository";
import { TaskLimiter } from "../lib/board/task-limiter";
import {
  ApiError,
  fetchBlogPosts,
  fetchOutline,
  type PageSummary,
  publishErrorMessage,
} from "../lib/client/api";
import { publishAndWatch, unpublishInOrder } from "../lib/client/publish";
import { filterRenderableOutline } from "../lib/notion/outline";
import { pageIdSuffix } from "../lib/publish/blog-files";

import type { KanbanRecord } from "./kanban-board";
import type { PageList } from "./use-workspace";

type LoadState = "error" | "loading" | "ready";

/** 화면 메모리에만 있는 게시 진행 상태. */
export type PublishView =
  | { actionsUrl: string | null; column: "publishing"; publishedUrl: null; startedAt: number }
  | { actionsUrl: string | null; column: "published"; publishedUrl: string; startedAt: null };

export interface PublishFailure {
  actionsUrl: string | null;
  message: string;
  retryAt: number | null;
}

// 화면에 보이는 미확인 page의 구조 판별은 동시에 3개까지만 Notion에 요청한다.
const INSPECTION_CONCURRENCY = 3;
// 429에 Retry-After가 없을 때 줄 서 있는 구조 확인을 늦추는 시간.
const DEFAULT_RATE_LIMIT_WAIT_MS = 20_000;

export function pageKey(record: { connectionId: string; providerPageId: string }): string {
  return `${record.connectionId}:${record.providerPageId}`;
}

/** 최상위 page만 기본으로 칸반에 보인다. 하위 page와 database 행은 사용자가 골라야 한다. */
export function isVisibleByDefault(page: Pick<PageSummary, "parentContainerId" | "parentPageId">): boolean {
  return page.parentPageId === null && page.parentContainerId === null;
}

/**
 * 칸반에 그릴 카드. 문서 역할이고 보이도록 선택됐거나, 숨겨졌어도 이번 화면에서 게시 중·완료인 카드다.
 * 이번 화면의 게시 상태 → 블로그에 있으면 게시 완료 → 아니면 보관 중 순서로 열을 정한다.
 */
export function toKanbanRecords(
  records: readonly BoardRecord[],
  views: Readonly<Record<string, PublishView>>,
  failures: Readonly<Record<string, PublishFailure>>,
  blogPosts: ReadonlyMap<string, string> = new Map(),
): KanbanRecord[] {
  return records.flatMap((record) => {
    const view = views[pageKey(record)];
    if (record.pageRole !== "document" || (!record.isVisible && view === undefined)) {
      return [];
    }
    const blogUrl = blogPosts.get(suffixOf(record.providerPageId)) ?? null;
    return [
      {
        ...record,
        column: view?.column ?? (blogUrl === null ? "stored" : "published"),
        publishActionsUrl: view?.actionsUrl ?? failures[pageKey(record)]?.actionsUrl ?? null,
        publishedUrl: view?.publishedUrl ?? blogUrl,
        publishStartedAt: view?.startedAt ?? null,
      },
    ];
  });
}

function suffixOf(providerPageId: string): string {
  try {
    return pageIdSuffix(providerPageId);
  } catch {
    return "";
  }
}

export function useBoard(ownerId: string | null, githubLogin: string, pageList: PageList) {
  const [records, setRecords] = useState<readonly BoardRecord[]>([]);
  const [boardState, setBoardState] = useState<LoadState>("loading");
  const [views, setViews] = useState<Readonly<Record<string, PublishView>>>({});
  const [failures, setFailures] = useState<Readonly<Record<string, PublishFailure>>>({});
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set());
  const [blogPosts, setBlogPosts] = useState<ReadonlyMap<string, string>>(new Map());
  const repositoryRef = useRef<BoardRepository | null>(null);
  const limiter = useRef(new TaskLimiter(INSPECTION_CONCURRENCY));
  const inspections = useRef(new Map<string, Promise<NotionOutlineNode[]>>());
  const publishing = useRef(new Set<string>());
  // 게시 진행 중에 사용자가 ✕로 뺀 카드. 배포가 끝나도 다시 보이게 하지 않는다.
  const removedKeys = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // GitHub 사용자가 바뀌면 그 사용자의 DB를 열고 이전 사용자의 화면 상태를 모두 버린다.
  useEffect(() => {
    setViews({});
    setFailures({});
    removedKeys.current.clear();
    if (ownerId === null) {
      setRecords([]);
      return;
    }
    const repository = new BoardRepository(ownerId);
    repositoryRef.current = repository;
    let active = true;
    setBoardState("loading");
    void repository
      .list()
      .then((listed) => {
        if (active) {
          setRecords(listed);
          setBoardState("ready");
        }
      })
      .catch(() => {
        if (active) {
          setRecords([]);
          setBoardState("error");
        }
      });
    return () => {
      active = false;
      if (repositoryRef.current === repository) {
        repositoryRef.current = null;
      }
      repository.close();
    };
  }, [ownerId]);

  // 블로그에 올라가 있는 글. 읽지 못하면(저장소 없음·권한 없음 등) 게시 완료 열을 비워 둔다.
  useEffect(() => {
    setBlogPosts(new Map());
    if (ownerId === null) {
      return;
    }
    const controller = new AbortController();
    fetchBlogPosts(controller.signal)
      .then((posts) => setBlogPosts(posts))
      .catch(() => undefined);
    return () => controller.abort();
  }, [ownerId]);

  // 선택한 연결의 page 목록이 오면 칸반 record를 맞춘다.
  useEffect(() => {
    const repository = repositoryRef.current;
    const { connectionId, pages, state } = pageList;
    if (repository === null || boardState !== "ready" || state !== "ready" || connectionId === null) {
      return;
    }
    let active = true;
    void repository
      .syncDrafts(
        pages.map((page) => ({
          connectionId,
          isVisibleByDefault: isVisibleByDefault(page),
          providerPageId: page.providerPageId,
          sourceLastEditedAt: page.lastEditedAt,
          title: page.title,
        })),
      )
      .then((synced) => active && setRecords(synced))
      .catch(() => active && setBoardState("error"));
    return () => {
      active = false;
    };
  }, [boardState, pageList]);

  const requireRepository = (): BoardRepository => {
    const repository = repositoryRef.current;
    if (repository === null) {
      throw new Error("board_repository_unavailable");
    }
    return repository;
  };

  const clearView = (key: string) => setViews((current) => without(current, key));
  const clearFailure = (key: string) => setFailures((current) => without(current, key));

  /** 문서 트리의 표시하기·숨기기. */
  async function toggleVisibility(connectionId: string, page: PageSummary): Promise<void> {
    const key = pageKey({ connectionId, providerPageId: page.providerPageId });
    const record = records.find((item) => pageKey(item) === key);
    const repository = repositoryRef.current;
    if (record === undefined || repository === null) {
      return;
    }
    setPendingKeys((current) => new Set(current).add(key));
    try {
      if (record.isVisible) {
        removedKeys.current.add(key);
      } else {
        removedKeys.current.delete(key);
      }
      setRecords(await repository.setVisibility(connectionId, page.providerPageId, !record.isVisible));
      setBoardState("ready");
    } catch {
      setBoardState("error");
    } finally {
      setPendingKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  /**
   * page 아래에 탐색할 구조가 있는지 Notion outline으로 판별해 저장하고 outline을 돌려준다.
   * 같은 page를 동시에 판별하면 진행 중인 요청을 함께 쓴다.
   */
  const inspectStructure = useCallback(
    (connectionId: string, page: PageSummary): Promise<NotionOutlineNode[]> => {
      const repository = repositoryRef.current;
      if (repository === null) {
        return Promise.reject(new Error("structure_inspection_unavailable"));
      }
      const key = pageKey({ connectionId, providerPageId: page.providerPageId });
      const pending = inspections.current.get(key);
      if (pending !== undefined) {
        return pending;
      }
      const inspection = limiter.current
        .run(async () => {
          let fetched: NotionOutlineNode[];
          try {
            fetched = await fetchOutline(connectionId, page.providerPageId);
          } catch (error) {
            // 실패한 이 요청은 사용자가 "구조 다시 확인"으로 다시 보낸다(§6.1). 줄 서 있는 나머지만 늦춘다.
            if (error instanceof ApiError && error.code === "notion_rate_limited") {
              limiter.current.pauseUntil(error.retryAt ?? Date.now() + DEFAULT_RATE_LIMIT_WAIT_MS);
            }
            throw error;
          }
          const outline = filterRenderableOutline(fetched, pageList.pages);
          const hasDiscoveredChildren =
            page.hasChildren || pageList.pages.some((candidate) => candidate.parentPageId === page.providerPageId);
          setRecords(
            await repository.setStructureInspection(
              connectionId,
              page.providerPageId,
              page.lastEditedAt,
              outline.length > 0 || hasDiscoveredChildren,
              isVisibleByDefault(page),
            ),
          );
          return outline;
        })
        .finally(() => inspections.current.delete(key));
      inspections.current.set(key, inspection);
      return inspection;
    },
    [pageList.pages],
  );

  /** 보관 중 안에서 순서 바꾸기. 게시 완료 카드는 블로그에서 내리기로만 보관 중으로 돌아간다. */
  async function move(record: KanbanRecord, column: BoardColumn, index: number): Promise<void> {
    if (column !== "stored" || record.column !== "stored") {
      throw new Error("publish_columns_are_session_managed");
    }
    setRecords(await requireRepository().move(record.connectionId, record.providerPageId, index));
  }

  /** 블로그에서 내리기(R8). 저장소에서 글 파일을 지우고 카드를 보관 중으로 돌려놓는다. Notion 원문은 그대로다. */
  async function unpublish(record: KanbanRecord): Promise<void> {
    const key = pageKey(record);
    clearFailure(key);
    try {
      await unpublishInOrder(record.connectionId, record.providerPageId);
      const suffix = suffixOf(record.providerPageId);
      setBlogPosts((current) => {
        const next = new Map(current);
        next.delete(suffix);
        return next;
      });
      clearView(key);
    } catch (error) {
      setFailures((current) => ({
        ...current,
        [key]: {
          actionsUrl: null,
          message: publishErrorMessage(error instanceof ApiError ? error.code : "unpublish_unavailable"),
          retryAt: error instanceof ApiError ? error.retryAt : null,
        },
      }));
    }
  }

  /** 카드의 ✕: Notion 원문은 그대로 두고 칸반에서만 숨긴다. */
  async function remove(record: KanbanRecord): Promise<void> {
    const repository = requireRepository();
    const key = pageKey(record);
    removedKeys.current.add(key);
    clearView(key);
    clearFailure(key);
    setRecords(await repository.setVisibility(record.connectionId, record.providerPageId, false));
  }

  /**
   * 게시 중 열에 놓기. 성공하면 게시 완료로 옮긴다(새로고침 뒤에는 블로그 저장소 기준으로 다시 보인다).
   * 실패하면 원래 열로 돌려놓고 카드에 원인을 표시한다. 같은 카드의 게시는 동시에 하나만 진행한다.
   */
  const publish = useCallback(
    async (record: KanbanRecord): Promise<void> => {
      const repository = repositoryRef.current;
      const key = pageKey(record);
      if (repository === null || publishing.current.has(key)) {
        return;
      }
      publishing.current.add(key);
      removedKeys.current.delete(key);
      clearFailure(key);
      setViews((current) => ({
        ...current,
        [key]: { actionsUrl: null, column: "publishing", publishedUrl: null, startedAt: Date.now() },
      }));
      let actionsUrl: string | null = null;
      try {
        const current = await repository.get(record.connectionId, record.providerPageId);
        if (current === null || current.pageRole !== "document") {
          throw new ApiError("publish_record_unavailable");
        }
        if (!current.isVisible) {
          const shown = await repository.setVisibility(current.connectionId, current.providerPageId, true);
          if (mounted.current) {
            setRecords(shown);
          }
        }
        const publishedUrl = await publishAndWatch({
          connectionId: current.connectionId,
          githubLogin,
          isCancelled: () => !mounted.current,
          onActionsUrl: (url) => {
            actionsUrl = url;
            setViews((states) =>
              states[key] === undefined ? states : { ...states, [key]: { ...states[key], actionsUrl: url } },
            );
          },
          providerPageId: current.providerPageId,
        });
        if (publishedUrl === null) {
          return;
        }
        if (mounted.current && !removedKeys.current.has(key)) {
          const suffix = suffixOf(record.providerPageId);
          setBlogPosts((current) => new Map(current).set(suffix, publishedUrl));
          setViews((states) => ({
            ...states,
            [key]: { actionsUrl, column: "published", publishedUrl, startedAt: null },
          }));
        }
      } catch (error) {
        if (!mounted.current) {
          return;
        }
        const latest = await repository.get(record.connectionId, record.providerPageId);
        if (mounted.current && latest?.isVisible === true) {
          clearView(key);
          setFailures((current) => ({
            ...current,
            [key]: {
              actionsUrl,
              message: publishErrorMessage(error instanceof ApiError ? error.code : "publish_unavailable"),
              retryAt: error instanceof ApiError ? error.retryAt : null,
            },
          }));
        }
      } finally {
        publishing.current.delete(key);
      }
    },
    [githubLogin],
  );

  const kanbanRecords = useMemo(
    () => toKanbanRecords(records, views, failures, blogPosts),
    [records, views, failures, blogPosts],
  );

  return {
    boardState,
    failures,
    inspectStructure,
    kanbanRecords,
    move,
    pendingKeys,
    publish,
    records,
    remove,
    toggleVisibility,
    unpublish,
  };
}

function without<T>(map: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  const next = { ...map };
  delete next[key];
  return next;
}
