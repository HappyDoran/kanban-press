"use client";

// 게시 전 프리뷰(디자인 기획 6.1–6.3). 블로그 template과 같은 class·CSS(BLOG_CSS)로 그려서
// 실제 글 상세·홈과 같은 구조를 보여준다. 블로그 안의 이동 링크는 프리뷰 밖으로 나가지 않도록 href 없이 둔다.
import { BLOG_CSS } from "@notion-kanban-blog/publisher";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { ApiError, fetchPublishPreview } from "../lib/client/api";
import type { PreviewBlock, PreviewRichText, PublishPreviewResponse } from "../lib/publish/preview";

import { RetryAction } from "./retry-action";

export interface PublishPreviewTarget {
  connectionId: string;
  providerPageId: string;
  title: string;
}

type PreviewState =
  | { kind: "error"; code: string; retryAt: number | null }
  | { kind: "loading"; slow: boolean }
  | { kind: "ready"; preview: PublishPreviewResponse };

const VIEWPORTS = [
  ["mobile", "모바일 390"],
  ["tablet", "태블릿 768"],
  ["desktop", "데스크톱 1280"],
] as const;
type Viewport = (typeof VIEWPORTS)[number][0];

export function PublishPreviewDialog({
  onClose,
  siteOwner,
  target,
}: {
  onClose: () => void;
  siteOwner: string;
  target: PublishPreviewTarget;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLParagraphElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PreviewState>({ kind: "loading", slow: false });

  // 열 때 modal로 띄우고 제목으로 focus, 닫으면 연 버튼으로 focus를 돌려준다.
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    titleRef.current?.focus();
    return () => {
      if (dialog?.open === true && typeof dialog.close === "function") dialog.close();
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const slowTimer = window.setTimeout(
      () => setState((current) => (current.kind === "loading" ? { kind: "loading", slow: true } : current)),
      10_000,
    );
    void (async () => {
      setState({ kind: "loading", slow: false });
      try {
        const preview = await fetchPublishPreview(target.connectionId, target.providerPageId, controller.signal);
        setState({ kind: "ready", preview });
      } catch (error) {
        if (!controller.signal.aborted) {
          setState(
            error instanceof ApiError
              ? { kind: "error", code: error.code, retryAt: error.retryAt }
              : { kind: "error", code: "preview_unavailable", retryAt: null },
          );
        }
      } finally {
        window.clearTimeout(slowTimer);
      }
    })();
    return () => {
      controller.abort();
      window.clearTimeout(slowTimer);
    };
  }, [attempt, target.connectionId, target.providerPageId]);

  return (
    <dialog
      aria-describedby="publish-preview-description"
      aria-labelledby="publish-preview-title"
      className="previewDialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={dialogRef}
    >
      <div className="previewDialogHeader">
        {/* 프리뷰 안의 글 제목이 h1이므로 dialog 제목은 heading으로 두지 않는다. */}
        <p className="previewTitle" id="publish-preview-title" ref={titleRef} tabIndex={-1}>
          <span>프리뷰</span> {target.title}
        </p>
        <button className="buttonSecondary" onClick={onClose} type="button">
          닫기
        </button>
      </div>
      <p className="previewNotice" id="publish-preview-description">
        이 화면은 저장되지 않습니다. 게시할 때 최신 Notion 내용을 다시 읽어 생성합니다.
      </p>
      {state.kind === "loading" ? (
        <div className="previewStatus" role="status">
          <span aria-hidden="true" className="previewSkeleton" />
          <strong>최신 Notion 내용을 불러오는 중</strong>
          {state.slow ? <span>평소보다 오래 걸리고 있습니다. 닫은 뒤 다시 시도할 수 있습니다.</span> : null}
        </div>
      ) : null}
      {state.kind === "error" ? (
        <div className="previewStatus error" role="alert">
          <strong>프리뷰를 만들지 못했습니다</strong>
          <p>{previewErrorMessage(state.code)}</p>
          <RetryAction label="다시 불러오기" onRetry={() => setAttempt((value) => value + 1)} retryAt={state.retryAt} />
        </div>
      ) : null}
      {state.kind === "ready" ? <PublishPreviewContent preview={state.preview} siteOwner={siteOwner} /> : null}
      <p className="previewNotice">게시하려면 프리뷰를 닫고 카드를 ‘게시 중’으로 옮기세요.</p>
    </dialog>
  );
}

export function PublishPreviewContent({
  preview,
  siteOwner = "blog",
}: {
  preview: PublishPreviewResponse;
  siteOwner?: string;
}) {
  const [view, setView] = useState<"home" | "post">("post");
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const { document } = preview;
  return (
    <div className="previewReady">
      {preview.warnings.length > 0 ? (
        <aside aria-label="프리뷰 경고" className="previewWarnings">
          <strong>확인할 내용</strong>
          <ul>
            {preview.warnings.map((warning) => (
              <li key={warning.code}>{warning.message}</li>
            ))}
          </ul>
        </aside>
      ) : null}
      <div className="previewToolbar">
        <div aria-label="프리뷰 화면" className="segmented" role="group">
          <button aria-pressed={view === "post"} onClick={() => setView("post")} type="button">
            글 상세
          </button>
          <button aria-pressed={view === "home"} onClick={() => setView("home")} type="button">
            홈에서 보기
          </button>
        </div>
        <div aria-label="프리뷰 너비" className="segmented previewViewportButtons" role="group">
          {VIEWPORTS.map(([value, label]) => (
            <button aria-pressed={viewport === value} key={value} onClick={() => setViewport(value)} type="button">
              {label}
            </button>
          ))}
        </div>
        <p className="previewFreshness">
          원문 최종 수정 <time dateTime={preview.sourceLastEditedAt}>{formatDate(preview.sourceLastEditedAt)}</time> · 예상
          경로 /posts/{document.slug}/
        </p>
      </div>
      <div className={`previewFrame ${viewport}`}>
        <style>{BLOG_CSS}</style>
        <div className="site-header">
          <div className="site-header-inner">
            <a className="site-brand">{siteOwner}.log</a>
            <div className="site-nav">
              <ul>
                <li>
                  <a aria-current={view === "post" ? "page" : undefined}>전체 글</a>
                </li>
                <li>
                  <a>주제</a>
                </li>
                <li>
                  <a>GitHub</a>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="site-main">
          {view === "post" ? (
            <PreviewPost preview={preview} />
          ) : (
            <PreviewHome preview={preview} siteOwner={siteOwner} />
          )}
        </div>
      </div>
    </div>
  );
}

/** 블로그 `src/pages/posts/[...slug].astro`와 같은 구조. */
function PreviewPost({ preview }: { preview: PublishPreviewResponse }) {
  const { document } = preview;
  const sections = document.blocks.filter((block) => block.kind === "heading" && block.level === 2);
  const withToc = sections.length >= 3;
  return (
    <>
      <div className="breadcrumbs">
        <ol>
          <li>
            <a>홈</a>
            <span aria-hidden="true">/</span>
          </li>
          <li>
            <a>{document.category.name}</a>
            <span aria-hidden="true">/</span>
          </li>
          <li>
            <span>{document.title}</span>
          </li>
        </ol>
      </div>
      <article className={`article-layout ${withToc ? "with-toc" : "without-toc"}`}>
        <header className="post-header">
          <a className="category-link">{document.category.name}</a>
          <h1>{document.title}</h1>
          {document.description ? <p className="post-description">{document.description}</p> : null}
          <div className="post-meta">
            <span>
              게시 <time dateTime={document.publishedAt}>{formatDate(document.publishedAt)}</time>
            </span>
            {document.updatedAt.slice(0, 10) !== document.publishedAt.slice(0, 10) ? (
              <span>
                수정 <time dateTime={document.updatedAt}>{formatDate(document.updatedAt)}</time>
              </span>
            ) : null}
          </div>
          <Tags tags={document.tags} />
        </header>
        {withToc ? (
          <div className="post-toc">
            <h2>목차</h2>
            <ol>
              {sections.map((block, index) =>
                block.kind === "heading" ? (
                  <li key={index}>
                    <RichText parts={block.richText} />
                  </li>
                ) : null,
              )}
            </ol>
          </div>
        ) : null}
        <div className="article-main">
          {/* previewBody: E2E가 프리뷰 본문을 찾는 이름 */}
          <div className="post-body previewBody">
            <Blocks blocks={document.blocks} />
          </div>
        </div>
      </article>
    </>
  );
}

/** 블로그 홈의 소개와 최신 글 카드(`PostCard.astro`)에 이 글이 놓인 모습. */
function PreviewHome({ preview, siteOwner }: { preview: PublishPreviewResponse; siteOwner: string }) {
  const { document } = preview;
  return (
    <>
      <section className="hero">
        <h1>{siteOwner}.log</h1>
        <p>Notion에서 쓰고 GitHub Pages에 쌓아 가는 개발 기록입니다.</p>
      </section>
      <section>
        <div className="section-heading">
          <h2>최신 글</h2>
        </div>
        <div className="post-grid">
          <article className="post-card">
            <div className="post-card-meta">
              <a className="category-link">{document.category.name}</a>
              <time dateTime={document.publishedAt}>{formatDate(document.publishedAt)}</time>
            </div>
            <h3>
              <a className="post-card-title">{document.title}</a>
            </h3>
            {document.description ? <p className="post-card-description">{document.description}</p> : null}
            <Tags limit={3} tags={document.tags} />
          </article>
        </div>
      </section>
    </>
  );
}

function Tags({ limit = Infinity, tags }: { limit?: number; tags: readonly string[] }) {
  if (tags.length === 0) return null;
  const rest = tags.length - Math.min(limit, tags.length);
  return (
    <ul aria-label="태그" className="tag-list">
      {tags.slice(0, limit).map((tag) => (
        <li key={tag}>#{tag}</li>
      ))}
      {rest > 0 ? <li aria-label={`태그 ${rest}개 더 있음`}>+{rest}</li> : null}
    </ul>
  );
}

/** publisher `markdown.ts`가 만드는 Markdown을 Astro가 그린 HTML과 같은 요소로 그린다. 연속 목록 항목은 한 목록으로 묶는다. */
function Blocks({ blocks }: { blocks: readonly PreviewBlock[] }) {
  const content: ReactNode[] = [];
  for (let index = 0; index < blocks.length; ) {
    const block = blocks[index]!;
    if (block.kind === "listItem" || block.kind === "toDo") {
      const start = index;
      const sameList = (candidate: PreviewBlock | undefined) =>
        candidate?.kind === block.kind && (block.kind === "toDo" || ("style" in candidate && candidate.style === block.style));
      while (sameList(blocks[index])) index += 1;
      const items = blocks.slice(start, index);
      const List = block.kind === "listItem" && block.style === "numbered" ? "ol" : "ul";
      content.push(
        <List key={start}>
          {items.map((item, itemIndex) =>
            item.kind === "listItem" || item.kind === "toDo" ? (
              <li key={itemIndex}>
                {item.kind === "toDo" ? (
                  <input aria-label={item.checked ? "완료" : "미완료"} checked={item.checked} disabled type="checkbox" />
                ) : null}
                <RichText parts={item.richText} />
                <Blocks blocks={item.children} />
              </li>
            ) : null,
          )}
        </List>,
      );
      continue;
    }
    content.push(<Block block={block} key={index} />);
    index += 1;
  }
  return content;
}

function Block({ block }: { block: PreviewBlock }) {
  switch (block.kind) {
    case "paragraph":
      return (
        <p>
          <RichText parts={block.richText} />
        </p>
      );
    case "heading": {
      const Heading = `h${block.level}` as const;
      return (
        <Heading>
          <RichText parts={block.richText} />
        </Heading>
      );
    }
    case "quote":
      return (
        <blockquote>
          <p>
            <RichText parts={block.richText} />
          </p>
        </blockquote>
      );
    case "callout":
      return (
        <blockquote>
          <p>
            {block.icon ?? "💡"} <RichText parts={block.richText} />
          </p>
          <Blocks blocks={block.children} />
        </blockquote>
      );
    case "code":
      return (
        <pre>
          <code data-language={block.language}>{block.code}</code>
        </pre>
      );
    case "equation":
      return (
        <div className="notion-equation" role="math">
          <code>{block.expression}</code>
        </div>
      );
    case "image":
      return (
        <figure className="previewImagePlaceholder">
          <div aria-label="이미지 자리표시자" role="img">
            이미지는 이 프리뷰에 표시되지 않습니다
          </div>
          {block.caption.length > 0 ? (
            <figcaption>
              <RichText parts={block.caption} />
            </figcaption>
          ) : null}
        </figure>
      );
    case "linkCard":
      return <ResourceCard caption={block.caption} href={block.href} label="링크" />;
    case "media":
      return (
        <ResourceCard
          caption={block.caption}
          href={block.href}
          label={{ audio: "오디오", file: "첨부 파일", pdf: "PDF", video: "동영상" }[block.mediaType]}
        />
      );
    case "table":
      return <Table block={block} />;
    case "toggle":
      return (
        <details>
          <summary>{block.summary.map((part) => part.text).join("") || "자세히 보기"}</summary>
          <Blocks blocks={block.children} />
        </details>
      );
    case "divider":
      return <hr />;
    case "listItem":
    case "toDo":
      return <Blocks blocks={[block]} />;
  }
}

function Table({ block }: { block: Extract<PreviewBlock, { kind: "table" }> }) {
  const row = (cells: PreviewRichText[][], rowIndex: number) => (
    <tr key={rowIndex}>
      {cells.map((cell, columnIndex) =>
        (block.hasColumnHeader && rowIndex === 0) || (block.hasRowHeader && columnIndex === 0) ? (
          <th key={columnIndex} scope={rowIndex === 0 ? "col" : "row"}>
            <RichText parts={cell} />
          </th>
        ) : (
          <td key={columnIndex}>
            <RichText parts={cell} />
          </td>
        ),
      )}
    </tr>
  );
  const offset = block.hasColumnHeader ? 1 : 0;
  return (
    <div className="notion-table-wrap">
      <table>
        {offset === 1 ? <thead>{block.rows.slice(0, 1).map(row)}</thead> : null}
        <tbody>{block.rows.slice(offset).map((cells, index) => row(cells, index + offset))}</tbody>
      </table>
    </div>
  );
}

function ResourceCard({ caption, href, label }: { caption: readonly PreviewRichText[]; href: string | null; label: string }) {
  const content = (
    <>
      <span className="notion-resource-label">{label}</span>
      <span>{caption.length > 0 ? <RichText allowLinks={false} parts={caption} /> : label}</span>
    </>
  );
  return href === null ? (
    <div className="notion-resource-card">{content}</div>
  ) : (
    <a className="notion-resource-card" href={href}>
      {content}
    </a>
  );
}

/** Markdown 변환과 같은 중첩 순서: 링크 > 취소선 > 기울임 > 굵게 > 코드. */
function RichText({ allowLinks = true, parts }: { allowLinks?: boolean; parts: readonly PreviewRichText[] }) {
  return parts.map((part, index) => {
    let content: ReactNode = part.code ? <code>{part.text}</code> : part.text;
    if (!part.code && part.bold) content = <strong>{content}</strong>;
    if (!part.code && part.italic) content = <em>{content}</em>;
    if (!part.code && part.strikethrough) content = <del>{content}</del>;
    if (allowLinks && part.href !== null) content = <a href={part.href}>{content}</a>;
    return <span key={index}>{content}</span>;
  });
}

export function previewErrorMessage(code: string): string {
  switch (code) {
    case "authentication_required":
      return "로그인 세션이 만료되었습니다. GitHub로 다시 로그인해 주세요.";
    case "notion_connection_not_found":
      return "현재 계정이 소유한 Notion 연결을 찾을 수 없습니다. 연결을 다시 확인해 주세요.";
    case "notion_access_denied":
    case "notion_page_mismatch":
      return "Notion 페이지 접근 권한이 없습니다. 아직 게시하지 않았습니다.";
    case "notion_rate_limited":
      return "Notion 요청이 많아 잠시 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
    case "notion_timeout":
      return "Notion 응답 시간이 초과되었습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.";
    case "invalid_blog_metadata":
      return "블로그 속성 형식이 올바르지 않습니다. Notion의 예약 속성을 확인해 주세요.";
    case "notion_unavailable":
    case "notion_invalid_response":
      return "Notion 응답을 확인하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.";
    case "invalid_preview_response":
      return "안전한 프리뷰 응답을 확인하지 못했습니다. 다시 불러와 주세요.";
    default:
      return "응답이 늦거나 연결할 수 없어 프리뷰를 만들지 못했습니다. 다시 시도해 주세요.";
  }
}

/** 블로그 `formatDate`와 같은 형식(UTC 기준 "2026년 11월 10일"). */
function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", { day: "numeric", month: "long", timeZone: "UTC", year: "numeric" }).format(
    new Date(value),
  );
}
