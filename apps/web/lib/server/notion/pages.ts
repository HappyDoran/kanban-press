// `/api/notion/connections/:connectionId/pages`와 `.../pages/:pageId/outline` route 본체.
// 요청마다 연결 소유권을 확인한 뒤 그 연결의 token으로만 Notion을 읽는다.
import type { NotionContentAdapter } from "@kanban-press/notion";
import { z } from "zod";

import {
  createNotionAuthDependencies,
  getOwnedNotionConnection,
  type NotionAuthDependencies,
} from "@/lib/server/auth/notion";
import { errorResponse } from "@/lib/server/auth/session";

import { NotionProviderError, NotionRestContentAdapter } from "./content";

const notionIdSchema = z.string().uuid();

export interface NotionPageTreeDependencies {
  auth: Pick<NotionAuthDependencies, "connectionsCodec" | "sessionCodec">;
  createAdapter: (accessToken: string) => NotionContentAdapter;
}

export function listNotionPageTree(
  request: Request,
  connectionId: string,
  dependencies: NotionPageTreeDependencies,
): Promise<Response> {
  return withOwnedAdapter(request, connectionId, dependencies, async (adapter) => {
    const pages = await adapter.listPageTree();
    return {
      pages: pages.map((page) => ({ ...page, lastEditedAt: page.lastEditedAt.toISOString() })),
    };
  });
}

export function listNotionPageOutline(
  request: Request,
  connectionId: string,
  pageId: string,
  dependencies: NotionPageTreeDependencies,
): Promise<Response> {
  const validPageId = notionIdSchema.safeParse(pageId).success;
  return withOwnedAdapter(
    request,
    connectionId,
    dependencies,
    async (adapter) => ({ outline: await adapter.listPageOutline(pageId) }),
    validPageId ? null : "invalid_notion_page_id",
  );
}

export function createNotionPageTreeDependencies(
  environment: NodeJS.ProcessEnv = process.env,
): NotionPageTreeDependencies {
  const { NOTION_API_VERSION } = z
    .object({ NOTION_API_VERSION: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
    .parse(environment);
  return {
    auth: createNotionAuthDependencies(environment),
    createAdapter: (accessToken) =>
      new NotionRestContentAdapter({ accessToken, apiVersion: NOTION_API_VERSION }),
  };
}

/**
 * 연결 ID 검증 → 소유권 확인 → adapter 호출 → JSON 응답.
 * `inputError`가 있으면 연결 ID 검증 다음에 400으로 거절한다.
 */
async function withOwnedAdapter(
  request: Request,
  connectionId: string,
  dependencies: NotionPageTreeDependencies,
  read: (adapter: NotionContentAdapter) => Promise<unknown>,
  inputError: string | null = null,
): Promise<Response> {
  const parsedConnectionId = notionIdSchema.safeParse(connectionId);
  if (!parsedConnectionId.success) {
    return errorResponse(400, "invalid_notion_connection_id");
  }
  if (inputError !== null) {
    return errorResponse(400, inputError);
  }
  const access = await getOwnedNotionConnection(request, parsedConnectionId.data, dependencies.auth);
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
    const body = await read(dependencies.createAdapter(access.connection.accessToken));
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return notionErrorResponse(error);
  }
}

// provider 오류 code → [HTTP 상태, 응답 code]
const NOTION_ERRORS = {
  access_denied: [403, "notion_access_denied"],
  invalid_response: [502, "invalid_notion_response"],
  rate_limited: [429, "notion_rate_limited"],
  timeout: [504, "notion_timeout"],
  unavailable: [502, "notion_pages_unavailable"],
} as const;

function notionErrorResponse(error: unknown): Response {
  if (!(error instanceof NotionProviderError)) {
    return errorResponse(502, "notion_pages_unavailable");
  }
  const [status, code] = NOTION_ERRORS[error.code];
  return errorResponse(
    status,
    code,
    error.retryAfterSeconds === null ? {} : { "retry-after": String(error.retryAfterSeconds) },
  );
}
