import { z } from "zod";

import {
  createNotionAuthDependencies,
  getOwnedNotionConnection,
} from "../auth/notion";
import { errorResponse } from "../auth/session";
import {
  NotionProviderError,
  NotionRestContentAdapter,
} from "./content";

import type { NotionAuthDependencies } from "../auth/notion";
import type { NotionContentAdapter } from "@notion-kanban-blog/notion";

const connectionIdSchema = z.string().uuid();
const environmentSchema = z.object({
  NOTION_API_VERSION: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export interface NotionPageTreeDependencies {
  auth: Pick<
    NotionAuthDependencies,
    "connectionsCodec" | "sessionCodec"
  >;
  createAdapter: (accessToken: string) => NotionContentAdapter;
}

export async function listNotionPageTree(
  request: Request,
  connectionId: string,
  dependencies: NotionPageTreeDependencies,
): Promise<Response> {
  const parsedConnectionId = connectionIdSchema.safeParse(connectionId);
  if (!parsedConnectionId.success) {
    return errorResponse(400, "invalid_notion_connection_id");
  }

  const access = await getOwnedNotionConnection(
    request,
    parsedConnectionId.data,
    dependencies.auth,
  );
  if (access.kind !== "allowed") {
    const status =
      access.kind === "authentication_required"
        ? 401
        : access.kind === "notion_connection_not_found"
          ? 404
          : 400;
    return errorResponse(status, access.kind);
  }

  try {
    const pages = await dependencies
      .createAdapter(access.connection.accessToken)
      .listPageTree();
    return Response.json(
      {
        pages: pages.map((page) => ({
          ...page,
          lastEditedAt: page.lastEditedAt.toISOString(),
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return notionPageErrorResponse(error);
  }
}

export async function listNotionPageOutline(
  request: Request,
  connectionId: string,
  pageId: string,
  dependencies: NotionPageTreeDependencies,
): Promise<Response> {
  const parsedConnectionId = connectionIdSchema.safeParse(connectionId);
  const parsedPageId = connectionIdSchema.safeParse(pageId);
  if (!parsedConnectionId.success) {
    return errorResponse(400, "invalid_notion_connection_id");
  }
  if (!parsedPageId.success) {
    return errorResponse(400, "invalid_notion_page_id");
  }

  const access = await getOwnedNotionConnection(
    request,
    parsedConnectionId.data,
    dependencies.auth,
  );
  if (access.kind !== "allowed") {
    const status =
      access.kind === "authentication_required"
        ? 401
        : access.kind === "notion_connection_not_found"
          ? 404
          : 400;
    return errorResponse(status, access.kind);
  }

  try {
    const outline = await dependencies
      .createAdapter(access.connection.accessToken)
      .listPageOutline(parsedPageId.data);
    return Response.json(
      { outline },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return notionPageErrorResponse(error);
  }
}

export function createNotionPageTreeDependencies(
  environment: NodeJS.ProcessEnv = process.env,
): NotionPageTreeDependencies {
  const parsed = environmentSchema.parse(environment);
  return {
    auth: createNotionAuthDependencies(environment),
    createAdapter: (accessToken) =>
      new NotionRestContentAdapter({
        accessToken,
        apiVersion: parsed.NOTION_API_VERSION,
      }),
  };
}

function notionPageErrorResponse(error: unknown): Response {
  if (!(error instanceof NotionProviderError)) {
    return errorResponse(502, "notion_pages_unavailable");
  }
  const status =
    error.code === "access_denied"
      ? 403
      : error.code === "rate_limited"
        ? 429
        : error.code === "timeout"
          ? 504
          : 502;
  const code =
    error.code === "access_denied"
      ? "notion_access_denied"
      : error.code === "rate_limited"
        ? "notion_rate_limited"
        : error.code === "timeout"
          ? "notion_timeout"
        : error.code === "invalid_response"
          ? "invalid_notion_response"
          : "notion_pages_unavailable";
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json",
  });
  if (error.retryAfterSeconds !== null) {
    headers.set("retry-after", String(error.retryAfterSeconds));
  }
  return new Response(JSON.stringify({ error: code }), { headers, status });
}
