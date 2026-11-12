"use client";

// 로그인 세션 → Notion 연결 목록 → 선택한 연결의 page 목록을 차례로 불러오는 상태.
import { useCallback, useEffect, useState } from "react";

import {
  type Account,
  ApiError,
  type Connection,
  fetchAccount,
  fetchConnections,
  fetchPages,
  pageErrorMessage,
  type PageSummary,
} from "@/lib/client/api";

type LoadState = "error" | "loading" | "ready";

export type SessionState = "error" | "loading" | "signed-in" | "signed-out";

export interface PageList {
  /** 이 목록이 어느 연결의 것인지. 다른 연결로 바꾸는 동안 이전 목록과 섞이지 않게 한다. */
  connectionId: string | null;
  error: string;
  pages: PageSummary[];
  retryAt: number | null;
  state: LoadState;
}

const LOADING_PAGES: PageList = { connectionId: null, error: "", pages: [], retryAt: null, state: "loading" };

export function useWorkspace() {
  const [session, setSession] = useState<SessionState>("loading");
  const [account, setAccount] = useState<Account | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionState, setConnectionState] = useState<LoadState>("loading");
  const [selectedConnectionId, selectConnection] = useState<string | null>(null);
  const [pageList, setPageList] = useState<PageList>(LOADING_PAGES);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setSession("loading");
      setConnectionState("loading");
      try {
        const me = await fetchAccount(controller.signal);
        setAccount(me);
        if (me === null) {
          setSession("signed-out");
          return;
        }
        setSession("signed-in");
        const next = await fetchConnections(controller.signal);
        setConnections(next);
        // 다시 불러와도 선택한 연결이 남아 있으면 유지하고, 없으면 첫 연결을 고른다.
        selectConnection((current) =>
          next.some((connection) => connection.connectionId === current)
            ? current
            : (next[0]?.connectionId ?? null),
        );
        setConnectionState("ready");
      } catch (error) {
        if (!isAbort(error)) {
          setSession("error");
          setConnectionState("error");
        }
      }
    })();
    return () => controller.abort();
  }, [reloadKey]);

  useEffect(() => {
    if (selectedConnectionId === null) {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      setPageList(LOADING_PAGES);
      try {
        const pages = await fetchPages(selectedConnectionId, controller.signal);
        setPageList({ connectionId: selectedConnectionId, error: "", pages, retryAt: null, state: "ready" });
      } catch (error) {
        if (!isAbort(error)) {
          setPageList({
            connectionId: null,
            error: pageErrorMessage(error instanceof ApiError ? error.code : ""),
            pages: [],
            retryAt: error instanceof ApiError ? error.retryAt : null,
            state: "error",
          });
        }
      }
    })();
    return () => controller.abort();
  }, [selectedConnectionId, reloadKey]);

  return {
    account,
    connections,
    connectionState,
    pageList,
    reload,
    selectConnection,
    selectedConnectionId,
    session,
  };
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
