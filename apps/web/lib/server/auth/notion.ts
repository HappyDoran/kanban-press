// Notion 워크스페이스 연결: GitHub 로그인 사용자가 OAuth로 Notion을 연결하고,
// 연결 token은 암호화된 HttpOnly 쿠키(kp_notion_connections)에만 보관한다.
import { randomBytes } from "node:crypto";

import type { SessionCodec, UnixTimestamp } from "@kanban-press/auth";
import {
  createEncryptedCookieCodec,
  createSessionCookieCodec,
  type EncryptedCookieCodec,
} from "@kanban-press/auth/server";
import { z } from "zod";

import {
  providerRequest,
  ProviderTransportError,
} from "@/lib/server/operations/provider-request";
import type { LogSink } from "@/lib/server/operations/structured-log";

import {
  callbackError,
  cookieKeysFromEnvironment,
  currentUnixTimestamp,
  errorResponse,
  expiredCookies,
  isAllowedReturnTo,
  parseAppOrigin,
  readCookie,
  readSession,
  redirectResponse,
  secureStringEqual,
  serializeCookie,
  serializeExpiredCookie,
} from "./session";

const STATE_COOKIE = "kp_notion_oauth_state";
const CONNECTIONS_COOKIE = "kp_notion_connections";
const STATE_TTL_SECONDS = 10 * 60;
const CONNECTIONS_TTL_SECONDS = 30 * 24 * 60 * 60;
// 브라우저 쿠키 하나는 약 4KB다. 연결 수와 암호화된 값 크기를 함께 제한하고 넘으면 명시적으로 거절한다.
const MAX_CONNECTIONS = 3;
const MAX_COOKIE_VALUE_BYTES = 3_800;

const stateSchema = z
  .object({
    nonce: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
    ownerUserId: z.string().min(1).max(255),
    returnTo: z.string().min(1).max(512),
  })
  .strict();

const connectionSchema = z
  .object({
    accessToken: z.string().min(1).max(4096),
    botId: z.string().uuid(),
    connectedAt: z.number().int().nonnegative(),
    connectionId: z.string().uuid(),
    ownerUserId: z.string().min(1).max(255),
    refreshToken: z.string().min(1).max(4096).nullable(),
    workspaceIcon: z.string().max(2048).nullable(),
    workspaceId: z.string().uuid(),
    workspaceName: z.string().min(1).max(255),
  })
  .strict();

const connectionsPayloadSchema = z
  .object({ connections: z.array(connectionSchema).max(MAX_CONNECTIONS) })
  .strict();

export type NotionConnection = z.infer<typeof connectionSchema>;
export type NotionConnectionsPayload = z.infer<typeof connectionsPayloadSchema>;
export type NotionOAuthState = z.infer<typeof stateSchema>;

export type NotionConnectionAccess =
  | { kind: "allowed"; connection: NotionConnection }
  | {
      kind:
        | "authentication_required"
        | "invalid_connections_cookie"
        | "notion_connection_not_found";
    };

export interface NotionOAuthClient {
  authorize(
    code: string,
    redirectUri: string,
  ): Promise<{
    accessToken: string;
    botId: string;
    refreshToken: string | null;
    workspaceIcon: string | null;
    workspaceId: string;
    workspaceName: string;
  }>;
  revoke(accessToken: string): Promise<void>;
}

export interface NotionAuthDependencies {
  appOrigin: string;
  clientId: string;
  connectionsCodec: EncryptedCookieCodec<NotionConnectionsPayload>;
  notion: NotionOAuthClient;
  now: () => UnixTimestamp;
  randomState: () => string;
  secureCookies: boolean;
  sessionCodec: SessionCodec;
  stateCodec: EncryptedCookieCodec<NotionOAuthState>;
}

export class NotionAuthenticationError extends Error {
  override readonly name = "NotionAuthenticationError";

  constructor(readonly code: "timeout" | "unavailable" = "unavailable") {
    super("Notion authentication failed");
  }
}

/** `GET /auth/notion/start?returnTo=/`: GitHub 로그인한 사용자만 시작할 수 있다. */
export async function startNotionConnection(
  request: Request,
  { appOrigin, clientId, now, randomState, secureCookies, sessionCodec, stateCodec }: NotionAuthDependencies,
): Promise<Response> {
  const session = await readSession(request, sessionCodec);
  if (session === null) {
    return errorResponse(401, "authentication_required");
  }
  const returnTo = new URL(request.url).searchParams.get("returnTo") ?? "/";
  if (!isAllowedReturnTo(returnTo)) {
    return errorResponse(400, "invalid_return_to");
  }

  const issuedAt = now();
  const nonce = randomState();
  // state에 시작한 GitHub 사용자를 묶어 다른 사용자의 callback으로 연결이 넘어가지 않게 한다.
  const stateCookie = await stateCodec.seal(
    { nonce, ownerUserId: session.userId, returnTo },
    { expiresAt: issuedAt + STATE_TTL_SECONDS, issuedAt },
  );
  const authorize = new URL("https://api.notion.com/v1/oauth/authorize");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("owner", "user");
  authorize.searchParams.set("redirect_uri", callbackUri(appOrigin));
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("state", nonce);

  return redirectResponse(authorize, 302, [
    serializeCookie(STATE_COOKIE, stateCookie, {
      maxAge: STATE_TTL_SECONDS,
      secure: secureCookies,
    }),
  ]);
}

/**
 * `GET /auth/notion/callback?code&state`
 * 같은 워크스페이스를 다시 연결하면 기존 연결을 교체하고 이전 token을 revoke한다.
 * 저장하지 못한 새 token(상한 초과)은 바로 revoke한다.
 */
export async function finishNotionConnection(
  request: Request,
  dependencies: NotionAuthDependencies,
): Promise<Response> {
  const { appOrigin, connectionsCodec, notion, now, secureCookies, sessionCodec, stateCodec } =
    dependencies;
  const clearState = serializeExpiredCookie(STATE_COOKIE, secureCookies);
  const session = await readSession(request, sessionCodec);
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const returnedState = params.get("state");
  const stateValue = readCookie(request, STATE_COOKIE);
  if (
    session === null ||
    params.has("error") ||
    !isOAuthValue(code) ||
    !isOAuthValue(returnedState) ||
    stateValue === null
  ) {
    return callbackError(400, "invalid_notion_callback", clearState);
  }

  const state = await stateCodec.open(stateValue);
  if (
    state === null ||
    state.payload.ownerUserId !== session.userId ||
    !secureStringEqual(state.payload.nonce, returnedState) ||
    !isAllowedReturnTo(state.payload.returnTo)
  ) {
    return callbackError(400, "invalid_notion_state", clearState);
  }

  const current = await readConnections(request, connectionsCodec);
  if (current === null) {
    return callbackError(400, "invalid_connections_cookie", clearState);
  }

  let grant: Awaited<ReturnType<NotionOAuthClient["authorize"]>>;
  try {
    grant = await notion.authorize(code, callbackUri(appOrigin));
  } catch (error) {
    return error instanceof NotionAuthenticationError && error.code === "timeout"
      ? callbackError(504, "notion_timeout", clearState)
      : callbackError(502, "notion_authentication_failed", clearState);
  }

  const replaced = current.connections.find(
    (item) => item.ownerUserId === session.userId && item.workspaceId === grant.workspaceId,
  );
  if (replaced === undefined && current.connections.length >= MAX_CONNECTIONS) {
    await bestEffortRevoke(notion, grant.accessToken);
    return callbackError(409, "notion_connection_limit_reached", clearState);
  }

  const connection: NotionConnection = {
    accessToken: grant.accessToken,
    botId: grant.botId,
    connectedAt: now(),
    connectionId: grant.workspaceId,
    ownerUserId: session.userId,
    refreshToken: grant.refreshToken,
    workspaceIcon: grant.workspaceIcon,
    workspaceId: grant.workspaceId,
    workspaceName: grant.workspaceName,
  };
  const next =
    replaced === undefined
      ? [...current.connections, connection]
      : current.connections.map((item) => (item === replaced ? connection : item));
  const cookie = await sealConnections(next, dependencies);
  if (cookie === null) {
    await bestEffortRevoke(notion, grant.accessToken);
    return callbackError(409, "notion_connection_cookie_too_large", clearState);
  }
  if (replaced !== undefined && replaced.accessToken !== grant.accessToken) {
    await bestEffortRevoke(notion, replaced.accessToken);
  }

  return redirectResponse(new URL(state.payload.returnTo, appOrigin), 302, [
    clearState,
    cookie,
  ]);
}

/** `GET /api/notion/connections`: 현재 사용자의 연결 목록. token은 응답에 넣지 않는다. */
export async function listNotionConnections(
  request: Request,
  { connectionsCodec, sessionCodec }: NotionAuthDependencies,
): Promise<Response> {
  const session = await readSession(request, sessionCodec);
  if (session === null) {
    return errorResponse(401, "authentication_required");
  }
  const payload = await readConnections(request, connectionsCodec);
  if (payload === null) {
    return errorResponse(400, "invalid_connections_cookie");
  }
  return Response.json(
    {
      connections: payload.connections
        .filter((item) => item.ownerUserId === session.userId)
        .map(({ connectedAt, connectionId, workspaceIcon, workspaceName }) => ({
          connectedAt,
          connectionId,
          workspaceIcon,
          workspaceName,
        })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

/** 다른 route가 Notion을 호출하기 전에 현재 사용자 소유의 연결인지 요청마다 확인한다. */
export async function getOwnedNotionConnection(
  request: Request,
  connectionId: string,
  { connectionsCodec, sessionCodec }: Pick<NotionAuthDependencies, "connectionsCodec" | "sessionCodec">,
): Promise<NotionConnectionAccess> {
  const session = await readSession(request, sessionCodec);
  if (session === null) {
    return { kind: "authentication_required" };
  }
  const payload = await readConnections(request, connectionsCodec);
  if (payload === null) {
    return { kind: "invalid_connections_cookie" };
  }
  const connection = payload.connections.find(
    (item) => item.ownerUserId === session.userId && item.connectionId === connectionId,
  );
  return connection === undefined
    ? { kind: "notion_connection_not_found" }
    : { connection, kind: "allowed" };
}

const disconnectSchema = z.object({ connectionId: z.string().uuid() });

/** `POST /api/notion/connections/disconnect`: Notion에서 token을 revoke한 뒤에만 쿠키에서 지운다. */
export async function disconnectNotion(
  request: Request,
  dependencies: NotionAuthDependencies,
): Promise<Response> {
  const { appOrigin, connectionsCodec, notion, secureCookies, sessionCodec } = dependencies;
  if (request.headers.get("origin") !== appOrigin) {
    return errorResponse(403, "invalid_origin");
  }
  const session = await readSession(request, sessionCodec);
  if (session === null) {
    return errorResponse(401, "authentication_required");
  }
  const input = disconnectSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return errorResponse(400, "invalid_disconnect_request");
  }
  const payload = await readConnections(request, connectionsCodec);
  if (payload === null) {
    return errorResponse(400, "invalid_connections_cookie");
  }
  const connection = payload.connections.find(
    (item) =>
      item.ownerUserId === session.userId && item.connectionId === input.data.connectionId,
  );
  if (connection === undefined) {
    return errorResponse(404, "notion_connection_not_found");
  }

  try {
    await notion.revoke(connection.accessToken);
  } catch {
    return errorResponse(502, "notion_revoke_failed");
  }
  const remaining = payload.connections.filter((item) => item !== connection);
  const headers = new Headers({ "cache-control": "no-store" });
  const cookies =
    remaining.length === 0
      ? expiredCookies(CONNECTIONS_COOKIE, secureCookies)
      : // 남은 연결은 이미 저장돼 있던 값이라 크기 상한을 넘지 않는다.
        [(await sealConnections(remaining, dependencies)) as string];
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { headers, status: 204 });
}

const environmentSchema = z.object({
  APP_ORIGIN: z.string().url(),
  COOKIE_ACTIVE_KEY_ID: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  NOTION_API_VERSION: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  NOTION_OAUTH_CLIENT_ID: z.string().min(1).max(255),
  NOTION_OAUTH_CLIENT_SECRET: z.string().min(1).max(4096),
});

export function createNotionAuthDependencies(
  environment: NodeJS.ProcessEnv = process.env,
): NotionAuthDependencies {
  const env = environmentSchema.parse(environment);
  const { origin, secure } = parseAppOrigin(env.APP_ORIGIN);
  const codecOptions = {
    activeKeyId: env.COOKIE_ACTIVE_KEY_ID,
    keys: cookieKeysFromEnvironment(environment),
  };
  return {
    appOrigin: origin,
    clientId: env.NOTION_OAUTH_CLIENT_ID,
    connectionsCodec: createEncryptedCookieCodec({
      ...codecOptions,
      parsePayload: (value) => connectionsPayloadSchema.parse(value),
    }),
    notion: createNotionOAuthClient({
      apiVersion: env.NOTION_API_VERSION,
      clientId: env.NOTION_OAUTH_CLIENT_ID,
      clientSecret: env.NOTION_OAUTH_CLIENT_SECRET,
    }),
    now: currentUnixTimestamp,
    randomState: () => randomBytes(32).toString("base64url"),
    secureCookies: secure,
    sessionCodec: createSessionCookieCodec(codecOptions),
    stateCodec: createEncryptedCookieCodec({
      ...codecOptions,
      parsePayload: (value) => stateSchema.parse(value),
    }),
  };
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1).max(4096),
  bot_id: z.string().uuid(),
  refresh_token: z.string().min(1).max(4096).nullable(),
  token_type: z.literal("bearer"),
  workspace_icon: z.string().max(2048).nullable(),
  workspace_id: z.string().uuid(),
  workspace_name: z.string().max(255).nullable(),
});

/** Notion OAuth REST 호출(client ID·secret Basic 인증). 실패는 timeout과 unavailable로만 구분한다. */
export function createNotionOAuthClient(options: {
  apiVersion: string;
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  log?: LogSink;
  timeoutMs?: number;
}): NotionOAuthClient {
  const authorization = `Basic ${Buffer.from(
    `${options.clientId}:${options.clientSecret}`,
  ).toString("base64")}`;

  async function post(url: string, body: unknown, operation: string): Promise<Response> {
    let response: Response;
    try {
      response = await providerRequest({
        fetch: options.fetch ?? fetch,
        init: {
          body: JSON.stringify(body),
          headers: {
            accept: "application/json",
            authorization,
            "content-type": "application/json",
            "notion-version": options.apiVersion,
          },
          method: "POST",
        },
        input: url,
        log: options.log,
        operation,
        provider: "notion",
        timeoutMs: options.timeoutMs,
      });
    } catch (error) {
      throw error instanceof ProviderTransportError
        ? new NotionAuthenticationError(error.code)
        : error;
    }
    if (!response.ok) {
      throw new NotionAuthenticationError();
    }
    return response;
  }

  return {
    async authorize(code, redirectUri) {
      const response = await post(
        "https://api.notion.com/v1/oauth/token",
        { code, grant_type: "authorization_code", redirect_uri: redirectUri },
        "oauth.token",
      );
      const token = tokenResponseSchema.safeParse(await response.json().catch(() => null));
      if (!token.success) {
        throw new NotionAuthenticationError();
      }
      return {
        accessToken: token.data.access_token,
        botId: token.data.bot_id,
        refreshToken: token.data.refresh_token,
        workspaceIcon: token.data.workspace_icon,
        workspaceId: token.data.workspace_id,
        workspaceName: token.data.workspace_name?.trim() || "이름 없는 워크스페이스",
      };
    },
    async revoke(accessToken) {
      await post("https://api.notion.com/v1/oauth/revoke", { token: accessToken }, "oauth.revoke");
    },
  };
}

/** 연결 쿠키가 없으면 빈 목록, 있는데 열 수 없으면(위조·만료·형식 오류) `null`. */
async function readConnections(
  request: Request,
  codec: EncryptedCookieCodec<NotionConnectionsPayload>,
): Promise<NotionConnectionsPayload | null> {
  const value = readCookie(request, CONNECTIONS_COOKIE);
  if (value === null) {
    return { connections: [] };
  }
  return (await codec.open(value))?.payload ?? null;
}

/** 연결 목록을 `Set-Cookie` 값으로 만든다. 크기 상한을 넘으면 `null`. */
async function sealConnections(
  connections: NotionConnection[],
  { connectionsCodec, now, secureCookies }: NotionAuthDependencies,
): Promise<string | null> {
  const issuedAt = now();
  const value = await connectionsCodec.seal(
    { connections },
    { expiresAt: issuedAt + CONNECTIONS_TTL_SECONDS, issuedAt },
  );
  return Buffer.byteLength(value) > MAX_COOKIE_VALUE_BYTES
    ? null
    : serializeCookie(CONNECTIONS_COOKIE, value, {
        maxAge: CONNECTIONS_TTL_SECONDS,
        secure: secureCookies,
      });
}

/** 저장하지 않을 token을 정리한다. 실패해도 token이 쿠키에 남지 않으므로 응답은 바꾸지 않는다. */
async function bestEffortRevoke(notion: NotionOAuthClient, token: string): Promise<void> {
  await notion.revoke(token).catch(() => undefined);
}

function callbackUri(origin: string): string {
  return `${origin}/auth/notion/callback`;
}

function isOAuthValue(value: string | null): value is string {
  return value !== null && value.length > 0 && value.length <= 1024;
}
