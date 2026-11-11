"use client";

// 선택한 Notion 연결의 문서 계층. page는 목록의 부모 관계로, page 안의 토글·그룹·database는 펼칠 때 받아 오는
// outline으로 그린다. 문서 행의 `추가`로 보관 중에 넣는다. 하위 page가 있는 page는 컨테이너(폴더)라 칸반에 오르지 않는다.
import type { NotionOutlineNode } from "@kanban-press/notion";
import { createContext, useContext, useState } from "react";

import { fetchOutline, type PageSummary } from "../lib/client/api";
import { filterRenderableOutline } from "../lib/notion/outline";

import { isContainer, pageKey, suffixOf } from "./use-board";

type OutlineState = "error" | "idle" | "loading" | "ready";

interface TreeContextValue {
  /** 보관 중 목록(하이픈 뺀 page ID). */
  board: ReadonlySet<string>;
  childPagesByParent: ReadonlyMap<string, PageSummary[]>;
  connectionId: string;
  onBoardChange: (page: PageSummary, onBoard: boolean) => void;
  pages: readonly PageSummary[];
  pagesById: ReadonlyMap<string, PageSummary>;
  pendingKeys: ReadonlySet<string>;
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
  board,
  connectionId,
  onBoardChange,
  pages,
  pendingKeys,
  query = "",
}: Pick<TreeContextValue, "board" | "connectionId" | "onBoardChange" | "pendingKeys"> & {
  pages: PageSummary[];
  /** 제목 검색어. 있으면 계층 대신 제목이 맞는 문서를 평평하게 보여준다(database 행 포함). */
  query?: string;
}) {
  const pagesById = new Map(pages.map((page) => [page.providerPageId, page]));
  const childPagesByParent = new Map<string, PageSummary[]>();
  for (const page of pages) {
    if (page.parentPageId !== null && pagesById.has(page.parentPageId)) {
      childPagesByParent.set(page.parentPageId, [...(childPagesByParent.get(page.parentPageId) ?? []), page]);
    }
  }
  const search = normalizeForSearch(query);
  // database 행(parentContainerId)은 그 database outline 아래에서만 보인다.
  const roots =
    search === ""
      ? pages.filter(
          (page) =>
            page.parentContainerId === null && (page.parentPageId === null || !pagesById.has(page.parentPageId)),
        )
      : pages.filter((page) => normalizeForSearch(page.title).includes(search));

  return (
    <TreeContext.Provider
      value={{ board, childPagesByParent, connectionId, onBoardChange, pages, pagesById, pendingKeys }}
    >
      {search === "" ? null : (
        <p className="treeSearchStatus" role="status">
          {roots.length === 0 ? "일치하는 문서가 없습니다." : `문서 ${roots.length}개`}
        </p>
      )}
      <ul className="pageTree">
        {roots.map((page) => (
          <PageNode ancestors={new Set()} key={page.providerPageId} page={page} />
        ))}
      </ul>
    </TreeContext.Provider>
  );
}

/** 검색 비교용: 호환 문자·공백을 정리하고 소문자로 맞춘다. */
export function normalizeForSearch(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function PageNode({ ancestors, page }: { ancestors: ReadonlySet<string>; page: PageSummary }) {
  const tree = useTree();
  const [expanded, setExpanded] = useState(false);
  const [outline, setOutline] = useState<NotionOutlineNode[] | null>(null);
  const [outlineState, setOutlineState] = useState<OutlineState>("idle");

  const childPages = tree.childPagesByParent.get(page.providerPageId) ?? [];
  const container = isContainer(page);
  const hasChildren = !ancestors.has(page.providerPageId) && (container || childPages.length > 0);
  const onBoard = tree.board.has(suffixOf(page.providerPageId));
  const pending = tree.pendingKeys.has(pageKey({ connectionId: tree.connectionId, providerPageId: page.providerPageId }));

  async function loadOutline(): Promise<void> {
    if (outlineState === "loading" || outlineState === "ready") {
      return;
    }
    setOutlineState("loading");
    try {
      setOutline(filterRenderableOutline(await fetchOutline(tree.connectionId, page.providerPageId), tree.pages));
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
          <Chevron expanded={expanded} visible={hasChildren} />
          <PageIcon isContainer={container} page={page} />
          <span className="pageTitle" title={page.title}>
            {page.title}
          </span>
        </button>
        {container ? null : (
          <span className="pageAction">
            <button
              aria-label={`${page.title}을 보관 중에서 ${onBoard ? "빼기" : "넣기"}`}
              aria-pressed={onBoard}
              className={onBoard ? "rowButton onBoard" : "rowButton"}
              disabled={pending}
              onClick={() => tree.onBoardChange(page, !onBoard)}
              type="button"
            >
              {pending ? "저장 중" : onBoard ? "보관 중" : "추가"}
            </button>
          </span>
        )}
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
          <Chevron expanded={expanded} visible={hasChildren} />
          <span aria-hidden="true" className="documentIcon">
            {node.kind === "database" ? <TableIcon /> : <FolderIcon />}
          </span>
          <span className="pageTitle" title={node.title}>
            {node.title}
          </span>
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

/** 펼칠 수 있는 행만 화살표를 보이고, 아니면 같은 폭의 빈 자리를 둔다. */
function Chevron({ expanded, visible }: { expanded: boolean; visible: boolean }) {
  return (
    <span aria-hidden="true" className="treeChevron" data-expanded={expanded || undefined}>
      {visible ? (
        <svg fill="none" height="12" viewBox="0 0 12 12" width="12">
          <path d="M4.5 2.5 8 6l-3.5 3.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
        </svg>
      ) : null}
    </span>
  );
}

function DocumentIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 14 14" width="14">
      <path d="M3.5 1.5h4.5l3 3v8h-7.5z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.2" />
      <path d="M5.5 7.5h3.5M5.5 9.75h3.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 14 14" width="14">
      <path d="M1.5 3.5h4l1.25 1.5h5.75v6.5h-11z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.2" />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 14 14" width="14">
      <rect height="10" rx="1" stroke="currentColor" strokeWidth="1.2" width="11" x="1.5" y="2" />
      <path d="M1.5 5.5h11M5.25 5.5V12" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function PageIcon({ isContainer, page }: { isContainer: boolean; page: PageSummary }) {
  if (isContainer || page.iconUrl === null) {
    return (
      <span aria-hidden="true" className="documentIcon">
        {isContainer ? <FolderIcon /> : <DocumentIcon />}
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
