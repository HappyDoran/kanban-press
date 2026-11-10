"use client";

// 앱 첫 화면의 조립: 로그인 전이면 소개(marketing), 로그인 후면 문서 트리 + 칸반 + 게시 대상.
// 데이터와 상태는 use-workspace(세션·연결·page)와 use-board(칸반·게시)가 가진다.
import Link from "next/link";
import { type ReactNode, useState } from "react";

import { logout } from "../lib/client/api";

import { GitHubPagesTarget } from "./github-pages-target";
import { KanbanBoard } from "./kanban-board";
import { NotionTree } from "./notion-tree";
import { PublishPreviewDialog, type PublishPreviewTarget } from "./publish-preview";
import { RetryAction } from "./retry-action";
import { useBoard } from "./use-board";
import { useWorkspace } from "./use-workspace";

export function NotionBrowser({ marketing }: { marketing?: ReactNode }) {
  const workspace = useWorkspace();
  const { account, connections, connectionState, pageList, selectedConnectionId, session } = workspace;
  const githubLogin = account?.login ?? "";
  const board = useBoard(account?.id ?? null, githubLogin, pageList);
  const [previewTarget, setPreviewTarget] = useState<PublishPreviewTarget | null>(null);

  const selectedConnection = connections.find((item) => item.connectionId === selectedConnectionId);
  const storedCount = board.records.filter(
    (record) =>
      record.connectionId === selectedConnectionId && record.isVisible && record.pageRole === "document",
  ).length;
  const connectionNames = Object.fromEntries(
    connections.map((connection) => [connection.connectionId, connection.workspaceName]),
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
          {session === "signed-in" ? (
            <>
              <span className="sessionChip">@{githubLogin}</span>
              <Link className="notionLink" href="/auth/notion/start?returnTo=%2F" prefetch={false}>
                Notion 연결
              </Link>
              <button
                className="quietLink"
                onClick={() => void logout().then(() => window.location.reload())}
                type="button"
              >
                로그아웃
              </button>
            </>
          ) : null}
          {session === "signed-out" ? (
            <Link className="loginLink" href="/auth/github/start?returnTo=%2F" prefetch={false}>
              GitHub로 시작
            </Link>
          ) : null}
        </div>
      </nav>

      {session === "signed-out" ? (
        marketing
      ) : (
        <section aria-labelledby="notion-browser-title" className="notionBrowser">
          <div className="sectionHeading">
            <p className="eyebrow">Your workspace</p>
            <div>
              <h2 id="notion-browser-title">Notion 문서 탐색</h2>
              {session === "signed-in" ? (
                <p className="sectionDescription">@{githubLogin} 계정에 연결된 문서만 표시합니다.</p>
              ) : null}
            </div>
          </div>

          {session === "loading" ? <StatusPanel message="연결 정보를 확인하고 있습니다." /> : null}
          {session === "error" || connectionState === "error" ? (
            <StatusPanel
              action={workspace.reload}
              actionLabel="다시 시도"
              message="계정 또는 연결 정보를 불러오지 못했습니다."
            />
          ) : null}
          {session === "signed-in" && connectionState === "ready" && connections.length === 0 ? (
            <StatusPanel
              actionHref="/auth/notion/start?returnTo=%2F"
              actionLabel="Notion 연결"
              message="아직 연결된 Notion 워크스페이스가 없습니다."
            />
          ) : null}

          {session === "signed-in" && connectionState === "ready" && connections.length > 0 ? (
            <div className="documentExplorer">
              <aside aria-label="연결된 Notion 워크스페이스" className="workspaceList">
                <div className="workspaceListHeading">
                  <span>워크스페이스</span>
                  <a href="/auth/notion/start?returnTo=%2F" title="Notion 워크스페이스 추가">
                    추가
                  </a>
                </div>
                {connections.map((connection) => (
                  <button
                    aria-pressed={connection.connectionId === selectedConnectionId}
                    className="workspaceButton"
                    key={connection.connectionId}
                    onClick={() => workspace.selectConnection(connection.connectionId)}
                    type="button"
                  >
                    <WorkspaceIcon icon={connection.workspaceIcon} name={connection.workspaceName} />
                    <span>{connection.workspaceName}</span>
                  </button>
                ))}
              </aside>

              <div className="pagePanel">
                <div className="pagePanelHeading">
                  <div>
                    <span className="panelLabel">공유된 문서</span>
                    <strong>{selectedConnection?.workspaceName ?? "워크스페이스"}</strong>
                  </div>
                  {pageList.state === "ready" ? (
                    <div className="pageMetrics">
                      <span className="pageCount">문서 {pageList.pages.length}개</span>
                      <span className="pageCount">보관 중 {storedCount}개</span>
                    </div>
                  ) : null}
                </div>

                {board.boardState === "error" ? (
                  <p className="boardNotice" role="status">
                    브라우저 저장소를 사용할 수 없습니다. 저장 공간 또는 개인정보 보호 설정을 확인해 주세요.
                  </p>
                ) : null}
                {pageList.state === "loading" ? (
                  <StatusPanel compact message="Notion 문서를 불러오고 있습니다." />
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
                  <NotionTree
                    connectionId={selectedConnectionId}
                    key={selectedConnectionId}
                    onInspectStructure={(page) => board.inspectStructure(selectedConnectionId, page)}
                    onPreview={(page) =>
                      setPreviewTarget({
                        connectionId: selectedConnectionId,
                        providerPageId: page.providerPageId,
                        title: page.title,
                      })
                    }
                    onToggleVisibility={(page) => board.toggleVisibility(selectedConnectionId, page)}
                    pages={pageList.pages}
                    pendingKeys={board.pendingKeys}
                    records={board.records}
                  />
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
                    publishFailures={board.failures}
                    records={board.kanbanRecords}
                  />
                ) : null}
              </div>
            </div>
          ) : null}

          {session === "signed-in" ? <GitHubPagesTarget githubLogin={githubLogin} /> : null}
        </section>
      )}
      {previewTarget === null ? null : (
        <PublishPreviewDialog
          key={`${previewTarget.connectionId}:${previewTarget.providerPageId}`}
          onClose={() => setPreviewTarget(null)}
          target={previewTarget}
        />
      )}
    </>
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
      {actionHref !== undefined && actionLabel !== undefined ? <a href={actionHref}>{actionLabel}</a> : null}
      {action !== undefined && actionLabel !== undefined ? (
        <RetryAction label={actionLabel} onRetry={action} retryAt={retryAt} />
      ) : null}
    </div>
  );
}
