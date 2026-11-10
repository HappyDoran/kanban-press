"use client";

// 앱 첫 화면의 조립(A 작업대형, 디자인 기획 6.4): 상단 바 → 문서 사이드바 → 칸반.
// 로그인 전이면 소개(marketing)만 보인다. 데이터와 상태는 use-workspace·use-board가 가진다.
import Link from "next/link";
import { type CSSProperties, type ReactNode, useState } from "react";

import { APP_NAME, BrandMark } from "./brand-mark";

import { logout } from "../lib/client/api";

import { GitHubPagesStatus } from "./github-pages-target";
import { KanbanBoard } from "./kanban-board";
import { NotionTree } from "./notion-tree";
import { PublishPreviewDialog, type PublishPreviewTarget } from "./publish-preview";
import { RetryAction } from "./retry-action";
import { useBoard } from "./use-board";
import { useWorkspace } from "./use-workspace";

const CONNECT_NOTION = "/auth/notion/start?returnTo=%2F";

export function NotionBrowser({ marketing }: { marketing?: ReactNode }) {
  const workspace = useWorkspace();
  const { account, connections, connectionState, pageList, selectedConnectionId, session } = workspace;
  const githubLogin = account?.login ?? "";
  const board = useBoard(account?.id ?? null, githubLogin, pageList);
  const [previewTarget, setPreviewTarget] = useState<PublishPreviewTarget | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [query, setQuery] = useState("");
  const sidebar = useSidebarWidth();

  const connectionNames = Object.fromEntries(
    connections.map((connection) => [connection.connectionId, connection.workspaceName]),
  );
  const count = (column: string) => board.kanbanRecords.filter((record) => record.column === column).length;
  const ready = session === "signed-in" && connectionState === "ready";

  return (
    <>
      <header className="topbar">
        <Link className="brand" href="/">
          <BrandMark />
          {APP_NAME}
        </Link>
        {session === "signed-in" ? (
          <>
            <GitHubPagesStatus githubLogin={githubLogin} />
            <div className="account">
              <span className="accountLogin">@{githubLogin}</span>
              <a className="buttonQuiet" href={CONNECT_NOTION}>
                Notion 연결
              </a>
              <button
                className="buttonQuiet"
                onClick={() => void logout().then(() => window.location.reload())}
                type="button"
              >
                로그아웃
              </button>
            </div>
          </>
        ) : null}
      </header>

      {session === "signed-out" ? marketing : null}
      {session === "loading" ? <StatusPanel message="연결 정보를 확인하고 있습니다." /> : null}
      {session === "error" || connectionState === "error" ? (
        <StatusPanel
          action={workspace.reload}
          actionLabel="다시 시도"
          message="계정 또는 연결 정보를 불러오지 못했습니다."
        />
      ) : null}

      {ready ? (
        <div className="workbench" style={sidebar.style}>
          <nav aria-label="Notion 문서" className="sidebar" data-open={sidebarOpen || undefined} id="document-sidebar">
            <button
              aria-expanded={sidebarOpen}
              className="sidebarToggle"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              type="button"
            >
              문서 목록
            </button>
            <div className="sidebarBody">
              <div className="sidebarHeading">
                <span>워크스페이스</span>
                <a href={CONNECT_NOTION}>+ 연결</a>
              </div>
              {connections.length === 0 ? (
                <StatusPanel
                  actionHref={CONNECT_NOTION}
                  actionLabel="Notion 워크스페이스 연결"
                  compact
                  message="아직 연결된 Notion 워크스페이스가 없습니다."
                />
              ) : (
                <div className="workspaceList">
                  {connections.map((connection) => (
                    <button
                      aria-pressed={connection.connectionId === selectedConnectionId}
                      className="workspaceButton"
                      key={connection.connectionId}
                      onClick={() => {
                        setQuery("");
                        workspace.selectConnection(connection.connectionId);
                      }}
                      type="button"
                    >
                      <WorkspaceIcon icon={connection.workspaceIcon} name={connection.workspaceName} />
                      <span className="workspaceName" title={connection.workspaceName}>
                        {connection.workspaceName}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {connections.length > 0 && pageList.state === "loading" ? (
                <div className="treeSkeleton">
                  <p role="status">Notion 문서를 불러오고 있습니다.</p>
                  <span aria-hidden="true" />
                  <span aria-hidden="true" />
                  <span aria-hidden="true" />
                </div>
              ) : null}
              {pageList.state === "error" ? (
                <StatusPanel
                  action={workspace.reload}
                  actionLabel="다시 불러오기"
                  compact
                  message={pageList.error}
                  retryAt={pageList.retryAt}
                />
              ) : null}
              {pageList.state === "ready" && pageList.pages.length === 0 ? (
                <StatusPanel
                  compact
                  message="이 연결에 공유된 페이지가 없습니다. Notion에서 연결의 페이지 접근 권한을 확인해 주세요."
                />
              ) : null}
              {pageList.state === "ready" && pageList.pages.length > 0 && selectedConnectionId !== null ? (
                <input
                  aria-label="문서 제목 검색"
                  className="treeSearch"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setQuery("");
                  }}
                  placeholder="문서 제목 검색"
                  type="search"
                  value={query}
                />
              ) : null}
              {pageList.state === "ready" && pageList.pages.length > 0 && selectedConnectionId !== null ? (
                <NotionTree
                  connectionId={selectedConnectionId}
                  key={selectedConnectionId}
                  onInspectStructure={(page) => board.inspectStructure(selectedConnectionId, page)}
                  onToggleVisibility={(page) => board.toggleVisibility(selectedConnectionId, page)}
                  pages={pageList.pages}
                  pendingKeys={board.pendingKeys}
                  query={query}
                  records={board.records}
                />
              ) : null}
            </div>
          </nav>
          <SidebarResizer {...sidebar} />

          <main className="boardMain" id="main">
            <div className="boardHeading">
              <div>
                <h1>게시 칸반</h1>
                <p>카드를 게시 중으로 끌어 놓으면 최신 Notion 원문으로 게시합니다.</p>
              </div>
              <p className="boardCounts">
                보관 중 {count("stored")}개 · 게시 중 {count("publishing")}개 · 게시 완료 {count("published")}개
              </p>
            </div>
            {board.boardState === "error" ? (
              <p className="notice danger" role="status">
                브라우저 저장소를 사용할 수 없습니다. 저장 공간 또는 개인정보 보호 설정을 확인해 주세요.
              </p>
            ) : null}
            {board.boardState === "ready" ? (
              <KanbanBoard
                connectionNames={connectionNames}
                onMove={board.move}
                onPreview={(record) =>
                  setPreviewTarget({
                    connectionId: record.connectionId,
                    providerPageId: record.providerPageId,
                    title: record.title,
                  })
                }
                onPublish={board.publish}
                onRemove={board.remove}
                onUnpublish={board.unpublish}
                publishFailures={board.failures}
                records={board.kanbanRecords}
              />
            ) : null}
          </main>
        </div>
      ) : null}

      {previewTarget === null ? null : (
        <PublishPreviewDialog
          key={`${previewTarget.connectionId}:${previewTarget.providerPageId}`}
          onClose={() => setPreviewTarget(null)}
          siteOwner={githubLogin}
          target={previewTarget}
        />
      )}
    </>
  );
}

const SIDEBAR_DEFAULT = 288;
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 520;
const SIDEBAR_STORAGE_KEY = "kp.sidebarWidth";

/** 문서 사이드바 너비(px). 이 브라우저에만 기억하고, 저장소를 못 쓰면 기본값으로 동작한다. */
function useSidebarWidth() {
  const [width, setWidthState] = useState<number>(() => {
    try {
      const saved = Number(window.localStorage.getItem(SIDEBAR_STORAGE_KEY));
      return Number.isFinite(saved) && saved > 0 ? clampWidth(saved) : SIDEBAR_DEFAULT;
    } catch {
      return SIDEBAR_DEFAULT;
    }
  });
  const setWidth = (next: number) => {
    const clamped = clampWidth(next);
    setWidthState(clamped);
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(clamped));
    } catch {
      // 저장하지 못해도 이번 화면에서는 바뀐 너비를 쓴다.
    }
  };
  return { setWidth, style: { "--sidebar-width": `${width}px` } as CSSProperties, width };
}

function clampWidth(value: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(value)));
}

/**
 * 사이드바와 칸반 사이 경계선. 끌어서 너비를 바꾸고, 키보드 ←/→(Shift는 크게)·Home·End로도 조절한다.
 * 두 번 누르면 기본 너비로 돌아간다. 900px 미만에서는 CSS로 숨긴다.
 */
function SidebarResizer({ setWidth, width }: ReturnType<typeof useSidebarWidth>) {
  return (
    <div
      aria-controls="document-sidebar"
      aria-label="문서 목록 너비"
      aria-orientation="vertical"
      aria-valuemax={SIDEBAR_MAX}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuenow={width}
      className="sidebarResizer"
      onDoubleClick={() => setWidth(SIDEBAR_DEFAULT)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 48 : 16;
        const next =
          event.key === "ArrowLeft"
            ? width - step
            : event.key === "ArrowRight"
              ? width + step
              : event.key === "Home"
                ? SIDEBAR_MIN
                : event.key === "End"
                  ? SIDEBAR_MAX
                  : null;
        if (next !== null) {
          event.preventDefault();
          setWidth(next);
        }
      }}
      onPointerDown={(event) => {
        const handle = event.currentTarget;
        const left = handle.parentElement?.getBoundingClientRect().left ?? 0;
        handle.setPointerCapture(event.pointerId);
        const move = (moveEvent: PointerEvent) => setWidth(moveEvent.clientX - left);
        const stop = () => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", stop);
          handle.removeEventListener("pointercancel", stop);
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", stop);
        handle.addEventListener("pointercancel", stop);
      }}
      role="separator"
      tabIndex={0}
      title="끌어서 너비 조절 · 두 번 눌러 기본값"
    />
  );
}

function WorkspaceIcon({ icon, name }: { icon: string | null; name: string }) {
  return icon !== null && /^https?:\/\//.test(icon) ? (
    <span
      aria-hidden="true"
      className="workspaceIcon image"
      style={{ backgroundImage: `url(${JSON.stringify(icon)})` }}
    />
  ) : (
    <span aria-hidden="true" className="workspaceIcon">
      {icon ?? name.slice(0, 1)}
    </span>
  );
}

function StatusPanel({
  action,
  actionHref,
  actionLabel,
  compact = false,
  message,
  retryAt = null,
}: {
  action?: () => void;
  actionHref?: string;
  actionLabel?: string;
  compact?: boolean;
  message: string;
  retryAt?: number | null;
}) {
  return (
    <div className={compact ? "statusPanel compact" : "statusPanel"}>
      <p>{message}</p>
      {actionHref !== undefined && actionLabel !== undefined ? (
        <a className="buttonSecondary" href={actionHref}>
          {actionLabel}
        </a>
      ) : null}
      {action !== undefined && actionLabel !== undefined ? (
        <RetryAction label={actionLabel} onRetry={action} retryAt={retryAt} />
      ) : null}
    </div>
  );
}
