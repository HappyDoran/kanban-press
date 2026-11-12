"use client";

// 칸반 상태(제품 명세 §3 칸반·§4). 보관 중 목록은 블로그 저장소의 칸반 branch(`/api/board`), 게시 완료는 블로그
// 글 파일(`/api/publish/posts`), 게시 중과 실패 안내는 이 hook의 메모리다. 브라우저에는 저장하지 않으므로
// 같은 GitHub 계정이면 어느 브라우저에서 열어도 칸반이 같다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ApiError,
  type BlogPost,
  changeBoard,
  fetchBlogPosts,
  fetchBoard,
  type PageSummary,
  publishErrorMessage,
} from "@/lib/client/api";
import { TaskLimiter } from "@/lib/shared/task-limiter";
import { publishAndWatch, unpublishInOrder } from "@/lib/client/publish";
import { pageIdSuffix } from "@/lib/shared/blog-files";

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

// 서버는 board.json을 읽은 SHA로 조건부 저장하므로 이 탭의 넣기·빼기를 동시에 보내면 서로 conflict가 난다.
// 그래서 한 번에 하나씩 보낸다. 다른 탭·기기와의 충돌은 서버가 다시 읽어 몇 번 재시도한다.
const boardQueue = new TaskLimiter(1);

/** 서버 목록 위에 아직 응답을 받지 못한 이 탭의 넣기(true)·빼기(false)를 순서대로 다시 얹는다. */
export function applyBoardChanges(list: readonly string[], changes: ReadonlyMap<string, boolean>): string[] {
  let next = [...list];
  for (const [pageId, onBoard] of changes) {
    next = onBoard ? (next.includes(pageId) ? next : [...next, pageId]) : next.filter((id) => id !== pageId);
  }
  return next;
}

/** 보관 중 목록 변경 실패 문구. */
export function boardErrorMessage(code: string): string {
  return code === "github_conflict"
    ? "다른 곳에서 보관 중 목록이 바뀌었습니다. 새로고침한 뒤 다시 시도해 주세요."
    : code === "board_full"
      ? "보관 중에는 문서를 2,000개까지 둘 수 있습니다."
      : "보관 중 목록을 바꾸지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
}

/**
 * 칸반에 그릴 카드: 연결의 문서 page 중 보관 중 목록에 있거나(`board`, 하이픈 뺀 page ID를 추가한 순서로),
 * 블로그에 글이 있거나, 이번 화면에서 게시 중인 것. 이번 화면의 게시 상태 → 블로그에 있으면 게시 완료 →
 * 아니면 보관 중 순서로 열을 정한다. 최근에 보관 중에 넣은 문서가 위에 온다.
 */
export function toKanbanRecords(
  connectionId: string | null,
  pages: readonly PageSummary[],
  board: readonly string[],
  views: Readonly<Record<string, PublishView>>,
  failures: Readonly<Record<string, PublishFailure>>,
  blogPosts: ReadonlyMap<string, BlogPost> = new Map(),
): KanbanRecord[] {
  if (connectionId === null) {
    return [];
  }
  const boardOrder = new Map(board.map((pageId, index) => [pageId, index]));
  const rank = (providerPageId: string) => boardOrder.get(suffixOf(providerPageId)) ?? -1;
  return pages
    .flatMap((page): KanbanRecord[] => {
      const key = pageKey({ connectionId, providerPageId: page.providerPageId });
      const view = views[key];
      const suffix = suffixOf(page.providerPageId);
      const blogPost = blogPosts.get(suffix);
      const blogUrl = blogPost?.url ?? null;
      if (isContainer(page) || (!boardOrder.has(suffix) && blogUrl === null && view === undefined)) {
        return [];
      }
      return [{
        column: view?.column ?? (blogUrl === null ? "stored" : "published"),
        connectionId,
        // 원문 수정 표시(§5.1 R8). 둘 다 Notion이 준 분 단위 시각이라 그대로 비교한다. 이번 화면의 게시는 제외한다.
        outdated:
          view === undefined &&
          blogPost !== undefined &&
          blogPost.updatedAt !== null &&
          Date.parse(page.lastEditedAt) > Date.parse(blogPost.updatedAt),
        providerPageId: page.providerPageId,
        publishActionsUrl: view?.actionsUrl ?? failures[key]?.actionsUrl ?? null,
        publishedUrl: view?.publishedUrl ?? blogUrl,
        publishStartedAt: view?.startedAt ?? null,
        sourceLastEditedAt: page.lastEditedAt,
        title: page.title,
      }];
    })
    .sort(
      (left, right) =>
        rank(right.providerPageId) - rank(left.providerPageId) ||
        right.sourceLastEditedAt.localeCompare(left.sourceLastEditedAt) ||
        left.providerPageId.localeCompare(right.providerPageId),
    );
}

/** 보관 중 목록에 쓰는 page ID(하이픈 뺀 32자). 형식이 틀리면 빈 문자열. */
export function suffixOf(providerPageId: string): string {
  try {
    return pageIdSuffix(providerPageId);
  } catch {
    return "";
  }
}

export function useBoard(ownerId: string | null, githubLogin: string, pageList: PageList) {
  const [views, setViews] = useState<Readonly<Record<string, PublishView>>>({});
  const [failures, setFailures] = useState<Readonly<Record<string, PublishFailure>>>({});
  const [blogPosts, setBlogPosts] = useState<ReadonlyMap<string, BlogPost>>(new Map());
  const [board, setBoard] = useState<readonly string[]>([]);
  const [boardError, setBoardError] = useState("");
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set());
  const publishing = useRef(new Set<string>());
  const boardChanges = useRef(new Map<string, boolean>());
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
    setBoard([]);
    setBoardError("");
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
    fetchBoard(controller.signal)
      .then((pageIds) => setBoard(pageIds))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setBoardError("보관 중 목록을 불러오지 못했습니다. GitHub Pages 저장소 상태를 확인한 뒤 새로고침해 주세요.");
        }
      });
    return () => controller.abort();
  }, [ownerId]);

  /**
   * 보관 중에 넣기·빼기. 화면을 먼저 바꾸고 이 탭의 변경을 하나씩 서버에 보낸다. 응답 목록에는 아직 보내지 않은
   * 변경을 다시 얹어, 여러 문서를 빠르게 넣어도 앞선 응답이 뒤 문서를 지우지 않는다. 실패하면 그 문서만 되돌린다.
   * 같은 문서의 변경은 동시에 하나만 보낸다.
   */
  async function setOnBoard(connectionId: string, providerPageId: string, onBoard: boolean): Promise<void> {
    const key = pageKey({ connectionId, providerPageId });
    const suffix = suffixOf(providerPageId);
    if (pendingKeys.has(key) || suffix === "") {
      return;
    }
    setPendingKeys((current) => new Set(current).add(key));
    setBoardError("");
    const wasOnBoard = board.includes(suffix);
    boardChanges.current.set(suffix, onBoard);
    setBoard((current) => applyBoardChanges(current, new Map([[suffix, onBoard]])));
    try {
      const saved = await boardQueue.run(() => changeBoard(onBoard ? "add" : "remove", connectionId, providerPageId));
      boardChanges.current.delete(suffix);
      if (mounted.current) {
        setBoard(applyBoardChanges(saved, boardChanges.current));
      }
    } catch (error) {
      boardChanges.current.delete(suffix);
      setBoard((current) => applyBoardChanges(current, new Map([[suffix, wasOnBoard]])));
      setBoardError(boardErrorMessage(error instanceof ApiError ? error.code : ""));
    } finally {
      setPendingKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  /** 카드의 ✕: 보관 중 목록에서만 뺀다. Notion 원문과 블로그 글은 그대로다. */
  const remove = (record: KanbanRecord) => setOnBoard(record.connectionId, record.providerPageId, false);

  const clearView = (key: string) => setViews((current) => without(current, key));
  const clearFailure = (key: string) => setFailures((current) => without(current, key));
  const fail = (key: string, error: unknown, fallbackCode: string, actionsUrl: string | null = null) =>
    setFailures((current) => ({
      ...current,
      [key]: {
        actionsUrl,
        message: error instanceof ApiError ? publishErrorMessage(error.code, error.detail) : publishErrorMessage(fallbackCode),
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
      // 내린 글은 보관 중으로 돌아간다(§4). 목록에 없던 글이면 넣는다.
      if (!board.includes(suffix)) {
        await setOnBoard(record.connectionId, record.providerPageId, true);
      }
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
        // 방금 쓴 글의 수정 시각은 새로고침 때 저장소에서 다시 읽는다.
        setBlogPosts((current) => new Map(current).set(suffix, { updatedAt: null, url: publishedUrl }));
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
    () => (state === "ready" ? toKanbanRecords(connectionId, pages, board, views, failures, blogPosts) : []),
    [connectionId, pages, state, board, views, failures, blogPosts],
  );
  const boardIds = useMemo(() => new Set(board), [board]);
  const publishedIds = useMemo(() => new Set(blogPosts.keys()), [blogPosts]);

  return { board: boardIds, boardError, published: publishedIds, failures, kanbanRecords, pendingKeys, publish, remove, setOnBoard, unpublish };
}

function without<T>(map: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  const next = { ...map };
  delete next[key];
  return next;
}
