// 브라우저에서 앱 API를 부르고 응답을 검증한다. 서버 응답도 신뢰 경계 밖에서 온 값으로 보고
// zod로 확인한 뒤에만 화면 상태에 넣는다. 오류는 서버가 준 code 문자열로만 전달한다.
import type { NotionOutlineNode } from "@kanban-press/notion";
import { z } from "zod";

import { parsePublishPreviewResponse, type PublishPreviewResponse } from "@/lib/shared/publish-preview";
import { type SiteSettings, siteSettingsSchema } from "@/lib/shared/site-settings";


/** 실패한 API 호출. `code`는 서버 오류 code, `retryAt`은 429 등에서 다시 시도해도 되는 시각. */
export class ApiError extends Error {
  override readonly name = "ApiError";

  constructor(
    readonly code: string,
    readonly retryAt: number | null = null,
    /** 422 게시 내용 거절의 이유(이미지 거절 이유·예약 속성 이름). */
    readonly detail: string | null = null,
  ) {
    super(code);
  }
}

const accountSchema = z.object({
  authenticated: z.literal(true),
  user: z.object({ id: z.string(), login: z.string() }),
});

const connectionSchema = z.object({
  connectedAt: z.number(),
  connectionId: z.string(),
  workspaceIcon: z.string().nullable(),
  workspaceName: z.string(),
});

const pageSchema = z.object({
  hasChildren: z.boolean(),
  iconUrl: z.string().nullable(),
  lastEditedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  parentContainerId: z.string().nullable(),
  parentPageId: z.string().nullable(),
  providerPageId: z.string(),
  title: z.string(),
});

const outlineNodeSchema = z.object({
  kind: z.enum(["database", "group", "page", "toggle"]),
  nodeId: z.string(),
  parentNodeId: z.string().nullable(),
  providerId: z.string().nullable(),
  title: z.string(),
});

const publishResultSchema = z.object({
  commitSha: z.string().regex(/^[a-f0-9]{40,64}$/),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  pageUrl: z.url({ protocol: /^https$/ }),
});

const blogPostsSchema = z.object({
  posts: z.array(
    z.object({
      pageIdSuffix: z.string().regex(/^[a-f0-9]{32}$/),
      pageUrl: z.url({ protocol: /^https$/ }),
      updatedAt: z.iso.datetime().nullable(),
    }),
  ),
});

export type Account = z.infer<typeof accountSchema>["user"];
export type Connection = z.infer<typeof connectionSchema>;
export type PageSummary = z.infer<typeof pageSchema>;
export type PublishResult = z.infer<typeof publishResultSchema>;
export interface PublishStatus {
  actionsUrl: string | null;
  state: "failed" | "in_progress" | "queued" | "succeeded";
}

/** `Retry-After`(초, 1시간 이내)를 다시 시도해도 되는 시각(ms)으로 바꾼다. 없거나 범위 밖이면 `null`. */
export function retryAtFromResponse(
  response: Response,
  now = Date.now(),
): number | null {
  const seconds = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 3_600
    ? now + seconds * 1_000
    : null;
}

/** 로그인하지 않았으면 `null`. */
export async function fetchAccount(signal?: AbortSignal): Promise<Account | null> {
  const response = await fetch("/api/me", { cache: "no-store", signal: signal ?? null });
  if (response.status === 401) {
    return null;
  }
  return parse(accountSchema, await readJson(response)).user;
}

export async function fetchConnections(signal?: AbortSignal): Promise<Connection[]> {
  const response = await fetch("/api/notion/connections", { cache: "no-store", signal: signal ?? null });
  return parse(z.object({ connections: z.array(connectionSchema) }), await readJson(response))
    .connections;
}

export async function fetchPages(connectionId: string, signal?: AbortSignal): Promise<PageSummary[]> {
  const response = await fetch(
    `/api/notion/connections/${encodeURIComponent(connectionId)}/pages`,
    { cache: "no-store", signal: signal ?? null },
  );
  const pages = parse(z.object({ pages: z.array(pageSchema) }), await readJson(response)).pages;
  assertUnique(pages.map((page) => page.providerPageId));
  return pages;
}

export async function fetchOutline(connectionId: string, pageId: string): Promise<NotionOutlineNode[]> {
  const response = await fetch(
    `/api/notion/connections/${encodeURIComponent(connectionId)}/pages/${encodeURIComponent(pageId)}/outline`,
    { cache: "no-store" },
  );
  const outline = parse(z.object({ outline: z.array(outlineNodeSchema) }), await readJson(response))
    .outline;
  assertUnique(outline.map((node) => node.nodeId));
  return outline;
}

export async function requestPublish(connectionId: string, providerPageId: string): Promise<PublishResult> {
  const response = await fetch("/api/publish", {
    body: JSON.stringify({ connectionId, providerPageId }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return parse(publishResultSchema, await readJson(response), "invalid_publish_response");
}

/** 블로그에 올라가 있는 글. `updatedAt`은 게시 때의 Notion 수정 시각이고, 모르면 null이다. */
export interface BlogPost {
  updatedAt: string | null;
  url: string;
}

/** 블로그 저장소에 올라가 있는 글: page ID 접미사 → 글. */
export async function fetchBlogPosts(signal?: AbortSignal): Promise<ReadonlyMap<string, BlogPost>> {
  const response = await fetch("/api/publish/posts", { cache: "no-store", ...(signal === undefined ? {} : { signal }) });
  const { posts } = parse(blogPostsSchema, await readJson(response));
  return new Map(posts.map((post) => [post.pageIdSuffix, { updatedAt: post.updatedAt, url: post.pageUrl }]));
}

const boardSchema = z.object({ pageIds: z.array(z.string().regex(/^[a-f0-9]{32}$/)) });

/** 보관 중 목록(하이픈 뺀 page ID, 추가한 순서). 블로그 저장소의 칸반 branch에 있다. */
export async function fetchBoard(signal?: AbortSignal): Promise<string[]> {
  const response = await fetch("/api/board", { cache: "no-store", ...(signal === undefined ? {} : { signal }) });
  return parse(boardSchema, await readJson(response)).pageIds;
}

/** 보관 중에 넣기·빼기. 서버가 저장한 뒤의 목록을 돌려준다. */
export async function changeBoard(
  action: "add" | "remove",
  connectionId: string,
  providerPageId: string,
): Promise<string[]> {
  const response = await fetch("/api/board", {
    body: JSON.stringify({ connectionId, providerPageId }),
    headers: { "content-type": "application/json" },
    method: action === "add" ? "POST" : "DELETE",
  });
  return parse(boardSchema, await readJson(response)).pageIds;
}

/** 블로그에서 내리기. 저장소에서 글 파일을 지우는 commit을 만든다. */
export async function requestUnpublish(connectionId: string, providerPageId: string): Promise<void> {
  const response = await fetch("/api/publish/unpublish", {
    body: JSON.stringify({ connectionId, providerPageId }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  await readJson(response);
}

/** 블로그 사이트 설정. 저장된 적이 없으면 `stored: false`와 기본값. */
export async function fetchSiteSettings(signal?: AbortSignal): Promise<{ settings: SiteSettings; stored: boolean }> {
  const response = await fetch("/api/blog/settings", { cache: "no-store", ...(signal === undefined ? {} : { signal }) });
  return parse(z.object({ settings: siteSettingsSchema, stored: z.boolean() }), await readJson(response));
}

/** 사이트 설정 저장. 블로그 저장소에 설정 파일 하나를 commit한다. */
export async function saveSiteSettings(settings: SiteSettings): Promise<void> {
  const response = await fetch("/api/blog/settings", {
    body: JSON.stringify(settings),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });
  await readJson(response);
}

/** 게시 전 프리뷰. 서버 응답을 zod로 다시 검증한다. */
export async function fetchPublishPreview(
  connectionId: string,
  providerPageId: string,
  signal: AbortSignal,
): Promise<PublishPreviewResponse> {
  const response = await fetch("/api/publish/preview", {
    body: JSON.stringify({ connectionId, providerPageId }),
    headers: { "content-type": "application/json" },
    method: "POST",
    signal,
  });
  const preview = parsePublishPreviewResponse(await readJson(response));
  if (preview === null) {
    throw new ApiError("invalid_preview_response");
  }
  return preview;
}

export async function fetchPublishStatus(commitSha: string, githubLogin: string): Promise<PublishStatus> {
  const response = await fetch(`/api/publish/status?commitSha=${encodeURIComponent(commitSha)}`, {
    cache: "no-store",
  });
  const status = parsePublishStatus(await readJson(response), githubLogin);
  if (status === null) {
    throw new ApiError("invalid_publish_status_response");
  }
  return status;
}

/** 로그아웃은 Origin을 확인하는 POST다. 실패해도 화면은 다시 불러온다. */
export async function logout(): Promise<void> {
  await fetch("/auth/logout", { method: "POST" }).catch(() => undefined);
}

export function parsePublishStatus(value: unknown, githubLogin: string): PublishStatus | null {
  const parsed = z
    .object({
      actionsUrl: z.unknown(),
      state: z.enum(["failed", "in_progress", "queued", "succeeded"]),
    })
    .safeParse(value);
  if (!parsed.success || !("actionsUrl" in (value as object))) {
    return null;
  }
  if (parsed.data.actionsUrl === null) {
    return { actionsUrl: null, state: parsed.data.state };
  }
  const actionsUrl = parseActionsUrl(parsed.data.actionsUrl, githubLogin);
  return actionsUrl === null ? null : { actionsUrl, state: parsed.data.state };
}

/**
 * 서버가 준 Actions 링크는 현재 사용자의 `<login>.github.io` Actions 경로 아래일 때만 화면에 연결한다.
 * 다른 저장소·http·인증 정보·query가 붙은 URL은 버린다.
 */
export function parseActionsUrl(value: unknown, githubLogin: string): string | null {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(githubLogin) ||
    !URL.canParse(value)
  ) {
    return null;
  }
  const url = new URL(value);
  const prefix = `/${githubLogin}/${githubLogin}.github.io/actions/`.toLowerCase();
  const path = url.pathname.toLowerCase();
  return url.protocol === "https:" &&
    url.hostname === "github.com" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === "" &&
    path.startsWith(prefix) &&
    path.length > prefix.length
    ? url.href
    : null;
}

export function pageErrorMessage(code: string): string {
  switch (code) {
    case "notion_access_denied":
      return "Notion 접근 권한이 만료되었거나 철회되었습니다. 워크스페이스를 다시 연결해 주세요.";
    case "notion_rate_limited":
      return "Notion 요청 한도에 도달했습니다. 잠시 뒤 다시 시도해 주세요.";
    case "notion_timeout":
      return "Notion 응답 시간이 초과되었습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.";
    default:
      return "Notion 문서를 불러오지 못했습니다.";
  }
}

const PUBLISH_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  access_denied: "Notion 페이지 접근 권한을 다시 공유하거나 워크스페이스를 다시 연결해 주세요.",
  authentication_required: "GitHub에 다시 로그인한 뒤 게시해 주세요.",
  conflict: "게시 중 기본 branch가 변경되었습니다. GitHub의 최신 변경을 확인한 뒤 다시 시도해 주세요.",
  deployment_failed: "GitHub Pages 배포가 실패했습니다. Actions 로그를 확인한 뒤 다시 게시해 주세요.",
  deployment_timeout: "배포 확인 시간이 초과되었습니다. Actions 로그에서 진행 상태를 확인해 주세요.",
  invalid_publish_image:
    "이미지를 안전하게 가져오지 못했습니다. Notion에서 이미지 파일을 다시 첨부한 뒤 게시해 주세요.",
  oauth_scope_missing: "GitHub의 repository 및 workflow 권한을 다시 승인한 뒤 게시해 주세요.",
  pages_setup_required: "GitHub Pages 배포 소스를 Actions로 설정한 뒤 대상 상태를 다시 확인해 주세요.",
  rate_limited: "요청 한도에 도달했습니다. 잠시 기다린 뒤 다시 시도해 주세요.",
  repository_must_be_public: "GitHub Pages 저장소를 public으로 전환한 뒤 다시 확인해 주세요.",
  repository_not_found: "공개 GitHub Pages 저장소를 만든 뒤 대상 상태를 다시 확인해 주세요.",
  repository_not_managed:
    "기존 저장소 파일을 보호하기 위해 게시를 중단했습니다. 아래 GitHub Pages 대상에서 충돌 경로를 확인해 주세요.",
  repository_owner_mismatch: "현재 계정이 소유하고 쓸 수 있는 GitHub Pages 저장소인지 확인해 주세요.",
  repository_write_denied: "현재 계정이 소유하고 쓸 수 있는 GitHub Pages 저장소인지 확인해 주세요.",
  blog_post_not_found: "블로그에 이 글이 없습니다. 이미 내려졌을 수 있습니다.",
  invalid_site_settings: "입력값을 확인해 주세요. 이름은 1~40자, 소개는 200자 이하, 링크는 https 주소만 쓸 수 있습니다.",
  timeout: "Provider 응답 시간이 초과되었습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.",
};

/** 서버 오류 code → 사용자 문구. `github_`·`notion_` 접두어는 같은 문구를 쓴다. */
// 이미지 거절 이유별 안내. 없는 이유는 invalid_publish_image의 일반 문구를 쓴다.
const IMAGE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  byte_limit: "8MB를 넘는 이미지가 있습니다. 크기를 줄여 Notion에 다시 첨부한 뒤 게시해 주세요.",
  count_limit: "이미지가 100개를 넘습니다. 한 글에는 이미지를 100개까지 넣을 수 있습니다.",
  document_byte_limit: "이미지 전체 크기가 64MB를 넘습니다. 이미지 크기를 줄인 뒤 게시해 주세요.",
  mime_content_mismatch: "PNG·JPEG·GIF·WebP가 아닌 이미지(예: HEIC·SVG)가 있습니다. 이 형식으로 바꿔 다시 첨부해 주세요.",
  mime_type: "PNG·JPEG·GIF·WebP가 아닌 이미지(예: HEIC·SVG)가 있습니다. 이 형식으로 바꿔 다시 첨부해 주세요.",
  timeout: "이미지를 받는 데 10초를 넘겼습니다. 잠시 뒤 다시 게시해 주세요.",
};
const EXTERNAL_IMAGE_REASONS = new Set([
  "blocked_address", "http_status", "invalid_redirect", "network", "redirect_limit", "redirect_loop", "url",
]);

/** 게시 실패 문구. `detail`이 있으면 이미지 거절 이유나 잘못된 예약 속성을 짚어 준다. */
export function publishErrorMessage(code: string, detail: string | null = null): string {
  if (code === "invalid_blog_metadata") {
    return detail === null
      ? "Notion의 Blog 예약 속성 값이 올바르지 않습니다. 속성 형식을 확인한 뒤 다시 게시해 주세요."
      : `Notion의 "${detail}" 속성 값이 올바르지 않습니다. 형식을 확인한 뒤 다시 게시해 주세요.`;
  }
  if (code === "invalid_publish_image" && detail !== null) {
    const message = IMAGE_ERROR_MESSAGES[detail];
    if (message !== undefined) return message;
    if (EXTERNAL_IMAGE_REASONS.has(detail)) {
      return "외부 주소의 이미지를 받지 못했습니다. 이미지를 Notion에 직접 업로드한 뒤 게시해 주세요.";
    }
  }
  return (
    PUBLISH_ERROR_MESSAGES[code.replace(/^(github|notion)_/, "")] ??
    "게시하지 못했습니다. 권한과 GitHub Pages 상태를 확인한 뒤 다시 시도해 주세요."
  );
}

/** 실패 응답이면 서버 오류 code로 `ApiError`를 던지고, 아니면 JSON 본문(파싱 실패 시 `null`). */
async function readJson(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = z.object({ detail: z.string().max(64).optional(), error: z.string() }).safeParse(body);
    throw new ApiError(
      code.success ? code.data.error : `http_${response.status}`,
      retryAtFromResponse(response),
      code.success ? (code.data.detail ?? null) : null,
    );
  }
  return body;
}

function parse<T>(schema: z.ZodType<T>, value: unknown, code = "invalid_response"): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(code);
  }
  return parsed.data;
}

function assertUnique(ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) {
    throw new ApiError("invalid_response");
  }
}
