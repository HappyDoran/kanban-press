"use client";

// 선택한 Notion 연결의 문서 계층. page는 search 결과의 부모 관계로, page 안의 토글·그룹·database는
// 펼칠 때 받아 오는 outline으로 그린다. 화면에 나타난 미확인 page는 자동으로 구조를 판별한다.
import type { NotionOutlineNode } from "@notion-kanban-blog/notion";
import { createContext, useContext, useEffect, useRef, useState } from "react";

import type { BoardRecord } from "../lib/board/repository";
import {
  hasConfirmedNavigableChildren,
  pageActionAvailability,
  pagePrimaryAction,
  type StructureInspectionState,
} from "../lib/board/page-role";
import type { PageSummary } from "../lib/client/api";
import { formatEditedAt } from "../lib/format-date";

import { pageKey } from "./use-board";

interface TreeContextValue {
  childPagesByParent: ReadonlyMap<string, PageSummary[]>;
  connectionId: string;
  onInspectStructure: (page: PageSummary) => Promise<NotionOutlineNode[]>;
  onToggleVisibility: (page: PageSummary) => Promise<void>;
  pagesById: ReadonlyMap<string, PageSummary>;
  pendingKeys: ReadonlySet<string>;
  recordsByKey: ReadonlyMap<string, BoardRecord>;
}

const TreeContext = createContext<TreeContextValue | null>(null);

function useTree(): TreeContextValue {
  const value = useContext(TreeContext);
  if (value === null) {
    throw new Error("NotionTree context is missing");
  }
  return value;
}

export function NotionTree({
  connectionId,
  onInspectStructure,
  onToggleVisibility,
  pages,
  pendingKeys,
  records,
}: Omit<TreeContextValue, "childPagesByParent" | "pagesById" | "recordsByKey"> & {
  pages: PageSummary[];
  records: readonly BoardRecord[];
}) {
  const pagesById = new Map(pages.map((page) => [page.providerPageId, page]));
  const childPagesByParent = new Map<string, PageSummary[]>();
  for (const page of pages) {
    if (page.parentPageId !== null && pagesById.has(page.parentPageId)) {
      childPagesByParent.set(page.parentPageId, [...(childPagesByParent.get(page.parentPageId) ?? []), page]);
    }
  }
  // database 행(parentContainerId)은 그 database outline 아래에서만 보인다.
  const roots = pages.filter(
    (page) =>
      page.parentContainerId === null && (page.parentPageId === null || !pagesById.has(page.parentPageId)),
  );

  return (
    <TreeContext.Provider
      value={{
        childPagesByParent,
        connectionId,
        onInspectStructure,
        onToggleVisibility,
        pagesById,
        pendingKeys,
        recordsByKey: new Map(records.map((record) => [pageKey(record), record])),
      }}
    >
      <ul className="pageTree">
        {roots.map((page) => (
          <PageNode ancestors={new Set()} key={page.providerPageId} page={page} />
        ))}
      </ul>
    </TreeContext.Provider>
  );
}

function PageNode({ ancestors, page }: { ancestors: ReadonlySet<string>; page: PageSummary }) {
  const tree = useTree();
  const [expanded, setExpanded] = useState(false);
  const [outline, setOutline] = useState<NotionOutlineNode[] | null>(null);
  const [outlineState, setOutlineState] = useState<StructureInspectionState>("idle");
  const autoInspected = useRef<string | null>(null);

  const key = pageKey({ connectionId: tree.connectionId, providerPageId: page.providerPageId });
  const record = tree.recordsByKey.get(key);
  const childPages = tree.childPagesByParent.get(page.providerPageId) ?? [];
  const isContainer = record?.pageRole === "container";
  // 저장된 판별 결과가 현재 Notion 수정 시각 기준이면 다시 묻지 않는다.
  const inspectionIsCurrent =
    record?.hasNavigableChildren !== null && record?.structureSourceLastEditedAt === page.lastEditedAt;
  const hasStructuralChildren = hasConfirmedNavigableChildren({
    discoveredChildCount:
      (page.hasChildren || childPages.length > 0 ? 1 : 0) +
      (inspectionIsCurrent && record?.hasNavigableChildren === true ? 1 : 0),
    outlineNodeCount: outline?.length ?? 0,
    outlineState,
  });
  const hasChildren = !ancestors.has(page.providerPageId) && (isContainer || hasStructuralChildren);
  const visible = record?.isVisible ?? false;
  const pending = tree.pendingKeys.has(key);
  const primaryAction = pagePrimaryAction({
    actionAvailability: pageActionAvailability({
      inspectionIsCurrent,
      inspectionState: outlineState,
      recordIsAvailable: record !== undefined,
    }),
    isContainer,
    pending,
  });

  const { onInspectStructure } = tree;
  useEffect(() => {
    const inspectionKey = `${page.providerPageId}:${page.lastEditedAt}`;
    if (record === undefined || inspectionIsCurrent || autoInspected.current === inspectionKey) {
      return;
    }
    autoInspected.current = inspectionKey;
    void onInspectStructure(page)
      .then((next) => {
        setOutline(next);
        setOutlineState("ready");
      })
      .catch(() => {
        setOutline([]);
        setOutlineState("error");
      });
  }, [inspectionIsCurrent, onInspectStructure, page, record]);

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

  return (
    <li className="pageTreeItem">
      <div className="pageRow">
        <button
          aria-expanded={hasChildren ? expanded : undefined}
          className="pageToggle"
          disabled={!hasChildren}
          onClick={() => {
            setExpanded(!expanded);
            if (!expanded) {
              void loadOutline();
            }
          }}
          type="button"
        >
          <span aria-hidden="true">{hasChildren ? (expanded ? "−" : "+") : "·"}</span>
          <PageIcon isContainer={isContainer} page={page} />
          <span className="pageTitle">{page.title}</span>
        </button>
        {/* 행마다 상태 하나만: 칸반(표시 중, 누르면 숨김) · 추가 · 폴더 · 판별 중 · 구조 다시 확인 */}
        <span className="pageAction">
          {primaryAction === "loading" ? (
            <span aria-live="polite" className="rowStatus" role="status">
              {pending ? "저장 중" : "구조 확인 중…"}
            </span>
          ) : null}
          {primaryAction === "retry" ? (
            <button
              aria-label={`${page.title} 구조 다시 확인`}
              className="rowButton"
              onClick={() => void loadOutline()}
              type="button"
            >
              구조 다시 확인
            </button>
          ) : null}
          {primaryAction === "none" ? <span className="rowStatus">폴더</span> : null}
          {primaryAction === "visibility" ? (
            <button
              aria-label={`${page.title}을 칸반에서 ${visible ? "숨기기" : "표시하기"}`}
              aria-pressed={visible}
              className={visible ? "rowButton onBoard" : "rowButton"}
              onClick={() => void tree.onToggleVisibility(page)}
              title={`원문 수정 ${formatEditedAt(page.lastEditedAt)}`}
              type="button"
            >
              {visible ? "칸반" : "추가"}
            </button>
          ) : null}
        </span>
      </div>
      {hasChildren && expanded ? (
        <ul>
          {outlineState === "loading" ? <li className="boardNotice">내부 토글을 불러오는 중입니다.</li> : null}
          {outlineState === "error" ? (
            <li className="boardNotice">내부 토글을 불러오지 못해 페이지 계층만 표시합니다.</li>
          ) : null}
          {outlineState === "ready" || outlineState === "error" ? (
            <PageChildren
              ancestors={new Set(ancestors).add(page.providerPageId)}
              childPages={childPages}
              outline={outline ?? []}
            />
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * page의 자식: outline 노드(토글·그룹·database·하위 page)를 먼저, outline에 나타나지 않은
 * 하위 page를 그 뒤에 그린다. database 행 page는 해당 database 노드 아래로 들어간다.
 */
function PageChildren({
  ancestors,
  childPages,
  outline,
}: {
  ancestors: ReadonlySet<string>;
  childPages: PageSummary[];
  outline: NotionOutlineNode[];
}) {
  const nodeIds = new Set(outline.map((node) => node.nodeId));
  const outlineChildren = new Map<string, NotionOutlineNode[]>();
  const roots: NotionOutlineNode[] = [];
  for (const node of outline) {
    if (node.parentNodeId === null || !nodeIds.has(node.parentNodeId)) {
      roots.push(node);
    } else {
      outlineChildren.set(node.parentNodeId, [...(outlineChildren.get(node.parentNodeId) ?? []), node]);
    }
  }
  const providerIds = (kind: NotionOutlineNode["kind"]) =>
    new Set(outline.flatMap((node) => (node.kind === kind && node.providerId !== null ? [node.providerId] : [])));
  const outlinedPageIds = providerIds("page");
  const databaseIds = providerIds("database");
  const databasePages = new Map<string, PageSummary[]>();
  for (const page of childPages) {
    if (page.parentContainerId !== null && databaseIds.has(page.parentContainerId)) {
      databasePages.set(page.parentContainerId, [...(databasePages.get(page.parentContainerId) ?? []), page]);
    }
  }
  const remainingPages = childPages.filter(
    (page) =>
      !outlinedPageIds.has(page.providerPageId) &&
      (page.parentContainerId === null || !databaseIds.has(page.parentContainerId)),
  );

  return (
    <>
      {roots.map((node) => (
        <OutlineBranch
          ancestors={ancestors}
          databasePages={databasePages}
          key={node.nodeId}
          node={node}
          outlineChildren={outlineChildren}
        />
      ))}
      {remainingPages.map((page) => (
        <PageNode ancestors={ancestors} key={page.providerPageId} page={page} />
      ))}
    </>
  );
}

function OutlineBranch({
  ancestors,
  databasePages,
  node,
  outlineChildren,
}: {
  ancestors: ReadonlySet<string>;
  databasePages: ReadonlyMap<string, PageSummary[]>;
  node: NotionOutlineNode;
  outlineChildren: ReadonlyMap<string, NotionOutlineNode[]>;
}) {
  const { pagesById } = useTree();
  const [expanded, setExpanded] = useState(false);
  if (node.kind === "page") {
    const page = node.providerId === null ? undefined : pagesById.get(node.providerId);
    return page === undefined ? null : <PageNode ancestors={ancestors} page={page} />;
  }

  const children = outlineChildren.get(node.nodeId) ?? [];
  const containedPages =
    node.kind === "database" && node.providerId !== null ? (databasePages.get(node.providerId) ?? []) : [];
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
          <span aria-hidden="true">{hasChildren ? (expanded ? "−" : "+") : "·"}</span>
          <span aria-hidden="true" className="documentIcon">
            {node.kind === "toggle" ? "⌄" : node.kind === "group" ? "◫" : "▦"}
          </span>
          <span className="pageTitle">{node.title}</span>
        </button>
      </div>
      {hasChildren && expanded ? (
        <ul>
          {children.map((child) => (
            <OutlineBranch
              ancestors={ancestors}
              databasePages={databasePages}
              key={child.nodeId}
              node={child}
              outlineChildren={outlineChildren}
            />
          ))}
          {containedPages.map((page) => (
            <PageNode ancestors={ancestors} key={page.providerPageId} page={page} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function PageIcon({ isContainer, page }: { isContainer: boolean; page: PageSummary }) {
  if (isContainer || page.iconUrl === null) {
    return (
      <span aria-hidden="true" className="documentIcon">
        {isContainer ? "▾" : "▤"}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="documentIcon image"
      style={{ backgroundImage: `url(${JSON.stringify(page.iconUrl)})` }}
    />
  );
}
