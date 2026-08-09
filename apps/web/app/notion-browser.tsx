"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { BoardRepository } from "../lib/board/repository";
import { formatEditedAt } from "../lib/format-date";
import {
  hasConfirmedNavigableChildren,
  pageActionAvailability,
  pagePrimaryAction,
  type StructureInspectionState,
} from "../lib/board/page-role";
import { TaskLimiter } from "../lib/board/task-limiter";
import {
  filterRenderableOutline,
  type ClientOutlineNode,
} from "../lib/notion/outline";
import { shouldShowBoardRecord } from "./board-drop";
import { GitHubPagesTarget } from "./github-pages-target";
import { KanbanBoard, type KanbanRecord } from "./kanban-board";

import type { BoardColumn } from "@notion-kanban-blog/domain";
import type { ReactNode } from "react";
import type { BoardRecord } from "../lib/board/repository";

interface Connection {
  connectedAt: number;
  connectionId: string;
  workspaceIcon: string | null;
  workspaceName: string;
}

interface PageSummary {
  hasChildren: boolean;
  iconUrl: string | null;
  lastEditedAt: string;
  parentContainerId: string | null;
  parentPageId: string | null;
  providerPageId: string;
  title: string;
}

type OutlineNode = ClientOutlineNode;

type LoadState = "error" | "loading" | "ready";
type SessionState = "error" | "loading" | "signed-in" | "signed-out";
type PublishViewState =
  | { column: "published"; publishedUrl: string; startedAt: null }
  | { column: "publishing"; publishedUrl: null; startedAt: number };
const STRUCTURE_INSPECTION_CONCURRENCY = 3;

export function NotionBrowser({ marketing }: { marketing?: ReactNode }) {
  const [sessionState, setSessionState] = useState<SessionState>("loading");
  const [githubLogin, setGitHubLogin] = useState("");
  const [githubUserId, setGitHubUserId] = useState<string | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionState, setConnectionState] =
    useState<LoadState>("loading");
  const [selectedConnectionId, setSelectedConnectionId] = useState<
    string | null
  >(null);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [pageConnectionId, setPageConnectionId] = useState<string | null>(
    null,
  );
  const [pageState, setPageState] = useState<LoadState>("loading");
  const [pageError, setPageError] = useState("");
  const [boardRecords, setBoardRecords] = useState<readonly BoardRecord[]>([]);
  const [publishErrors, setPublishErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const [publishViewStates, setPublishViewStates] = useState<
    Readonly<Record<string, PublishViewState>>
  >({});
  const [boardState, setBoardState] = useState<LoadState>("loading");
  const [pendingPageIds, setPendingPageIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [reloadKey, setReloadKey] = useState(0);
  const boardRepository = useRef<BoardRepository | null>(null);
  const structureInspectionLimiter = useRef(
    new TaskLimiter(STRUCTURE_INSPECTION_CONCURRENCY),
  );
  const structureInspections = useRef(
    new Map<string, Promise<OutlineNode[]>>(),
  );
  const publishTasks = useRef(new Map<string, Promise<void>>());
  const removedBoardKeys = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(
    () => {
      mounted.current = true;
      return () => {
        mounted.current = false;
      };
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();

    async function loadAccount() {
      setSessionState("loading");
      setConnectionState("loading");
      try {
        const meResponse = await fetch("/api/me", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (meResponse.status === 401) {
          setGitHubUserId(null);
          setBoardRecords([]);
          setPublishViewStates({});
          setSessionState("signed-out");
          return;
        }
        if (!meResponse.ok) {
          throw new Error("account_failed");
        }
        const me = (await meResponse.json()) as {
          authenticated?: unknown;
          user?: { id?: unknown; login?: unknown };
        };
        if (
          me.authenticated !== true ||
          typeof me.user?.id !== "string" ||
          typeof me.user?.login !== "string"
        ) {
          throw new Error("invalid_account");
        }
        setGitHubLogin(me.user.login);
        setGitHubUserId(me.user.id);
        setBoardState("loading");
        setSessionState("signed-in");

        const connectionsResponse = await fetch("/api/notion/connections", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!connectionsResponse.ok) {
          throw new Error("connections_failed");
        }
        const payload = (await connectionsResponse.json()) as {
          connections?: unknown;
        };
        const nextConnections = parseConnections(payload.connections);
        setConnections(nextConnections);
        setSelectedConnectionId((current) =>
          current !== null &&
          nextConnections.some(
            (connection) => connection.connectionId === current,
          )
            ? current
            : (nextConnections[0]?.connectionId ?? null),
        );
        setConnectionState("ready");
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        setSessionState("error");
        setConnectionState("error");
      }
    }

    void loadAccount();
    return () => controller.abort();
  }, [reloadKey]);

  useEffect(() => {
    if (githubUserId === null) {
      return;
    }
    const repository = new BoardRepository(githubUserId);
    boardRepository.current = repository;
    let active = true;

    void repository
      .list()
      .then((records) => {
        if (active) {
          removedBoardKeys.current.clear();
          setPublishViewStates({});
          setBoardRecords(records);
          setBoardState("ready");
        }
      })
      .catch(() => {
        if (active) {
          setBoardRecords([]);
          setBoardState("error");
        }
      });

    return () => {
      active = false;
      if (boardRepository.current === repository) {
        boardRepository.current = null;
      }
      repository.close();
    };
  }, [githubUserId]);

  useEffect(() => {
    if (selectedConnectionId === null) {
      return;
    }
    const controller = new AbortController();

    async function loadPages() {
      const connectionId = selectedConnectionId;
      setPageState("loading");
      setPageError("");
      setPageConnectionId(null);
      try {
        const response = await fetch(
          `/api/notion/connections/${encodeURIComponent(connectionId ?? "")}/pages`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) {
          const errorPayload = (await safeJson(response)) as {
            error?: unknown;
          } | null;
          throw new Error(
            typeof errorPayload?.error === "string"
              ? errorPayload.error
              : "notion_pages_unavailable",
          );
        }
        const payload = (await response.json()) as { pages?: unknown };
        setPages(parsePages(payload.pages));
        setPageConnectionId(connectionId);
        setPageState("ready");
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        setPages([]);
        setPageError(pageErrorMessage(error));
        setPageState("error");
      }
    }

    void loadPages();
    return () => controller.abort();
  }, [selectedConnectionId, reloadKey]);

  useEffect(() => {
    const repository = boardRepository.current;
    if (
      repository === null ||
      boardState !== "ready" ||
      pageState !== "ready" ||
      pageConnectionId === null ||
      pageConnectionId !== selectedConnectionId
    ) {
      return;
    }
    let active = true;
    void repository
      .syncDrafts(
        pages.map((page) => ({
          connectionId: pageConnectionId,
          isVisibleByDefault:
            page.parentPageId === null &&
            page.parentContainerId === null,
          providerPageId: page.providerPageId,
          sourceLastEditedAt: page.lastEditedAt,
          title: page.title,
        })),
      )
      .then((records) => {
        if (active) {
          setBoardRecords(records);
        }
      })
      .catch(() => {
        if (active) {
          setBoardState("error");
        }
      });
    return () => {
      active = false;
    };
  }, [
    boardState,
    pageConnectionId,
    pageState,
    pages,
    selectedConnectionId,
  ]);

  const selectedConnection = useMemo(
    () =>
      connections.find(
        (connection) => connection.connectionId === selectedConnectionId,
      ) ?? null,
    [connections, selectedConnectionId],
  );
  const boardRecordsByPageKey = useMemo(
    () =>
      new Map(
        boardRecords.map((record) => [
          boardPageKey(record.connectionId, record.providerPageId),
          record,
        ]),
      ),
    [boardRecords],
  );
  const selectedStoredCount = boardRecords.filter(
    (record) =>
      record.connectionId === selectedConnectionId &&
      record.isVisible &&
      record.pageRole === "document" &&
      record.column === "stored",
  ).length;
  const connectionNames = useMemo(
    () =>
      Object.fromEntries(
        connections.map((connection) => [
          connection.connectionId,
          connection.workspaceName,
        ]),
      ),
    [connections],
  );
  const kanbanRecords = useMemo(
    () =>
      boardRecords
        .filter(
          (record) => {
            const key = boardPageKey(
              record.connectionId,
              record.providerPageId,
            );
            return (
              record.pageRole === "document" &&
              shouldShowBoardRecord(
                record.isVisible,
                publishViewStates[key] !== undefined,
              )
            );
          },
        )
        .map((record): KanbanRecord => {
          const view = publishViewStates[
            boardPageKey(record.connectionId, record.providerPageId)
          ];
          return {
            ...record,
            column: view?.column ?? "stored",
            publishedUrl: view?.publishedUrl ?? null,
            publishStartedAt: view?.startedAt ?? null,
          };
        }),
    [boardRecords, publishViewStates],
  );

  async function togglePageVisibility(page: PageSummary): Promise<void> {
    const repository = boardRepository.current;
    const connectionId = selectedConnectionId;
    if (repository === null || connectionId === null) {
      return;
    }
    const pendingKey = boardPageKey(connectionId, page.providerPageId);
    const record = boardRecordsByPageKey.get(pendingKey);
    if (record === undefined) {
      return;
    }
    setPendingPageIds((current) => new Set(current).add(pendingKey));
    try {
      if (record.isVisible) {
        removedBoardKeys.current.add(pendingKey);
      } else {
        removedBoardKeys.current.delete(pendingKey);
      }
      const records = await repository.setVisibility(
        connectionId,
        page.providerPageId,
        !record.isVisible,
      );
      setBoardRecords(records);
      setBoardState("ready");
    } catch {
      setBoardState("error");
    } finally {
      setPendingPageIds((current) => {
        const next = new Set(current);
        next.delete(pendingKey);
        return next;
      });
    }
  }

  const inspectPageStructure = useCallback(
    async (page: PageSummary): Promise<OutlineNode[]> => {
      const repository = boardRepository.current;
      const connectionId = selectedConnectionId;
      if (repository === null || connectionId === null) {
        throw new Error("structure_inspection_unavailable");
      }
      const inspectionKey = boardPageKey(
        connectionId,
        page.providerPageId,
      );
      const pendingInspection =
        structureInspections.current.get(inspectionKey);
      if (pendingInspection !== undefined) {
        return pendingInspection;
      }
      const inspection = structureInspectionLimiter.current.run(
        async () => {
          const response = await fetch(
            `/api/notion/connections/${encodeURIComponent(connectionId)}/pages/${encodeURIComponent(page.providerPageId)}/outline`,
            { cache: "no-store" },
          );
          if (!response.ok) {
            throw new Error("outline_unavailable");
          }
          const payload = (await response.json()) as {
            outline?: unknown;
          };
          const outline = filterRenderableOutline(
            parseOutline(payload.outline),
            pages,
          );
          const hasDiscoveredChildren =
            page.hasChildren ||
            pages.some(
              (candidate) =>
                candidate.parentPageId === page.providerPageId,
            );
          const records = await repository.setStructureInspection(
            connectionId,
            page.providerPageId,
            page.lastEditedAt,
            outline.length > 0 || hasDiscoveredChildren,
            page.parentPageId === null &&
              page.parentContainerId === null,
          );
          setBoardRecords(records);
          return outline;
        },
      );
      structureInspections.current.set(inspectionKey, inspection);
      try {
        return await inspection;
      } finally {
        if (
          structureInspections.current.get(inspectionKey) ===
          inspection
        ) {
          structureInspections.current.delete(inspectionKey);
        }
      }
    },
    [pages, selectedConnectionId],
  );

  async function moveBoardRecord(
    record: KanbanRecord,
    targetColumn: BoardColumn,
    targetIndex: number,
  ): Promise<void> {
    const repository = boardRepository.current;
    if (repository === null) {
      throw new Error("board_repository_unavailable");
    }
    if (targetColumn !== "stored") {
      throw new Error("publish_columns_are_session_managed");
    }
    const key = boardPageKey(record.connectionId, record.providerPageId);
    removedBoardKeys.current.delete(key);
    if (record.column === "published") {
      await repository.setVisibility(
        record.connectionId,
        record.providerPageId,
        true,
      );
    }
    const records = await repository.move(
      record.connectionId,
      record.providerPageId,
      "stored",
      targetIndex,
    );
    setPublishViewStates((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setBoardRecords(records);
  }

  async function removeBoardRecord(record: KanbanRecord): Promise<void> {
    const repository = boardRepository.current;
    if (repository === null) {
      throw new Error("board_repository_unavailable");
    }
    const key = boardPageKey(record.connectionId, record.providerPageId);
    removedBoardKeys.current.add(key);
    setPublishViewStates((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setPublishErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    const records = await repository.setVisibility(
      record.connectionId,
      record.providerPageId,
      false,
    );
    setBoardRecords(records);
  }

  const runPublish = useCallback(async (
    record: KanbanRecord,
    key: string,
  ): Promise<void> => {
    const repository = boardRepository.current;
    if (repository === null) {
      return;
    }
    removedBoardKeys.current.delete(key);
    setPublishErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setPublishViewStates((current) => ({
      ...current,
      [key]: {
        column: "publishing",
        publishedUrl: null,
        startedAt: Date.now(),
      },
    }));
    try {
      const current = await repository.get(
        record.connectionId,
        record.providerPageId,
      );
      if (current === null || current.pageRole !== "document") {
        throw new Error("publish_record_unavailable");
      }
      if (!current.isVisible) {
        const records = await repository.setVisibility(
          current.connectionId,
          current.providerPageId,
          true,
        );
        if (mounted.current) {
          setBoardRecords(records);
        }
      }
      const publishResponse = await fetch("/api/publish", {
        body: JSON.stringify({
          connectionId: current.connectionId,
          providerPageId: current.providerPageId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const result = parsePublishResult(await safeJson(publishResponse));
      if (!publishResponse.ok || result === null) {
        throw new Error("publish_request_failed");
      }
      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (!mounted.current) {
          return;
        }
        const response = await fetch(
          `/api/publish/status?commitSha=${encodeURIComponent(result.commitSha)}`,
          { cache: "no-store" },
        );
        const status = parsePublishStatus(await safeJson(response));
        if (!response.ok || status === null) {
          throw new Error("publish_status_failed");
        }
        if (status.state === "succeeded") {
          const latest = await repository.get(
            record.connectionId,
            record.providerPageId,
          );
          if (
            latest?.isVisible === true &&
            !removedBoardKeys.current.has(key)
          ) {
            const records = await repository.setVisibility(
              record.connectionId,
              record.providerPageId,
              false,
            );
            if (
              mounted.current &&
              !removedBoardKeys.current.has(key)
            ) {
              setBoardRecords(records);
              setPublishViewStates((currentStates) => ({
                ...currentStates,
                [key]: {
                  column: "published",
                  publishedUrl: result.pageUrl,
                  startedAt: null,
                },
              }));
            }
          }
          return;
        }
        if (status.state === "failed") {
          throw new Error("deployment_failed");
        }
        await pollingDelay(3_000);
      }
      throw new Error("deployment_timeout");
    } catch {
      if (!mounted.current) {
        return;
      }
      const latest = await repository.get(
        record.connectionId,
        record.providerPageId,
      );
      if (mounted.current && latest?.isVisible === true) {
        setPublishViewStates((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
        setPublishErrors((current) => ({
          ...current,
          [key]: "게시하지 못했습니다. 권한과 배포 로그를 확인한 뒤 다시 시도해 주세요.",
        }));
      }
    }
  }, []);

  const publishBoardRecord = useCallback(
    async (record: KanbanRecord): Promise<void> => {
      const key = boardPageKey(
        record.connectionId,
        record.providerPageId,
      );
      const existing = publishTasks.current.get(key);
      if (existing !== undefined) {
        return;
      }
      const task = runPublish(record, key).finally(() => {
        publishTasks.current.delete(key);
      });
      publishTasks.current.set(key, task);
    },
    [runPublish],
  );

  return (
    <>
      <nav aria-label="주요 탐색" className="navigation">
        <Link aria-label="Notion Kanban Blog 홈" className="brand" href="/">
          <span aria-hidden="true" className="brandMark">
            ●
          </span>
          <span>Notion Kanban Blog</span>
        </Link>
        <div className="navigationActions">
          {sessionState === "signed-in" ? (
            <>
              <span className="sessionChip">@{githubLogin}</span>
              <Link
                className="notionLink"
                href="/auth/notion/start?returnTo=%2F"
                prefetch={false}
              >
                Notion 연결
              </Link>
              <Link
                className="quietLink"
                href="/auth/logout"
                prefetch={false}
              >
                로그아웃
              </Link>
            </>
          ) : null}
          {sessionState === "signed-out" ? (
            <Link
              className="loginLink"
              href="/auth/github/start?returnTo=%2F"
              prefetch={false}
            >
              GitHub로 시작
            </Link>
          ) : null}
        </div>
      </nav>

      {sessionState === "signed-out" ? (
        marketing
      ) : (
        <section
          aria-labelledby="notion-browser-title"
          className="notionBrowser"
        >
          <div className="sectionHeading">
            <p className="eyebrow">Your workspace</p>
            <div>
              <h2 id="notion-browser-title">Notion 문서 탐색</h2>
              {sessionState === "signed-in" ? (
                <p className="sectionDescription">
                  @{githubLogin} 계정에 연결된 문서만 표시합니다.
                </p>
              ) : null}
            </div>
          </div>

          {sessionState === "loading" ? (
            <StatusPanel message="연결 정보를 확인하고 있습니다." />
          ) : null}

          {sessionState === "error" || connectionState === "error" ? (
        <StatusPanel
          action={() => setReloadKey((value) => value + 1)}
          actionLabel="다시 시도"
          message="계정 또는 연결 정보를 불러오지 못했습니다."
        />
      ) : null}

      {sessionState === "signed-in" &&
      connectionState === "ready" &&
      connections.length === 0 ? (
        <StatusPanel
          actionHref="/auth/notion/start?returnTo=%2F"
          actionLabel="Notion 연결"
          message="아직 연결된 Notion 워크스페이스가 없습니다."
        />
      ) : null}

      {sessionState === "signed-in" &&
      connectionState === "ready" &&
      connections.length > 0 ? (
        <div className="documentExplorer">
          <aside aria-label="연결된 Notion 워크스페이스" className="workspaceList">
            <div className="workspaceListHeading">
              <span>워크스페이스</span>
              <a
                href="/auth/notion/start?returnTo=%2F"
                title="Notion 워크스페이스 추가"
              >
                추가
              </a>
            </div>
            {connections.map((connection) => (
              <button
                aria-pressed={
                  connection.connectionId === selectedConnectionId
                }
                className="workspaceButton"
                key={connection.connectionId}
                onClick={() =>
                  setSelectedConnectionId(connection.connectionId)
                }
                type="button"
              >
                <WorkspaceIcon connection={connection} />
                <span>{connection.workspaceName}</span>
              </button>
            ))}
          </aside>

          <div className="pagePanel">
            <div className="pagePanelHeading">
              <div>
                <span className="panelLabel">공유된 문서</span>
                <strong>
                  {selectedConnection?.workspaceName ?? "워크스페이스"}
                </strong>
              </div>
              {pageState === "ready" ? (
                <div className="pageMetrics">
                  <span className="pageCount">문서 {pages.length}개</span>
                  <span className="pageCount">
                    보관 중 {selectedStoredCount}개
                  </span>
                </div>
              ) : null}
            </div>

            {boardState === "error" ? (
              <p className="boardNotice" role="status">
                브라우저 저장소를 사용할 수 없습니다. 저장 공간 또는 개인정보 보호
                설정을 확인해 주세요.
              </p>
            ) : null}
            {pageState === "loading" ? (
              <StatusPanel message="Notion 문서를 불러오고 있습니다." compact />
            ) : null}
            {pageState === "error" ? (
              <StatusPanel
                action={() => setReloadKey((value) => value + 1)}
                actionLabel="다시 불러오기"
                compact
                message={pageError}
              />
            ) : null}
            {pageState === "ready" && pages.length === 0 ? (
              <StatusPanel
                compact
                message="이 연결에 공유된 페이지가 없습니다. Notion에서 연결의 페이지 접근 권한을 확인해 주세요."
              />
            ) : null}
            {pageState === "ready" && pages.length > 0 ? (
              <PageTree
                boardRecordsByPageKey={boardRecordsByPageKey}
                connectionId={selectedConnectionId ?? ""}
                onInspectStructure={inspectPageStructure}
                onToggleVisibility={togglePageVisibility}
                pages={pages}
                pendingPageIds={pendingPageIds}
              />
            ) : null}
            {boardState === "ready" ? (
              <KanbanBoard
                connectionNames={connectionNames}
                onMove={moveBoardRecord}
                onPublish={publishBoardRecord}
                onRemove={removeBoardRecord}
                publishErrors={publishErrors}
                records={kanbanRecords}
              />
            ) : null}
          </div>
        </div>
      ) : null}

          {sessionState === "signed-in" ? (
            <GitHubPagesTarget githubLogin={githubLogin} />
          ) : null}
        </section>
      )}
    </>
  );
}

function PageTree({
  boardRecordsByPageKey,
  connectionId,
  onInspectStructure,
  onToggleVisibility,
  pages,
  pendingPageIds,
}: {
  boardRecordsByPageKey: ReadonlyMap<string, BoardRecord>;
  connectionId: string;
  onInspectStructure: (page: PageSummary) => Promise<OutlineNode[]>;
  onToggleVisibility: (page: PageSummary) => Promise<void>;
  pages: PageSummary[];
  pendingPageIds: ReadonlySet<string>;
}) {
  const ids = new Set(pages.map((page) => page.providerPageId));
  const pagesById = new Map(
    pages.map((page) => [page.providerPageId, page]),
  );
  const children = new Map<string, PageSummary[]>();
  for (const page of pages) {
    if (page.parentPageId === null || !ids.has(page.parentPageId)) {
      continue;
    }
    const siblings = children.get(page.parentPageId) ?? [];
    siblings.push(page);
    children.set(page.parentPageId, siblings);
  }
  const roots = pages.filter(
    (page) =>
      page.parentContainerId === null &&
      (page.parentPageId === null || !ids.has(page.parentPageId)),
  );

  return (
    <ul className="pageTree">
      {roots.map((page) => (
        <PageNode
          ancestors={new Set()}
          boardRecordsByPageKey={boardRecordsByPageKey}
          childPagesByParent={children}
          connectionId={connectionId}
          key={`${connectionId}:${page.providerPageId}`}
          onInspectStructure={onInspectStructure}
          onToggleVisibility={onToggleVisibility}
          page={page}
          pagesById={pagesById}
          pendingPageIds={pendingPageIds}
        />
      ))}
    </ul>
  );
}

function PageNode({
  ancestors,
  boardRecordsByPageKey,
  childPagesByParent,
  connectionId,
  onInspectStructure,
  onToggleVisibility,
  page,
  pagesById,
  pendingPageIds,
}: {
  ancestors: ReadonlySet<string>;
  boardRecordsByPageKey: ReadonlyMap<string, BoardRecord>;
  childPagesByParent: ReadonlyMap<string, PageSummary[]>;
  connectionId: string;
  onInspectStructure: (page: PageSummary) => Promise<OutlineNode[]>;
  onToggleVisibility: (page: PageSummary) => Promise<void>;
  page: PageSummary;
  pagesById: ReadonlyMap<string, PageSummary>;
  pendingPageIds: ReadonlySet<string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [outline, setOutline] = useState<OutlineNode[] | null>(null);
  const [outlineState, setOutlineState] =
    useState<StructureInspectionState>("idle");
  const automaticInspectionKey = useRef<string | null>(null);
  const childPages = childPagesByParent.get(page.providerPageId) ?? [];
  const cycle = ancestors.has(page.providerPageId);
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(page.providerPageId);
  const pageKey = boardPageKey(connectionId, page.providerPageId);
  const record = boardRecordsByPageKey.get(pageKey);
  const isContainer = record?.pageRole === "container";
  const inspectionIsCurrent =
    record?.hasNavigableChildren !== null &&
    record?.structureSourceLastEditedAt === page.lastEditedAt;
  const cachedHasChildren =
    inspectionIsCurrent && record?.hasNavigableChildren === true;
  const hasDiscoveredChildren =
    page.hasChildren || childPages.length > 0;
  const hasStructuralChildren = hasConfirmedNavigableChildren({
    discoveredChildCount:
      (hasDiscoveredChildren ? 1 : 0) +
      (cachedHasChildren ? 1 : 0),
    outlineNodeCount: outline?.length ?? 0,
    outlineState,
  });
  const hasChildren =
    !cycle && (isContainer || hasStructuralChildren);
  const visible = record?.isVisible ?? false;
  const pending = pendingPageIds.has(pageKey);
  const actionAvailability = pageActionAvailability({
    inspectionIsCurrent,
    inspectionState: outlineState,
    recordIsAvailable: record !== undefined,
  });
  const primaryAction = pagePrimaryAction({
    actionAvailability,
    isContainer,
    pending,
  });

  useEffect(() => {
    const inspectionKey = `${page.providerPageId}:${page.lastEditedAt}`;
    if (
      record === undefined ||
      inspectionIsCurrent ||
      automaticInspectionKey.current === inspectionKey
    ) {
      return;
    }
    automaticInspectionKey.current = inspectionKey;
    void onInspectStructure(page)
      .then((nextOutline) => {
        setOutline(nextOutline);
        setOutlineState("ready");
      })
      .catch(() => {
        setOutline([]);
        setOutlineState("error");
      });
  }, [
    inspectionIsCurrent,
    onInspectStructure,
    page,
    record,
  ]);

  async function loadOutline(): Promise<void> {
    if (outlineState === "loading" || outlineState === "ready") {
      return;
    }
    setOutlineState("loading");
    try {
      setOutline(await onInspectStructure(page));
      setOutlineState("ready");
    } catch {
      setOutline([]);
      setOutlineState("error");
    }
  }

  async function toggleExpanded(): Promise<void> {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    await loadOutline();
  }

  return (
    <li className="pageTreeItem">
      <div className="pageRow">
        <button
          aria-expanded={hasChildren ? expanded : undefined}
          className="pageToggle"
          disabled={!hasChildren}
          onClick={() => void toggleExpanded()}
          type="button"
        >
          <span aria-hidden="true">{hasChildren ? (expanded ? "−" : "+") : "·"}</span>
          <PageIcon isContainer={isContainer} page={page} />
          <span className="pageTitle">{page.title}</span>
        </button>
        <div className="pageActions">
          <time dateTime={page.lastEditedAt}>
            {formatEditedAt(page.lastEditedAt)}
          </time>
          {primaryAction === "loading" ? (
            <span
              aria-live="polite"
              className="draftButton added pageActionStatus"
              role="status"
            >
              {pending ? "저장 중" : "판별 중"}
            </span>
          ) : null}
          {primaryAction === "retry" ? (
            <button
              aria-label={`${page.title} 구조 다시 확인`}
              className="draftButton"
              onClick={() => void loadOutline()}
              type="button"
            >
              구조 다시 확인
            </button>
          ) : null}
          {primaryAction === "visibility" ? (
            <button
              aria-label={`${page.title}을 칸반에서 ${visible ? "숨기기" : "표시하기"}`}
              className={
                visible ? "draftButton added" : "draftButton"
              }
              onClick={() => void onToggleVisibility(page)}
              type="button"
            >
              {visible ? "숨기기" : "표시하기"}
            </button>
          ) : null}
        </div>
      </div>
      {hasChildren && expanded ? (
        <ul>
          {outlineState === "loading" ? (
            <li className="boardNotice">내부 토글을 불러오는 중입니다.</li>
          ) : null}
          {outlineState === "error" ? (
            <li className="boardNotice">
              내부 토글을 불러오지 못해 페이지 계층만 표시합니다.
            </li>
          ) : null}
          {outlineState === "ready" || outlineState === "error" ? (
            <PageChildren
              ancestors={nextAncestors}
              boardRecordsByPageKey={boardRecordsByPageKey}
              childPages={childPages}
              childPagesByParent={childPagesByParent}
              connectionId={connectionId}
              onInspectStructure={onInspectStructure}
              onToggleVisibility={onToggleVisibility}
              outline={outline ?? []}
              pagesById={pagesById}
              pendingPageIds={pendingPageIds}
            />
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

function PageChildren({
  ancestors,
  boardRecordsByPageKey,
  childPages,
  childPagesByParent,
  connectionId,
  onInspectStructure,
  onToggleVisibility,
  outline,
  pagesById,
  pendingPageIds,
}: {
  ancestors: ReadonlySet<string>;
  boardRecordsByPageKey: ReadonlyMap<string, BoardRecord>;
  childPages: PageSummary[];
  childPagesByParent: ReadonlyMap<string, PageSummary[]>;
  connectionId: string;
  onInspectStructure: (page: PageSummary) => Promise<OutlineNode[]>;
  onToggleVisibility: (page: PageSummary) => Promise<void>;
  outline: OutlineNode[];
  pagesById: ReadonlyMap<string, PageSummary>;
  pendingPageIds: ReadonlySet<string>;
}) {
  const outlineIds = new Set(outline.map((node) => node.nodeId));
  const outlineChildren = new Map<string, OutlineNode[]>();
  const roots: OutlineNode[] = [];
  for (const node of outline) {
    if (
      node.parentNodeId === null ||
      !outlineIds.has(node.parentNodeId)
    ) {
      roots.push(node);
      continue;
    }
    const siblings = outlineChildren.get(node.parentNodeId) ?? [];
    siblings.push(node);
    outlineChildren.set(node.parentNodeId, siblings);
  }
  const representedPageIds = new Set(
    outline
      .filter((node) => node.kind === "page")
      .flatMap((node) =>
        node.providerId === null ? [] : [node.providerId],
      ),
  );
  const databaseIds = new Set(
    outline
      .filter((node) => node.kind === "database")
      .flatMap((node) =>
        node.providerId === null ? [] : [node.providerId],
      ),
  );
  const databasePages = new Map<string, PageSummary[]>();
  for (const page of childPages) {
    if (
      page.parentContainerId === null ||
      !databaseIds.has(page.parentContainerId)
    ) {
      continue;
    }
    const siblings = databasePages.get(page.parentContainerId) ?? [];
    siblings.push(page);
    databasePages.set(page.parentContainerId, siblings);
  }
  const fallbackPages = childPages.filter(
    (page) =>
      !representedPageIds.has(page.providerPageId) &&
      (page.parentContainerId === null ||
        !databaseIds.has(page.parentContainerId)),
  );

  return (
    <>
      {roots.map((node) => (
        <OutlineBranch
          ancestors={ancestors}
          boardRecordsByPageKey={boardRecordsByPageKey}
          childPagesByParent={childPagesByParent}
          connectionId={connectionId}
          databasePages={databasePages}
          key={node.nodeId}
          node={node}
          onInspectStructure={onInspectStructure}
          onToggleVisibility={onToggleVisibility}
          outlineChildren={outlineChildren}
          pagesById={pagesById}
          pendingPageIds={pendingPageIds}
        />
      ))}
      {fallbackPages.map((child) => (
        <PageNode
          ancestors={ancestors}
          boardRecordsByPageKey={boardRecordsByPageKey}
          childPagesByParent={childPagesByParent}
          connectionId={connectionId}
          key={child.providerPageId}
          onInspectStructure={onInspectStructure}
          onToggleVisibility={onToggleVisibility}
          page={child}
          pagesById={pagesById}
          pendingPageIds={pendingPageIds}
        />
      ))}
    </>
  );
}

function OutlineBranch({
  ancestors,
  boardRecordsByPageKey,
  childPagesByParent,
  connectionId,
  databasePages,
  node,
  onInspectStructure,
  onToggleVisibility,
  outlineChildren,
  pagesById,
  pendingPageIds,
}: {
  ancestors: ReadonlySet<string>;
  boardRecordsByPageKey: ReadonlyMap<string, BoardRecord>;
  childPagesByParent: ReadonlyMap<string, PageSummary[]>;
  connectionId: string;
  databasePages: ReadonlyMap<string, PageSummary[]>;
  node: OutlineNode;
  onInspectStructure: (page: PageSummary) => Promise<OutlineNode[]>;
  onToggleVisibility: (page: PageSummary) => Promise<void>;
  outlineChildren: ReadonlyMap<string, OutlineNode[]>;
  pagesById: ReadonlyMap<string, PageSummary>;
  pendingPageIds: ReadonlySet<string>;
}) {
  const [expanded, setExpanded] = useState(false);
  if (node.kind === "page") {
    const page =
      node.providerId === null
        ? undefined
        : pagesById.get(node.providerId);
    return page === undefined ? null : (
      <PageNode
        ancestors={ancestors}
        boardRecordsByPageKey={boardRecordsByPageKey}
        childPagesByParent={childPagesByParent}
        connectionId={connectionId}
        onInspectStructure={onInspectStructure}
        onToggleVisibility={onToggleVisibility}
        page={page}
        pagesById={pagesById}
        pendingPageIds={pendingPageIds}
      />
    );
  }

  const children = outlineChildren.get(node.nodeId) ?? [];
  const containedPages =
    node.kind === "database" && node.providerId !== null
      ? (databasePages.get(node.providerId) ?? [])
      : [];
  const hasChildren = children.length > 0 || containedPages.length > 0;
  return (
    <li className="pageTreeItem">
      <div className="pageRow">
        <button
          aria-expanded={hasChildren ? expanded : undefined}
          className="pageToggle"
          disabled={!hasChildren}
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          <span aria-hidden="true">
            {hasChildren ? (expanded ? "−" : "+") : "·"}
          </span>
          <span aria-hidden="true" className="documentIcon">
            {node.kind === "toggle"
              ? "⌄"
              : node.kind === "group"
                ? "◫"
                : "▦"}
          </span>
          <span className="pageTitle">{node.title}</span>
        </button>
      </div>
      {hasChildren && expanded ? (
        <ul>
          {children.map((child) => (
            <OutlineBranch
              ancestors={ancestors}
              boardRecordsByPageKey={boardRecordsByPageKey}
              childPagesByParent={childPagesByParent}
              connectionId={connectionId}
              databasePages={databasePages}
              key={child.nodeId}
              node={child}
              onInspectStructure={onInspectStructure}
              onToggleVisibility={onToggleVisibility}
              outlineChildren={outlineChildren}
              pagesById={pagesById}
              pendingPageIds={pendingPageIds}
            />
          ))}
          {containedPages.map((page) => (
            <PageNode
              ancestors={ancestors}
              boardRecordsByPageKey={boardRecordsByPageKey}
              childPagesByParent={childPagesByParent}
              connectionId={connectionId}
              key={page.providerPageId}
              onInspectStructure={onInspectStructure}
              onToggleVisibility={onToggleVisibility}
              page={page}
              pagesById={pagesById}
              pendingPageIds={pendingPageIds}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function PageIcon({
  isContainer,
  page,
}: {
  isContainer: boolean;
  page: PageSummary;
}) {
  if (isContainer) {
    return (
      <span aria-hidden="true" className="documentIcon">
        ▾
      </span>
    );
  }
  return page.iconUrl === null ? (
    <span aria-hidden="true" className="documentIcon">
      ▤
    </span>
  ) : (
    <span
      aria-hidden="true"
      className="documentIcon image"
      style={{ backgroundImage: `url(${JSON.stringify(page.iconUrl)})` }}
    />
  );
}

function WorkspaceIcon({ connection }: { connection: Connection }) {
  if (
    connection.workspaceIcon !== null &&
    /^https?:\/\//.test(connection.workspaceIcon)
  ) {
    return (
      <span
        aria-hidden="true"
        className="workspaceIcon image"
        style={{
          backgroundImage: `url(${JSON.stringify(connection.workspaceIcon)})`,
        }}
      />
    );
  }
  return (
    <span aria-hidden="true" className="workspaceIcon">
      {connection.workspaceIcon ?? connection.workspaceName.slice(0, 1)}
    </span>
  );
}

function StatusPanel({
  action,
  actionHref,
  actionLabel,
  compact = false,
  message,
}: {
  action?: () => void;
  actionHref?: string;
  actionLabel?: string;
  compact?: boolean;
  message: string;
}) {
  return (
    <div className={compact ? "statusPanel compact" : "statusPanel"}>
      <p>{message}</p>
      {actionHref !== undefined && actionLabel !== undefined ? (
        <a href={actionHref}>{actionLabel}</a>
      ) : null}
      {action !== undefined && actionLabel !== undefined ? (
        <button onClick={action} type="button">
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function parseConnections(value: unknown): Connection[] {
  if (!Array.isArray(value)) {
    throw new Error("invalid_connections");
  }
  return value.map((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof item.connectedAt !== "number" ||
      typeof item.connectionId !== "string" ||
      !(
        item.workspaceIcon === null ||
        typeof item.workspaceIcon === "string"
      ) ||
      typeof item.workspaceName !== "string"
    ) {
      throw new Error("invalid_connection");
    }
    return item as Connection;
  });
}

function parsePages(value: unknown): PageSummary[] {
  if (!Array.isArray(value)) {
    throw new Error("invalid_pages");
  }
  const ids = new Set<string>();
  return value.map((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof item.hasChildren !== "boolean" ||
      !(item.iconUrl === null || typeof item.iconUrl === "string") ||
      typeof item.lastEditedAt !== "string" ||
      !(
        item.parentContainerId === null ||
        typeof item.parentContainerId === "string"
      ) ||
      !(
        item.parentPageId === null ||
        typeof item.parentPageId === "string"
      ) ||
      typeof item.providerPageId !== "string" ||
      typeof item.title !== "string" ||
      Number.isNaN(Date.parse(item.lastEditedAt)) ||
      ids.has(item.providerPageId)
    ) {
      throw new Error("invalid_page");
    }
    ids.add(item.providerPageId);
    return item as PageSummary;
  });
}

function parseOutline(value: unknown): OutlineNode[] {
  if (!Array.isArray(value)) {
    throw new Error("invalid_outline");
  }
  const ids = new Set<string>();
  return value.map((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      !(
        item.kind === "database" ||
        item.kind === "group" ||
        item.kind === "page" ||
        item.kind === "toggle"
      ) ||
      typeof item.nodeId !== "string" ||
      !(
        item.parentNodeId === null ||
        typeof item.parentNodeId === "string"
      ) ||
      !(
        item.providerId === null ||
        typeof item.providerId === "string"
      ) ||
      typeof item.title !== "string" ||
      ids.has(item.nodeId)
    ) {
      throw new Error("invalid_outline_node");
    }
    ids.add(item.nodeId);
    return item as OutlineNode;
  });
}

function pageErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Notion 문서를 불러오지 못했습니다.";
  }
  if (error.message === "notion_access_denied") {
    return "Notion 접근 권한이 만료되었거나 철회되었습니다. 워크스페이스를 다시 연결해 주세요.";
  }
  if (error.message === "notion_rate_limited") {
    return "Notion 요청 한도에 도달했습니다. 잠시 뒤 다시 시도해 주세요.";
  }
  return "Notion 문서를 불러오지 못했습니다.";
}


async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function parsePublishResult(value: unknown): {
  commitSha: string;
  contentHash: string;
  pageUrl: string;
} | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("commitSha" in value) ||
    typeof value.commitSha !== "string" ||
    !/^[a-f0-9]{40,64}$/.test(value.commitSha) ||
    !("contentHash" in value) ||
    typeof value.contentHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.contentHash) ||
    !("pageUrl" in value) ||
    typeof value.pageUrl !== "string"
  ) {
    return null;
  }
  try {
    const pageUrl = new URL(value.pageUrl);
    if (pageUrl.protocol !== "https:") {
      return null;
    }
  } catch {
    return null;
  }
  return {
    commitSha: value.commitSha,
    contentHash: value.contentHash,
    pageUrl: value.pageUrl,
  };
}

function parsePublishStatus(value: unknown): {
  state: "failed" | "in_progress" | "queued" | "succeeded";
} | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("state" in value) ||
    !["failed", "in_progress", "queued", "succeeded"].includes(
      String(value.state),
    )
  ) {
    return null;
  }
  return {
    state: value.state as
      | "failed"
      | "in_progress"
      | "queued"
      | "succeeded",
  };
}

function pollingDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function boardPageKey(connectionId: string, providerPageId: string): string {
  return `${connectionId}:${providerPageId}`;
}
