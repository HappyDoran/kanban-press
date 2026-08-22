import type { SessionCodec } from "@notion-kanban-blog/auth";
import type { NotionContentAdapter } from "@notion-kanban-blog/notion";
import { z } from "zod";

import {
  createGitHubAuthDependencies,
  readCookie,
  SESSION_COOKIE,
} from "../auth/github";
import {
  createNotionAuthDependencies,
  getOwnedNotionConnection,
  type NotionAuthDependencies,
} from "../auth/notion";
import {
  NotionProviderError,
  NotionRestContentAdapter,
} from "../notion/content";
import {
  buildPublishDocument,
  InvalidBlogMetadataError,
} from "./document";
import { createPublishPreviewResponse } from "./preview";

const MAX_PREVIEW_REQUEST_BYTES = 4_096;
const previewRequestSchema = z
  .object({
    connectionId: z.string().uuid(),
    providerPageId: z.string().uuid(),
  })
  .strict();
const environmentSchema = z.object({
  NOTION_API_VERSION: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const previewHeaders = {
  "cache-control": "no-store",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
} as const;

export interface PreviewDependencies {
  appOrigin: string;
  createNotionAdapter: (accessToken: string) => NotionContentAdapter;
  notionAuth: Pick<
    NotionAuthDependencies,
    "connectionsCodec" | "sessionCodec"
  >;
  sessionCodec: SessionCodec;
}

export async function previewNotionPage(
  request: Request,
  dependencies: PreviewDependencies,
): Promise<Response> {
  if (request.headers.get("origin") !== dependencies.appOrigin) {
    return previewError(403, "invalid_origin");
  }
  const session = await readSession(request, dependencies.sessionCodec);
  if (session === null) {
    return previewError(401, "authentication_required");
  }
  const input = previewRequestSchema.safeParse(await safePreviewJson(request));
  if (!input.success) {
    return previewError(400, "invalid_preview_request");
  }
  const access = await getOwnedNotionConnection(
    request,
    input.data.connectionId,
    dependencies.notionAuth,
  );
  if (access.kind !== "allowed") {
    const status =
      access.kind === "authentication_required"
        ? 401
        : access.kind === "notion_connection_not_found"
          ? 404
          : 400;
    return previewError(status, access.kind);
  }

  try {
    const notion = dependencies.createNotionAdapter(
      access.connection.accessToken,
    );
    const page = await notion.getPageContent(input.data.providerPageId);
    if (page.providerPageId !== input.data.providerPageId) {
      return previewError(403, "notion_page_mismatch");
    }
    const document = buildPublishDocument(page);
    const preview = createPublishPreviewResponse(
      document,
      page.lastEditedAt.toISOString(),
    );
    return Response.json(preview, { headers: previewHeaders });
  } catch (error) {
    return previewErrorResponse(error);
  }
}

export function createPreviewDependencies(
  environment: NodeJS.ProcessEnv = process.env,
): PreviewDependencies {
  const parsed = environmentSchema.parse(environment);
  const githubAuth = createGitHubAuthDependencies(environment);
  return {
    appOrigin: githubAuth.config.appOrigin,
    createNotionAdapter: (accessToken) =>
      new NotionRestContentAdapter({
        accessToken,
        apiVersion: parsed.NOTION_API_VERSION,
      }),
    notionAuth: createNotionAuthDependencies(environment),
    sessionCodec: githubAuth.sessionCodec,
  };
}

async function readSession(request: Request, codec: SessionCodec) {
  const value = readCookie(request, SESSION_COOKIE);
  return value === null ? null : codec.open(value);
}

async function safePreviewJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0];
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    contentType !== "application/json" ||
    (Number.isFinite(declaredLength) &&
      declaredLength > MAX_PREVIEW_REQUEST_BYTES)
  ) {
    return null;
  }
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_PREVIEW_REQUEST_BYTES) {
      return null;
    }
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function previewErrorResponse(error: unknown): Response {
  if (error instanceof InvalidBlogMetadataError) {
    return previewError(422, error.code);
  }
  if (error instanceof NotionProviderError) {
    if (error.code === "access_denied") {
      return previewError(403, "notion_access_denied");
    }
    if (error.code === "rate_limited") {
      return previewError(
        429,
        "notion_rate_limited",
        error.retryAfterSeconds,
      );
    }
    if (error.code === "timeout") {
      return previewError(504, "notion_timeout");
    }
    return previewError(502, "notion_unavailable");
  }
  return previewError(502, "preview_unavailable");
}

function previewError(
  status: number,
  code: string,
  retryAfterSeconds: number | null = null,
): Response {
  const headers = new Headers(previewHeaders);
  if (
    retryAfterSeconds !== null &&
    Number.isSafeInteger(retryAfterSeconds) &&
    retryAfterSeconds >= 0 &&
    retryAfterSeconds <= 3_600
  ) {
    headers.set("retry-after", String(retryAfterSeconds));
  }
  return Response.json(
    { error: code },
    { headers, status },
  );
}
