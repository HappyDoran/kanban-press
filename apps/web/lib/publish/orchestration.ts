// `/api/publish`·`/api/publish/status` 본체와 게시·프리뷰가 같이 쓰는 요청 검증.
// 게시는 요청마다 Notion 원문과 GitHub 권한을 다시 읽고, 저장소 준비 상태를 확인한 뒤 commit 하나로 올린다.
import { createHash, randomUUID } from "node:crypto";

import type { SessionCodec } from "@kanban-press/auth";
import type { GitHubArtifact, GitHubRepositoryAdapter } from "@kanban-press/github";
import type { NotionContentAdapter } from "@kanban-press/notion";
import { createAstroTemplateManifest, createMarkdownArtifact } from "@kanban-press/publisher";
import { z } from "zod";

import { createGitHubAuthDependencies } from "../auth/github";
import {
  createNotionAuthDependencies,
  getOwnedNotionConnection,
  type NotionAuthDependencies,
} from "../auth/notion";
import { errorResponse, readSession } from "../auth/session";
import {
  GitHubPagesClient,
  GitHubPagesError,
  gitHubErrorResponse,
  LEGACY_MANAGED_MARKER_PATH,
} from "../github/pages";
import { NotionProviderError, NotionRestContentAdapter } from "../notion/content";
import { writePublishRejectedLog } from "../operations/structured-log";

import { pageFiles, pageIdSuffix, publishedPosts, redirectPage } from "./blog-files";
import { buildPublishDocument, InvalidBlogMetadataError } from "./document";
import {
  createPublishImageDependencies,
  InvalidPublishImageError,
  materializePublishImages,
  type PublishImageDependencies,
} from "./image-assets";

export { pageSlug } from "./document";

const MAX_REQUEST_BYTES = 4_096;
const apiVersionSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const pageRequestSchema = z
  .object({ connectionId: z.string().uuid(), providerPageId: z.string().uuid() })
  .strict();
const commitShaSchema = z.string().regex(/^[a-f0-9]{40,64}$/);
/** 게시·프리뷰 응답은 캐시하지 않고 JSON으로만 해석되게 한다. */
export const NO_STORE_HEADERS = {
  "cache-control": "no-store",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
} as const;

export interface PublishDependencies {
  appOrigin: string;
  createGitHubAdapter: (accessToken: string) => GitHubRepositoryAdapter;
  createNotionAdapter: (accessToken: string) => NotionContentAdapter;
  imageDependencies: PublishImageDependencies;
  notionAuth: Pick<NotionAuthDependencies, "connectionsCodec" | "sessionCodec">;
  sessionCodec: SessionCodec;
}

type Session = NonNullable<Awaited<ReturnType<typeof readSession>>>;

export type PageRequestDependencies = Pick<
  PublishDependencies,
  "appOrigin" | "createNotionAdapter" | "notionAuth" | "sessionCodec"
>;

export async function publishNotionPage(request: Request, dependencies: PublishDependencies): Promise<Response> {
  const owned = await authorizePageRequest(request, dependencies, "invalid_publish_request");
  if (owned instanceof Response) {
    return owned;
  }
  const { notion, providerPageId, session } = owned;

  try {
    const github = dependencies.createGitHubAdapter(session.accessToken);
    const [page, repository] = await Promise.all([
      notion.getPageContent(providerPageId),
      github.getPagesRepository(session.userId, session.githubLogin),
    ]);
    if (page.providerPageId !== providerPageId) {
      return errorResponse(403, "notion_page_mismatch", NO_STORE_HEADERS);
    }
    const template = createAstroTemplateManifest({
      defaultBranch: repository.defaultBranch,
      owner: session.githubLogin,
      repository: repository.fullName.split("/")[1] ?? "",
    });
    const { artifacts: images, document } = await materializePublishImages(
      buildPublishDocument(page),
      dependencies.imageDependencies,
    );
    const pageUrl = `${template.siteUrl}/posts/${document.slug}/`;
    const written = [...template.artifacts, ...images, createMarkdownArtifact(document)];
    const readiness = await github.getRepositoryReadiness(
      repository,
      written.map((artifact) => artifact.path),
    );
    if (readiness.state !== "ready") {
      return notReadyResponse(readiness.state);
    }
    // 같은 글의 옛 파일 정리(R8): 제목이 바뀌어 남은 옛 slug의 글·이미지와 이번에 줄어든 이미지를 지우고,
    // 옛 주소에는 새 주소로 보내는 안내 page를 남긴다(D4).
    const existing = pageFiles(readiness.contentPaths, pageIdSuffix(providerPageId));
    const redirects = existing.slugs
      .filter((slug) => slug !== document.slug)
      .map((slug) => redirectPage(slug, document.slug, pageUrl));
    const artifacts = [...written, ...redirects].sort((left, right) => left.path.localeCompare(right.path));
    const writtenPaths = new Set(artifacts.map((artifact) => artifact.path));
    // 옛 관리 표식은 이번 commit이 새 표식을 쓰므로 지운다(이름 변경 이전 저장소).
    const deletePaths = [
      ...existing.paths.filter((path) => !writtenPaths.has(path)),
      ...readiness.contentPaths.filter((path) => path === LEGACY_MANAGED_MARKER_PATH),
    ];
    const contentHash = artifactHash(artifacts);
    // 같은 내용을 다시 게시해도 commit이 생기도록 UUID를 붙인다. 제목 외 provider 값은 넣지 않는다.
    const message = `Publish ${page.title.slice(0, 150)} (${contentHash.slice(0, 12)}; ${randomUUID()})`;
    const committed = await github.commitArtifacts(repository, artifacts, message, deletePaths);
    return Response.json(
      { commitSha: committed.commitSha, contentHash, created: committed.created, pageUrl },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return pageErrorResponse(error, "publish_unavailable");
  }
}

/**
 * `/api/publish/unpublish`: 블로그에서 내리기(R8). 연결 소유권과 GitHub 권한을 다시 확인하고
 * 이 page ID 접미사의 글·이미지·옛 주소 안내 page만 지우는 commit 하나를 만든다. Notion 원문은 읽지도 바꾸지도 않는다.
 */
export async function unpublishNotionPage(request: Request, dependencies: PublishDependencies): Promise<Response> {
  const owned = await authorizePageRequest(request, dependencies, "invalid_unpublish_request");
  if (owned instanceof Response) {
    return owned;
  }
  const { providerPageId, session } = owned;
  try {
    const github = dependencies.createGitHubAdapter(session.accessToken);
    const repository = await github.getPagesRepository(session.userId, session.githubLogin);
    const readiness = await github.getRepositoryReadiness(repository, templatePaths(repository, session.githubLogin));
    if (readiness.state === "repository_not_managed") {
      return notReadyResponse(readiness.state);
    }
    const { paths, slugs } = pageFiles(readiness.contentPaths, pageIdSuffix(providerPageId));
    if (paths.length === 0) {
      return errorResponse(404, "blog_post_not_found", NO_STORE_HEADERS);
    }
    const committed = await github.commitArtifacts(repository, [], `Unpublish ${slugs.join(", ").slice(0, 200)}`, paths);
    return Response.json({ commitSha: committed.commitSha }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return pageErrorResponse(error, "unpublish_unavailable");
  }
}

/** `/api/publish/posts`: 저장소에 게시된 글(R8 게시 완료 열 복원). page ID 접미사와 글 주소만 돌려준다. */
export async function listPublishedPosts(request: Request, dependencies: PublishDependencies): Promise<Response> {
  const session = await readSession(request, dependencies.sessionCodec);
  if (session === null) {
    return errorResponse(401, "authentication_required", NO_STORE_HEADERS);
  }
  try {
    const github = dependencies.createGitHubAdapter(session.accessToken);
    const repository = await github.getPagesRepository(session.userId, session.githubLogin);
    const readiness = await github.getRepositoryReadiness(repository, templatePaths(repository, session.githubLogin));
    const siteUrl = `https://${session.githubLogin.toLowerCase()}.github.io`;
    const posts = publishedPosts(readiness.contentPaths).map(({ slug, suffix }) => ({
      pageIdSuffix: suffix,
      pageUrl: `${siteUrl}/posts/${slug}/`,
    }));
    return Response.json({ posts }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return pageErrorResponse(error, "publish_unavailable");
  }
}

export async function getPublishStatus(request: Request, dependencies: PublishDependencies): Promise<Response> {
  const session = await readSession(request, dependencies.sessionCodec);
  if (session === null) {
    return errorResponse(401, "authentication_required", NO_STORE_HEADERS);
  }
  const commitSha = commitShaSchema.safeParse(new URL(request.url).searchParams.get("commitSha"));
  if (!commitSha.success) {
    return errorResponse(400, "invalid_commit_sha", NO_STORE_HEADERS);
  }
  try {
    const github = dependencies.createGitHubAdapter(session.accessToken);
    const repository = await github.getPagesRepository(session.userId, session.githubLogin);
    const status = await github.getDeploymentStatus(repository, commitSha.data);
    return Response.json({ commitSha: commitSha.data, ...status }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return pageErrorResponse(error, "publish_unavailable");
  }
}

/**
 * 게시·프리뷰 공통 검증: 같은 origin → 세션 → 요청 본문 → 연결 소유권.
 * 통과하면 그 연결 token의 Notion adapter를 돌려주고, 아니면 오류 Response를 돌려준다.
 */
export async function authorizePageRequest(
  request: Request,
  dependencies: PageRequestDependencies,
  invalidRequestCode: string,
): Promise<Response | { notion: NotionContentAdapter; providerPageId: string; session: Session }> {
  if (request.headers.get("origin") !== dependencies.appOrigin) {
    return errorResponse(403, "invalid_origin", NO_STORE_HEADERS);
  }
  const session = await readSession(request, dependencies.sessionCodec);
  if (session === null) {
    return errorResponse(401, "authentication_required", NO_STORE_HEADERS);
  }
  const input = pageRequestSchema.safeParse(await readJsonBody(request));
  if (!input.success) {
    return errorResponse(400, invalidRequestCode, NO_STORE_HEADERS);
  }
  const access = await getOwnedNotionConnection(request, input.data.connectionId, dependencies.notionAuth);
  if (access.kind !== "allowed") {
    const status =
      access.kind === "authentication_required" ? 401 : access.kind === "notion_connection_not_found" ? 404 : 400;
    return errorResponse(status, access.kind, NO_STORE_HEADERS);
  }
  return {
    notion: dependencies.createNotionAdapter(access.connection.accessToken),
    providerPageId: input.data.providerPageId,
    session,
  };
}

export function notReadyResponse(state: "pages_setup_required" | "repository_not_managed"): Response {
  return errorResponse(
    409,
    state === "pages_setup_required" ? "github_pages_setup_required" : "github_repository_not_managed",
    NO_STORE_HEADERS,
  );
}

/** 준비 상태 확인에 넘기는 template 파일 경로. */
export function templatePaths(repository: { defaultBranch: string; fullName: string }, owner: string): string[] {
  return createAstroTemplateManifest({
    defaultBranch: repository.defaultBranch,
    owner,
    repository: repository.fullName.split("/")[1] ?? "",
  }).artifacts.map((artifact) => artifact.path);
}

/** 게시·프리뷰에서 나는 오류 → HTTP 응답. 알 수 없는 오류는 `fallbackCode` 502. */
export function pageErrorResponse(error: unknown, fallbackCode: string): Response {
  if (error instanceof InvalidBlogMetadataError || error instanceof InvalidPublishImageError) {
    // detail은 고정 값(이미지 거절 이유·예약 속성 이름)이라 URL·본문이 섞이지 않는다.
    const detail = error instanceof InvalidBlogMetadataError ? error.property : error.reason;
    writePublishRejectedLog({ code: error.code, detail });
    return Response.json({ detail, error: error.code }, { headers: NO_STORE_HEADERS, status: 422 });
  }
  if (error instanceof GitHubPagesError) {
    const response = gitHubErrorResponse(error);
    for (const [name, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(name, value);
    return response;
  }
  if (error instanceof NotionProviderError) {
    const status =
      error.code === "access_denied" ? 403 : error.code === "rate_limited" ? 429 : error.code === "timeout" ? 504 : 502;
    return errorResponse(status, `notion_${error.code}`, {
      ...NO_STORE_HEADERS,
      ...(error.retryAfterSeconds === null ? {} : { "retry-after": String(error.retryAfterSeconds) }),
    });
  }
  return errorResponse(502, fallbackCode, NO_STORE_HEADERS);
}

export function createPublishDependencies(environment: NodeJS.ProcessEnv = process.env): PublishDependencies {
  const githubApiVersion = apiVersionSchema.parse(environment.GITHUB_API_VERSION);
  const notionApiVersion = apiVersionSchema.parse(environment.NOTION_API_VERSION);
  const githubAuth = createGitHubAuthDependencies(environment);
  return {
    appOrigin: githubAuth.config.appOrigin,
    createGitHubAdapter: (accessToken) => new GitHubPagesClient({ accessToken, apiVersion: githubApiVersion }),
    createNotionAdapter: (accessToken) => new NotionRestContentAdapter({ accessToken, apiVersion: notionApiVersion }),
    imageDependencies: createPublishImageDependencies(),
    notionAuth: createNotionAuthDependencies(environment),
    sessionCodec: githubAuth.sessionCodec,
  };
}

/** artifact 순서와 무관한 내용 hash. 경로·길이를 앞에 붙여 경계가 섞여도 같은 hash가 나오지 않게 한다. */
export function artifactHash(artifacts: readonly GitHubArtifact[]): string {
  const hash = createHash("sha256");
  for (const artifact of [...artifacts].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(`${Buffer.byteLength(artifact.path)}:${artifact.path}:${artifact.bytes.byteLength}:`);
    hash.update(artifact.bytes);
  }
  return hash.digest("hex");
}

/** `application/json`이고 4KB 이하일 때만 해석한다. 아니면 null(→ 400). */
async function readJsonBody(request: Request): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json" ||
    Number(request.headers.get("content-length")) > MAX_REQUEST_BYTES
  ) {
    return null;
  }
  try {
    const text = await request.text();
    return Buffer.byteLength(text) > MAX_REQUEST_BYTES ? null : (JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}
