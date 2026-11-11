"use client";

// 칸반 상태. 브라우저에 저장하지 않고 열 때마다 계산한다(제품 명세 §4): 카드는 선택한 Notion 연결의 문서 page,
// 게시 완료 열은 블로그 저장소에 그 글이 있는지(R8), 게시 중과 실패 안내는 이 hook의 메모리다.
// 그래서 같은 GitHub 계정·같은 Notion 연결이면 어느 브라우저에서 열어도 칸반이 같다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, fetchBlogPosts, type PageSummary, publishErrorMessage } from "../lib/client/api";
import { publishAndWatch, unpublishInOrder } from "../lib/client/publish";
import { pageIdSuffix } from "../lib/publish/blog-files";

import type { KanbanRecord } from "./kanban-board";
import type { PageList } from "./use-workspace";

/** 화면 메모리에만 있는 게시 진행 상태. */
export type PublishView =
  | { actionsUrl: string | null; column: "publishing"; publishedUrl: null; startedAt: number }
  | { actionsUrl: string | null; column: "published"; publishedUrl: string; startedAt: null };

export interface PublishFailure {
  actionsUrl: string | null;
  message: string;
  retryAt: number | null;
}

export function pageKey(record: { connectionId: string; providerPageId: string }): string {
  return `${record.connectionId}:${record.providerPageId}`;
}

/** 하위 page(직접·database 행·토글 안)가 있는 page는 탐색용 컨테이너라 칸반과 게시 대상이 아니다. */
export function isContainer(page: Pick<PageSummary, "hasChildren">): boolean {
  return page.hasChildren;
}

/**
 * 칸반에 그릴 카드: 연결의 모든 문서 page. 이번 화면의 게시 상태 → 블로그에 있으면 게시 완료 → 아니면 보관 중
 * 순서로 열을 정하고, Notion 수정 시각이 최근인 문서가 위에 온다.
 */
export function toKanbanRecords(
  connectionId: string | null,
  pages: readonly PageSummary[],
  views: Readonly<Record<string, PublishView>>,
  failures: Readonly<Record<string, PublishFailure>>,
  blogPosts: ReadonlyMap<string, string> = new Map(),
): KanbanRecord[] {
  if (connectionId === null) {
    return [];
  }
  return pages
    .filter((page) => !isContainer(page))
    .map((page): KanbanRecord => {
      const key = pageKey({ connectionId, providerPageId: page.providerPageId });
      const view = views[key];
      const blogUrl = blogPosts.get(suffixOf(page.providerPageId)) ?? null;
      return {
        column: view?.column ?? (blogUrl === null ? "stored" : "published"),
        connectionId,
        providerPageId: page.providerPageId,
        publishActionsUrl: view?.actionsUrl ?? failures[key]?.actionsUrl ?? null,
        publishedUrl: view?.publishedUrl ?? blogUrl,
        publishStartedAt: view?.startedAt ?? null,
        sourceLastEditedAt: page.lastEditedAt,
        title: page.title,
      };
    })
    .sort(
      (left, right) =>
        right.sourceLastEditedAt.localeCompare(left.sourceLastEditedAt) ||
        left.providerPageId.localeCompare(right.providerPageId),
    );
}

function suffixOf(providerPageId: string): string {
  try {
    return pageIdSuffix(providerPageId);
  } catch {
    return "";
  }
}

export function useBoard(ownerId: string | null, githubLogin: string, pageList: PageList) {
  const [views, setViews] = useState<Readonly<Record<string, PublishView>>>({});
  const [failures, setFailures] = useState<Readonly<Record<string, PublishFailure>>>({});
  const [blogPosts, setBlogPosts] = useState<ReadonlyMap<string, string>>(new Map());
  const publishing = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // GitHub 사용자가 바뀌면 이전 사용자의 화면 상태를 버린다.
  const [shownOwner, setShownOwner] = useState(ownerId);
  if (shownOwner !== ownerId) {
    setShownOwner(ownerId);
    setViews({});
    setFailures({});
    setBlogPosts(new Map());
  }

  // 그 사용자의 블로그 글. 읽지 못하면(저장소 없음·권한 없음 등) 게시 완료 열을 비워 둔다.
  useEffect(() => {
    if (ownerId === null) {
      return;
    }
    const controller = new AbortController();
    fetchBlogPosts(controller.signal)
      .then((posts) => setBlogPosts(posts))
      .catch(() => undefined);
    return () => controller.abort();
  }, [ownerId]);

  const clearView = (key: string) => setViews((current) => without(current, key));
  const clearFailure = (key: string) => setFailures((current) => without(current, key));
  const fail = (key: string, error: unknown, fallbackCode: string, actionsUrl: string | null = null) =>
    setFailures((current) => ({
      ...current,
      [key]: {
        actionsUrl,
        message: publishErrorMessage(error instanceof ApiError ? error.code : fallbackCode),
        retryAt: error instanceof ApiError ? error.retryAt : null,
      },
    }));

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
      fail(key, error, "unpublish_unavailable");
    }
  }

  /**
   * 게시 중 열에 놓기. 성공하면 게시 완료로 옮긴다(새로고침 뒤에는 블로그 저장소 기준으로 다시 보인다).
   * 실패하면 원래 열로 돌려놓고 카드에 원인을 표시한다. 같은 카드의 게시는 동시에 하나만 진행한다.
   * 서버가 Notion 소유권과 page를 다시 확인하므로 여기서는 화면의 카드를 그대로 보낸다.
   */
  const publish = useCallback(
    async (record: KanbanRecord): Promise<void> => {
      const key = pageKey(record);
      if (publishing.current.has(key)) {
        return;
      }
      publishing.current.add(key);
      clearFailure(key);
      setViews((current) => ({
        ...current,
        [key]: { actionsUrl: null, column: "publishing", publishedUrl: null, startedAt: Date.now() },
      }));
      let actionsUrl: string | null = null;
      try {
        const publishedUrl = await publishAndWatch({
          connectionId: record.connectionId,
          githubLogin,
          isCancelled: () => !mounted.current,
          onActionsUrl: (url) => {
            actionsUrl = url;
            setViews((states) =>
              states[key] === undefined ? states : { ...states, [key]: { ...states[key], actionsUrl: url } },
            );
          },
          providerPageId: record.providerPageId,
        });
        if (publishedUrl === null || !mounted.current) {
          return;
        }
        const suffix = suffixOf(record.providerPageId);
        setBlogPosts((current) => new Map(current).set(suffix, publishedUrl));
        setViews((states) => ({
          ...states,
          [key]: { actionsUrl, column: "published", publishedUrl, startedAt: null },
        }));
      } catch (error) {
        if (mounted.current) {
          clearView(key);
          fail(key, error, "publish_unavailable", actionsUrl);
        }
      } finally {
        publishing.current.delete(key);
      }
    },
    [githubLogin],
  );

  const { connectionId, pages, state } = pageList;
  const kanbanRecords = useMemo(
    () => (state === "ready" ? toKanbanRecords(connectionId, pages, views, failures, blogPosts) : []),
    [connectionId, pages, state, views, failures, blogPosts],
  );

  return { failures, kanbanRecords, publish, unpublish };
}

function without<T>(map: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  const next = { ...map };
  delete next[key];
  return next;
}
