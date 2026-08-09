import { createHash, randomUUID } from "node:crypto";

import type { SessionCodec } from "@notion-kanban-blog/auth";
import type {
  GitHubRepositoryAdapter,
  GitHubArtifact,
} from "@notion-kanban-blog/github";
import type {
  NotionContentAdapter,
  NotionContentBlock,
  NotionPageContent,
} from "@notion-kanban-blog/notion";
import {
  createAstroTemplateManifest,
  createMarkdownArtifact,
  type PublishBlock,
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
    const slug = pageSlug(page.title, page.providerPageId);
    const template = createAstroTemplateManifest({
      defaultBranch: repository.defaultBranch,
      owner: session.githubLogin,
      repository: repository.fullName.split("/")[1] ?? "",
    });
    const markdown = createMarkdownArtifact({
      blocks: page.blocks.flatMap(toPublishBlock),
      description: pageDescription(page),
      publishedAt: page.createdAt.toISOString(),
      slug,
      title: page.title,
      updatedAt: page.lastEditedAt.toISOString(),
    });
    const artifacts = [...template.artifacts, markdown].sort((left, right) =>
      left.path.localeCompare(right.path),
    );
    const contentHash = artifactHash(artifacts);
    const committed = await github.commitArtifacts(
      repository,
      artifacts,
      `Publish ${page.title.slice(0, 150)} (${contentHash.slice(0, 12)}; ${randomUUID()})`,
    );
    return Response.json(
      {
        commitSha: committed.commitSha,
        contentHash,
        created: committed.created,
        pageUrl: `${template.siteUrl}/posts/${slug}/`,
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

export function pageSlug(title: string, providerPageId: string): string {
  const suffix = providerPageId.replaceAll("-", "").slice(0, 12).toLowerCase();
  if (!/^[a-f0-9]{12}$/.test(suffix)) {
    throw new Error("Invalid Notion page ID");
  }
  const base =
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/g, "") || "notion";
  return `${base}-${suffix}`;
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

function toPublishBlock(block: NotionContentBlock): PublishBlock[] {
  switch (block.kind) {
    case "heading":
      return [
        {
          kind: "heading",
          level: (block.level + 1) as 2 | 3 | 4,
          richText: block.richText,
        },
      ];
    case "toggle":
      return [
        {
          children: block.children.flatMap(toPublishBlock),
          kind: "toggle",
          summary: block.summary,
        },
      ];
    default:
      return [block];
  }
}

function pageDescription(page: NotionPageContent): string {
  for (const block of page.blocks) {
    if (
      block.kind === "paragraph" ||
      block.kind === "quote" ||
      block.kind === "heading"
    ) {
      const text = block.richText.map((part) => part.text).join("").trim();
      if (text) {
        return text.slice(0, 1_000);
      }
    }
  }
  return page.title.slice(0, 1_000);
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
