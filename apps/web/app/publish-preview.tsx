"use client";

import { useEffect, useRef, useState } from "react";

import {
  parsePublishPreviewResponse,
  type PreviewBlock,
  type PreviewRichText,
  type PublishPreviewResponse,
} from "../lib/publish/preview";

import type { ReactNode } from "react";

export interface PublishPreviewTarget {
  connectionId: string;
  providerPageId: string;
  title: string;
}

type PreviewState =
  | { kind: "error"; code: string }
  | { kind: "loading"; slow: boolean }
  | { kind: "ready"; preview: PublishPreviewResponse };
type PreviewView = "home" | "post";
type PreviewViewport = "desktop" | "mobile" | "tablet";

export function PublishPreviewDialog({
  onClose,
  target,
}: {
  onClose: () => void;
  target: PublishPreviewTarget;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PreviewState>({
    kind: "loading",
    slow: false,
  });

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
    }
    headingRef.current?.focus();
    return () => {
      if (dialog?.open === true && typeof dialog.close === "function") {
        dialog.close();
      }
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const slowTimer = window.setTimeout(() => {
      setState((current) =>
        current.kind === "loading" ? { kind: "loading", slow: true } : current,
      );
    }, 10_000);

    async function loadPreview(): Promise<void> {
      setState({ kind: "loading", slow: false });
      try {
        const response = await fetch("/api/publish/preview", {
          body: JSON.stringify({
            connectionId: target.connectionId,
            providerPageId: target.providerPageId,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
          signal: controller.signal,
        });
        const payload = await safeJson(response);
        if (!response.ok) {
          setState({ kind: "error", code: parseErrorCode(payload) });
          return;
        }
        const preview = parsePublishPreviewResponse(payload);
        setState(
          preview === null
            ? { kind: "error", code: "invalid_preview_response" }
            : { kind: "ready", preview },
        );
      } catch (error) {
        if (!isAbortError(error)) {
          setState({ kind: "error", code: "preview_unavailable" });
        }
      } finally {
        window.clearTimeout(slowTimer);
      }
    }

    void loadPreview();
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
        <div>
          <p className="eyebrow">Publish preview</p>
          <h2 id="publish-preview-title" ref={headingRef} tabIndex={-1}>
            {target.title} 프리뷰
          </h2>
        </div>
        <button className="previewCloseButton" onClick={onClose} type="button">
          닫기
        </button>
      </div>
      <p className="previewNotice" id="publish-preview-description">
        이 화면은 저장되지 않습니다. 게시할 때 최신 Notion 내용을 다시 읽어
        생성합니다.
      </p>
      {state.kind === "loading" ? (
        <div className="previewLoading" role="status">
          <span aria-hidden="true" className="previewSkeleton" />
          <strong>최신 Notion 내용을 불러오는 중</strong>
          {state.slow ? (
            <span>평소보다 오래 걸리고 있습니다. 닫은 뒤 다시 시도할 수 있습니다.</span>
          ) : null}
        </div>
      ) : null}
      {state.kind === "error" ? (
        <div className="previewError" role="alert">
          <strong>프리뷰를 만들지 못했습니다</strong>
          <p>{previewErrorMessage(state.code)}</p>
          <button onClick={() => setAttempt((value) => value + 1)} type="button">
            다시 불러오기
          </button>
        </div>
      ) : null}
      {state.kind === "ready" ? (
        <PublishPreviewContent preview={state.preview} />
      ) : null}
      <p className="previewPublishHint">
        게시하려면 프리뷰를 닫고 카드를 ‘게시 중’으로 옮기세요.
      </p>
    </dialog>
  );
}

export function PublishPreviewContent({
  preview,
}: {
  preview: PublishPreviewResponse;
}) {
  const [view, setView] = useState<PreviewView>("post");
  const [viewport, setViewport] = useState<PreviewViewport>("desktop");
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
        <div aria-label="프리뷰 화면" className="previewSegmented">
          <button
            aria-pressed={view === "post"}
            onClick={() => setView("post")}
            type="button"
          >
            글 상세
          </button>
          <button
            aria-pressed={view === "home"}
            onClick={() => setView("home")}
            type="button"
          >
            홈에서 보기
          </button>
        </div>
        <div aria-label="프리뷰 너비" className="previewSegmented previewViewportButtons">
          {(["mobile", "tablet", "desktop"] as const).map((value) => (
            <button
              aria-pressed={viewport === value}
              key={value}
              onClick={() => setViewport(value)}
              type="button"
            >
              {value === "mobile" ? "모바일 390" : value === "tablet" ? "태블릿 768" : "데스크톱 1280"}
            </button>
          ))}
        </div>
      </div>
      <p className="previewFreshness">
        원문 최종 수정 <time dateTime={preview.sourceLastEditedAt}>{formatPreviewDate(preview.sourceLastEditedAt)}</time>
      </p>
      <div className={`previewFrame ${viewport}`}>
        <div className="previewSiteHeader">Notion Blog</div>
        {view === "post" ? (
          <PreviewPost preview={preview} />
        ) : (
          <PreviewHome preview={preview} />
        )}
      </div>
    </div>
  );
}

function PreviewPost({ preview }: { preview: PublishPreviewResponse }) {
  const document = preview.document;
  return (
    <article className="previewPost">
      <p className="previewBreadcrumb">홈 / {document.category.name} / {document.title}</p>
      <p className="previewCategory">{document.category.name}</p>
      <h3>{document.title}</h3>
      {document.description ? <p className="previewDescription">{document.description}</p> : null}
      <p className="previewMetadata">
        게시 <time dateTime={document.publishedAt}>{formatPreviewDate(document.publishedAt)}</time>
        {document.updatedAt.slice(0, 10) !== document.publishedAt.slice(0, 10) ? (
          <> · 수정 <time dateTime={document.updatedAt}>{formatPreviewDate(document.updatedAt)}</time></>
        ) : null}
      </p>
      {document.tags.length > 0 ? (
        <ul aria-label="태그" className="previewTags">
          {document.tags.map((tag) => <li key={tag}>#{tag}</li>)}
        </ul>
      ) : null}
      <p className="previewPath">예상 경로 /posts/{document.slug}/</p>
      <div className="previewBody">
        {document.blocks.map((block, index) => (
          <PreviewBlockRenderer block={block} key={index} />
        ))}
      </div>
    </article>
  );
}

function PreviewHome({ preview }: { preview: PublishPreviewResponse }) {
  const document = preview.document;
  return (
    <section className="previewHome">
      <h3>Notion Blog</h3>
      <p>Notion에서 작성하고 GitHub Pages에 차분히 쌓아가는 기록입니다.</p>
      <h4>최신 글</h4>
      <article className="previewHomeCard">
        <span>{document.category.name}</span>
        <h5>{document.title}</h5>
        <p>{document.description}</p>
        <time dateTime={document.publishedAt}>{formatPreviewDate(document.publishedAt)}</time>
      </article>
    </section>
  );
}

function PreviewBlockRenderer({ block }: { block: PreviewBlock }) {
  switch (block.kind) {
    case "paragraph":
      return <p><PreviewRichTextRenderer parts={block.richText} /></p>;
    case "heading": {
      const Heading = block.level === 2 ? "h4" : block.level === 3 ? "h5" : "h6";
      return <Heading><PreviewRichTextRenderer parts={block.richText} /></Heading>;
    }
    case "quote":
      return <blockquote><PreviewRichTextRenderer parts={block.richText} /></blockquote>;
    case "code":
      return <pre><code data-language={block.language}>{block.code}</code></pre>;
    case "image":
      return (
        <figure className="previewImagePlaceholder">
          <div aria-label="이미지 자리표시자" role="img">이미지는 이 프리뷰에 표시되지 않습니다</div>
          {block.caption.length > 0 ? <figcaption><PreviewRichTextRenderer parts={block.caption} /></figcaption> : null}
        </figure>
      );
    case "toggle":
      return (
        <details>
          <summary><PreviewRichTextRenderer parts={block.summary} /></summary>
          {block.children.map((child, index) => <PreviewBlockRenderer block={child} key={index} />)}
        </details>
      );
    case "divider":
      return <hr />;
  }
}

function PreviewRichTextRenderer({ parts }: { parts: readonly PreviewRichText[] }) {
  return parts.map((part, index) => {
    let content: ReactNode = part.text;
    if (part.code) content = <code>{content}</code>;
    if (part.bold) content = <strong>{content}</strong>;
    if (part.italic) content = <em>{content}</em>;
    if (part.strikethrough) content = <s>{content}</s>;
    if (part.href !== null) content = <a href={part.href}>{content}</a>;
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
    case "invalid_blog_metadata":
      return "블로그 속성 형식이 올바르지 않습니다. Notion의 예약 속성을 확인해 주세요.";
    case "notion_unavailable":
      return "Notion 응답을 확인하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.";
    case "invalid_preview_response":
      return "안전한 프리뷰 응답을 확인하지 못했습니다. 다시 불러와 주세요.";
    default:
      return "응답이 늦거나 연결할 수 없어 프리뷰를 만들지 못했습니다. 다시 시도해 주세요.";
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function parseErrorCode(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  ) {
    return value.error;
  }
  return "preview_unavailable";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function formatPreviewDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(value));
}
