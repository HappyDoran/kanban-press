import { createHash, randomUUID } from "node:crypto";

import type { SessionCodec } from "@notion-kanban-blog/auth";
import type {
  GitHubRepositoryAdapter,
  GitHubArtifact,
} from "@notion-kanban-blog/github";
import type {
  NotionContentAdapter,
} from "@notion-kanban-blog/notion";
import {
  createAstroTemplateManifest,
  createMarkdownArtifact,
} from "@notion-kanban-blog/publisher";
import { z } from "zod";

import {
  createGitHubAuthDependencies,
  errorResponse,
  readCookie,
  SESSION_COOKIE,
} from "../auth/github";
import {
  createNotionAuthDependencies,
  getOwnedNotionConnection,
  type NotionAuthDependencies,
} from "../auth/notion";
import {
  GitHubPagesClient,
  GitHubPagesError,
} from "../github/pages";
import {
  NotionProviderError,
  NotionRestContentAdapter,
} from "../notion/content";
import {
  buildPublishDocument,
  InvalidBlogMetadataError,
} from "./document";

export { pageSlug } from "./document";

const publishRequestSchema = z
  .object({
    connectionId: z.string().uuid(),
    providerPageId: z.string().uuid(),
  })
  .strict();
const commitShaSchema = z.string().regex(/^[a-f0-9]{40,64}$/);
const environmentSchema = z.object({
  GITHUB_API_VERSION: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  NOTION_API_VERSION: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export interface PublishDependencies {
  appOrigin: string;
  createGitHubAdapter: (accessToken: string) => GitHubRepositoryAdapter;
  createNotionAdapter: (accessToken: string) => NotionContentAdapter;
  notionAuth: Pick<
    NotionAuthDependencies,
    "connectionsCodec" | "sessionCodec"
  >;
  sessionCodec: SessionCodec;
}

export async function publishNotionPage(
  request: Request,
  dependencies: PublishDependencies,
): Promise<Response> {
  if (request.headers.get("origin") !== dependencies.appOrigin) {
    return errorResponse(403, "invalid_origin");
  }
  const session = await readSession(request, dependencies.sessionCodec);
  if (session === null) {
    return errorResponse(401, "authentication_required");
  }
  const input = publishRequestSchema.safeParse(await safeJson(request));
  if (!input.success) {
    return errorResponse(400, "invalid_publish_request");
  }
  const access = await getOwnedNotionConnection(
    request,
    input.data.connectionId,
    dependencies.notionAuth,
  );
  if (access.kind !== "allowed") {
    return errorResponse(
      access.kind === "notion_connection_not_found" ? 404 : 400,
      access.kind,
    );
  }

  try {
    const notion = dependencies.createNotionAdapter(
      access.connection.accessToken,
    );
    const github = dependencies.createGitHubAdapter(session.accessToken);
    const [page, repository] = await Promise.all([
      notion.getPageContent(input.data.providerPageId),
      github.getPagesRepository(session.userId, session.githubLogin),
    ]);
    if (page.providerPageId !== input.data.providerPageId) {
      return errorResponse(403, "notion_page_mismatch");
    }
    const document = buildPublishDocument(page);
    const template = createAstroTemplateManifest({
      defaultBranch: repository.defaultBranch,
      owner: session.githubLogin,
      repository: repository.fullName.split("/")[1] ?? "",
    });
    const markdown = createMarkdownArtifact(document);
    const artifacts = [...template.artifacts, markdown].sort((left, right) =>
      left.path.localeCompare(right.path),
    );
    const contentHash = artifactHash(artifacts);
    const commitMessage =
      `Publish ${page.title.slice(0, 150)} ` +
      `(${contentHash.slice(0, 12)}; ${randomUUID()})`;
    const readiness = await github.getRepositoryReadiness(
      repository,
      artifacts.map((artifact) => artifact.path),
    );
    if (readiness.state !== "ready") {
      return errorResponse(
        409,
        readiness.state === "pages_setup_required"
          ? "github_pages_setup_required"
          : "github_repository_not_managed",
      );
    }
    const committed = await github.commitArtifacts(
      repository,
      artifacts,
      commitMessage,
    );
    return Response.json(
      {
        commitSha: committed.commitSha,
        contentHash,
        created: committed.created,
        pageUrl: `${template.siteUrl}/posts/${document.slug}/`,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return publishErrorResponse(error);
  }
}

export async function getPublishStatus(
  request: Request,
  dependencies: PublishDependencies,
): Promise<Response> {
  const session = await readSession(request, dependencies.sessionCodec);
  if (session === null) {
    return errorResponse(401, "authentication_required");
  }
  const parsedSha = commitShaSchema.safeParse(
    new URL(request.url).searchParams.get("commitSha"),
  );
  if (!parsedSha.success) {
    return errorResponse(400, "invalid_commit_sha");
  }
  try {
    const github = dependencies.createGitHubAdapter(session.accessToken);
    const repository = await github.getPagesRepository(
      session.userId,
      session.githubLogin,
    );
    const status = await github.getDeploymentStatus(
      repository,
      parsedSha.data,
    );
    return Response.json(
      { commitSha: parsedSha.data, ...status },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return publishErrorResponse(error);
  }
}

export function createPublishDependencies(
  environment: NodeJS.ProcessEnv = process.env,
): PublishDependencies {
  const parsed = environmentSchema.parse(environment);
  const githubAuth = createGitHubAuthDependencies(environment);
  return {
    appOrigin: githubAuth.config.appOrigin,
    createGitHubAdapter: (accessToken) =>
      new GitHubPagesClient({
        accessToken,
        apiVersion: parsed.GITHUB_API_VERSION,
      }),
    createNotionAdapter: (accessToken) =>
      new NotionRestContentAdapter({
        accessToken,
        apiVersion: parsed.NOTION_API_VERSION,
      }),
    notionAuth: createNotionAuthDependencies(environment),
    sessionCodec: githubAuth.sessionCodec,
  };
}

export function artifactHash(artifacts: readonly GitHubArtifact[]): string {
  const hash = createHash("sha256");
  for (const artifact of [...artifacts].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    hash.update(`${Buffer.byteLength(artifact.path)}:${artifact.path}:`);
    hash.update(`${artifact.bytes.byteLength}:`);
    hash.update(artifact.bytes);
  }
  return hash.digest("hex");
}

async function readSession(request: Request, codec: SessionCodec) {
  const value = readCookie(request, SESSION_COOKIE);
  return value === null ? null : codec.open(value);
}

async function safeJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function publishErrorResponse(error: unknown): Response {
  if (error instanceof InvalidBlogMetadataError) {
    return errorResponse(422, error.code);
  }
  if (error instanceof NotionProviderError) {
    const status =
      error.code === "access_denied"
        ? 403
        : error.code === "rate_limited"
          ? 429
          : 502;
    return errorResponse(status, `notion_${error.code}`);
  }
  if (error instanceof GitHubPagesError) {
    const status =
      error.code === "rate_limited"
        ? 429
        : error.code === "conflict"
          ? 409
        : error.code === "unavailable" ||
              error.code === "invalid_response" ||
              error.code === "git_resource_not_found"
            ? 502
            : error.code === "repository_not_found"
              ? 404
              : 403;
    return errorResponse(status, `github_${error.code}`);
  }
  return errorResponse(502, "publish_unavailable");
}
