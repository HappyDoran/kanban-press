"use client";

// 칸반 상태. 보관 중 카드는 IndexedDB(BoardRepository)에, 게시 중·게시 완료와 실패 안내는
// 이 hook의 메모리에만 둔다. 새로고침하면 게시 상태는 사라지고 보관 중 카드만 남는다.
import type { BoardColumn } from "@notion-kanban-blog/domain";
import type { NotionOutlineNode } from "@notion-kanban-blog/notion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type BoardRecord, BoardRepository } from "../lib/board/repository";
import { TaskLimiter } from "../lib/board/task-limiter";
import { ApiError, fetchOutline, type PageSummary, publishErrorMessage } from "../lib/client/api";
import { publishAndWatch } from "../lib/client/publish";
import { filterRenderableOutline } from "../lib/notion/outline";

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

export function pageKey(record: { connectionId: string; providerPageId: string }): string {
  return `${record.connectionId}:${record.providerPageId}`;
}

/** 최상위 page만 기본으로 칸반에 보인다. 하위 page와 database 행은 사용자가 골라야 한다. */
export function isVisibleByDefault(page: Pick<PageSummary, "parentContainerId" | "parentPageId">): boolean {
  return page.parentPageId === null && page.parentContainerId === null;
}

/**
 * 칸반에 그릴 카드. 문서 역할이고 보이도록 선택됐거나, 숨겨졌어도 이번 화면에서 게시 중·완료인 카드다.
 * 게시 상태가 있으면 그 열에, 없으면 보관 중에 놓는다.
 */
export function toKanbanRecords(
  records: readonly BoardRecord[],
  views: Readonly<Record<string, PublishView>>,
  failures: Readonly<Record<string, PublishFailure>>,
): KanbanRecord[] {
  return records.flatMap((record) => {
    const view = views[pageKey(record)];
    if (record.pageRole !== "document" || (!record.isVisible && view === undefined)) {
      return [];
    }
    return [
      {
        ...record,
        column: view?.column ?? "stored",
        publishActionsUrl: view?.actionsUrl ?? failures[pageKey(record)]?.actionsUrl ?? null,
        publishedUrl: view?.publishedUrl ?? null,
        publishStartedAt: view?.startedAt ?? null,
      },
    ];
  });
}

export function useBoard(ownerId: string | null, githubLogin: string, pageList: PageList) {
  const [records, setRecords] = useState<readonly BoardRecord[]>([]);
  const [boardState, setBoardState] = useState<LoadState>("loading");
  const [views, setViews] = useState<Readonly<Record<string, PublishView>>>({});
  const [failures, setFailures] = useState<Readonly<Record<string, PublishFailure>>>({});
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set());
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
          const outline = filterRenderableOutline(
            await fetchOutline(connectionId, page.providerPageId),
            pageList.pages,
          );
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

  /** 보관 중으로 놓기. 게시 완료 카드를 되돌리면 다시 보이게 하고 완료 표시를 닫는다. */
  async function move(record: KanbanRecord, column: BoardColumn, index: number): Promise<void> {
    if (column !== "stored") {
      throw new Error("publish_columns_are_session_managed");
    }
    const repository = requireRepository();
    const key = pageKey(record);
    removedKeys.current.delete(key);
    if (record.column === "published") {
      await repository.setVisibility(record.connectionId, record.providerPageId, true);
    }
    const moved = await repository.move(record.connectionId, record.providerPageId, index);
    clearView(key);
    setRecords(moved);
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
   * 게시 중 열에 놓기. 성공하면 카드를 IndexedDB에서 숨기고 이번 화면에서만 게시 완료로 보여준다.
   * 실패하면 보관 중으로 돌려놓고 카드에 원인을 표시한다. 같은 카드의 게시는 동시에 하나만 진행한다.
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
        const latest = await repository.get(record.connectionId, record.providerPageId);
        if (latest?.isVisible !== true || removedKeys.current.has(key)) {
          return;
        }
        const hidden = await repository.setVisibility(record.connectionId, record.providerPageId, false);
        if (mounted.current && !removedKeys.current.has(key)) {
          setRecords(hidden);
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

  const kanbanRecords = useMemo(() => toKanbanRecords(records, views, failures), [records, views, failures]);

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
  };
}

function without<T>(map: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  const next = { ...map };
  delete next[key];
  return next;
}
