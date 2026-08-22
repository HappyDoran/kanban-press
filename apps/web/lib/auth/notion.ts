import { randomBytes } from "node:crypto";

import type {
  EncryptedCookieCodec,
} from "@notion-kanban-blog/auth/server";
import {
  createEncryptedCookieCodec,
  createSessionCookieCodec,
} from "@notion-kanban-blog/auth/server";
import { z } from "zod";

import {
  providerRequest,
  ProviderTransportError,
} from "../operations/provider-request";
import type { LogSink } from "../operations/structured-log";

import {
  cookieKeysFromEnvironment,
  currentUnixTimestamp,
  errorResponse,
  isAllowedReturnTo,
  readCookie,
  secureStringEqual,
  serializeCookie,
  serializeExpiredCookie,
  SESSION_COOKIE,
} from "./github";

import type { SessionCodec, UnixTimestamp } from "@notion-kanban-blog/auth";

const NOTION_AUTHORIZE_URL = "https://api.notion.com/v1/oauth/authorize";
const NOTION_TOKEN_URL = "https://api.notion.com/v1/oauth/token";
const NOTION_REVOKE_URL = "https://api.notion.com/v1/oauth/revoke";
const NOTION_STATE_COOKIE = "nkb_notion_oauth_state";
const NOTION_CONNECTIONS_COOKIE = "nkb_notion_connections";
const STATE_TTL_SECONDS = 10 * 60;
const CONNECTIONS_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_CONNECTIONS = 3;
const MAX_COOKIE_VALUE_BYTES = 3_800;

const notionStateSchema = z
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

const tokenResponseSchema = z
  .object({
    access_token: z.string().min(1).max(4096),
    bot_id: z.string().uuid(),
    refresh_token: z.string().min(1).max(4096).nullable(),
    token_type: z.literal("bearer"),
    workspace_icon: z.string().max(2048).nullable(),
    workspace_id: z.string().uuid(),
    workspace_name: z.string().max(255).nullable(),
  })
  .passthrough();

const environmentSchema = z.object({
  APP_ORIGIN: z.string().url(),
  COOKIE_ACTIVE_KEY_ID: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  NOTION_API_VERSION: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  NOTION_OAUTH_CLIENT_ID: z.string().min(1).max(255),
  NOTION_OAUTH_CLIENT_SECRET: z.string().min(1).max(4096),
});

const disconnectSchema = z.object({
  connectionId: z.string().uuid(),
});

export type NotionConnection = z.infer<typeof connectionSchema>;
export type NotionConnectionsPayload = z.infer<typeof connectionsPayloadSchema>;
export type NotionOAuthState = z.infer<typeof notionStateSchema>;

export type NotionConnectionAccess =
  | { kind: "allowed"; connection: NotionConnection }
  | {
      kind:
        | "authentication_required"
        | "invalid_connections_cookie"
        | "notion_connection_not_found";
    };

export interface NotionOAuthClient {
  authorize(code: string, redirectUri: string): Promise<{
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

interface NotionApiClientOptions {
  apiVersion: string;
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  log?: LogSink;
  timeoutMs?: number;
}

export class NotionApiClient implements NotionOAuthClient {
  readonly #apiVersion: string;
  readonly #authorization: string;
  readonly #fetch: typeof fetch;
  readonly #log: LogSink | undefined;
  readonly #timeoutMs: number | undefined;

  constructor(options: NotionApiClientOptions) {
    this.#apiVersion = options.apiVersion;
    this.#authorization = `Basic ${Buffer.from(
      `${options.clientId}:${options.clientSecret}`,
    ).toString("base64")}`;
    this.#fetch = options.fetch ?? fetch;
    this.#log = options.log;
    this.#timeoutMs = options.timeoutMs;
  }

  async authorize(code: string, redirectUri: string) {
    const response = await this.#request(NOTION_TOKEN_URL, {
      body: JSON.stringify({
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
      headers: this.#headers(),
      method: "POST",
    }, "oauth.token");
    if (!response.ok) {
      throw new NotionAuthenticationError();
    }
    const parsed = tokenResponseSchema.safeParse(await readJson(response));
    if (!parsed.success) {
      throw new NotionAuthenticationError();
    }
    return {
      accessToken: parsed.data.access_token,
      botId: parsed.data.bot_id,
      refreshToken: parsed.data.refresh_token,
      workspaceIcon: parsed.data.workspace_icon,
      workspaceId: parsed.data.workspace_id,
      workspaceName: parsed.data.workspace_name?.trim() || "이름 없는 워크스페이스",
    };
  }

  async revoke(accessToken: string): Promise<void> {
    const response = await this.#request(NOTION_REVOKE_URL, {
      body: JSON.stringify({ token: accessToken }),
      headers: this.#headers(),
      method: "POST",
    }, "oauth.revoke");
    if (!response.ok) {
      throw new NotionAuthenticationError();
    }
  }

  #headers(): Record<string, string> {
    return {
      accept: "application/json",
      authorization: this.#authorization,
      "content-type": "application/json",
      "notion-version": this.#apiVersion,
    };
  }

  async #request(
    input: RequestInfo | URL,
    init: RequestInit,
    operation: string,
  ): Promise<Response> {
    try {
      return await providerRequest({
        fetch: this.#fetch,
        init,
        input,
        log: this.#log,
        operation,
        provider: "notion",
        timeoutMs: this.#timeoutMs,
      });
    } catch (error) {
      if (error instanceof ProviderTransportError) {
        throw new NotionAuthenticationError(error.code);
      }
      throw error;
    }
  }
}

export class NotionAuthenticationError extends Error {
  override readonly name = "NotionAuthenticationError";
  constructor(readonly code: "timeout" | "unavailable" = "unavailable") {
    super("Notion authentication failed");
  }
}

export async function startNotionConnection(
  request: Request,
  dependencies: NotionAuthDependencies,
): Promise<Response> {
  const session = await readSession(request, dependencies.sessionCodec);
  if (session === null) {
    return errorResponse(401, "authentication_required");
  }
  const returnTo = new URL(request.url).searchParams.get("returnTo") ?? "/";
  if (!isAllowedReturnTo(returnTo)) {
    return errorResponse(400, "invalid_return_to");
  }

  const now = dependencies.now();
  const nonce = dependencies.randomState();
  const stateCookie = await dependencies.stateCodec.seal(
    { nonce, ownerUserId: session.userId, returnTo },
    { expiresAt: now + STATE_TTL_SECONDS, issuedAt: now },
  );
  const authorizeUrl = new URL(NOTION_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", dependencies.clientId);
  authorizeUrl.searchParams.set("owner", "user");
  authorizeUrl.searchParams.set("redirect_uri", callbackUri(dependencies.appOrigin));
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("state", nonce);

  const headers = new Headers({
    "cache-control": "no-store",
    location: authorizeUrl.toString(),
  });
  headers.append(
    "set-cookie",
    serializeCookie(NOTION_STATE_COOKIE, stateCookie, {
      maxAge: STATE_TTL_SECONDS,
      secure: dependencies.secureCookies,
    }),
  );
  return new Response(null, { headers, status: 302 });
}

export async function finishNotionConnection(
  request: Request,
  dependencies: NotionAuthDependencies,
): Promise<Response> {
  const clearState = serializeExpiredCookie(
    NOTION_STATE_COOKIE,
    dependencies.secureCookies,
  );
  const session = await readSession(request, dependencies.sessionCodec);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const stateValue = readCookie(request, NOTION_STATE_COOKIE);
  if (
    session === null ||
    url.searchParams.has("error") ||
    !isOAuthValue(code) ||
    !isOAuthValue(returnedState) ||
    stateValue === null
  ) {
    return callbackError("invalid_notion_callback", clearState);
  }

  const state = await dependencies.stateCodec.open(stateValue);
  if (
    state === null ||
    state.payload.ownerUserId !== session.userId ||
    !secureStringEqual(state.payload.nonce, returnedState) ||
    !isAllowedReturnTo(state.payload.returnTo)
  ) {
    return callbackError("invalid_notion_state", clearState);
  }

  const current = await readConnections(request, dependencies.connectionsCodec);
  if (current === null) {
    return callbackError("invalid_connections_cookie", clearState);
  }

  try {
    const grant = await dependencies.notion.authorize(
      code,
      callbackUri(dependencies.appOrigin),
    );
    const existingIndex = current.connections.findIndex(
      (connection) =>
        connection.ownerUserId === session.userId &&
        connection.workspaceId === grant.workspaceId,
    );
    if (existingIndex < 0 && current.connections.length >= MAX_CONNECTIONS) {
      await bestEffortRevoke(dependencies.notion, grant.accessToken);
      return callbackError("notion_connection_limit_reached", clearState, 409);
    }

    const connection: NotionConnection = {
      accessToken: grant.accessToken,
      botId: grant.botId,
      connectedAt: dependencies.now(),
      connectionId: grant.workspaceId,
      ownerUserId: session.userId,
      refreshToken: grant.refreshToken,
      workspaceIcon: grant.workspaceIcon,
      workspaceId: grant.workspaceId,
      workspaceName: grant.workspaceName,
    };
    const nextConnections = [...current.connections];
    const replaced =
      existingIndex >= 0 ? (nextConnections[existingIndex] ?? null) : null;
    if (existingIndex >= 0) {
      nextConnections[existingIndex] = connection;
    } else {
      nextConnections.push(connection);
    }
    const now = dependencies.now();
    const cookieValue = await dependencies.connectionsCodec.seal(
      { connections: nextConnections },
      { expiresAt: now + CONNECTIONS_TTL_SECONDS, issuedAt: now },
    );
    if (Buffer.byteLength(cookieValue) > MAX_COOKIE_VALUE_BYTES) {
      await bestEffortRevoke(dependencies.notion, grant.accessToken);
      return callbackError("notion_connection_cookie_too_large", clearState, 409);
    }
    if (replaced !== null && replaced.accessToken !== grant.accessToken) {
      await bestEffortRevoke(dependencies.notion, replaced.accessToken);
    }

    const headers = new Headers({
      "cache-control": "no-store",
      location: new URL(state.payload.returnTo, dependencies.appOrigin).toString(),
    });
    headers.append("set-cookie", clearState);
    headers.append(
      "set-cookie",
      serializeCookie(NOTION_CONNECTIONS_COOKIE, cookieValue, {
        maxAge: CONNECTIONS_TTL_SECONDS,
        secure: dependencies.secureCookies,
      }),
    );
    return new Response(null, { headers, status: 302 });
  } catch (error) {
    return callbackError(
      error instanceof NotionAuthenticationError && error.code === "timeout"
        ? "notion_timeout"
        : "notion_authentication_failed",
      clearState,
      error instanceof NotionAuthenticationError && error.code === "timeout"
        ? 504
        : 502,
    );
  }
}

export async function listNotionConnections(
  request: Request,
  dependencies: NotionAuthDependencies,
): Promise<Response> {
  const session = await readSession(request, dependencies.sessionCodec);
  if (session === null) {
    return errorResponse(401, "authentication_required");
  }
  const payload = await readConnections(request, dependencies.connectionsCodec);
  if (payload === null) {
    return errorResponse(400, "invalid_connections_cookie");
  }
  return Response.json(
    {
      connections: payload.connections
        .filter((connection) => connection.ownerUserId === session.userId)
        .map((connection) => ({
          connectedAt: connection.connectedAt,
          connectionId: connection.connectionId,
          workspaceIcon: connection.workspaceIcon,
          workspaceName: connection.workspaceName,
        })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function getOwnedNotionConnection(
  request: Request,
  connectionId: string,
  dependencies: Pick<
    NotionAuthDependencies,
    "connectionsCodec" | "sessionCodec"
  >,
): Promise<NotionConnectionAccess> {
  const session = await readSession(request, dependencies.sessionCodec);
  if (session === null) {
    return { kind: "authentication_required" };
  }
  const payload = await readConnections(request, dependencies.connectionsCodec);
  if (payload === null) {
    return { kind: "invalid_connections_cookie" };
  }
  const connection = payload.connections.find(
    (item) =>
      item.ownerUserId === session.userId &&
      item.connectionId === connectionId,
  );
  return connection === undefined
    ? { kind: "notion_connection_not_found" }
    : { connection, kind: "allowed" };
}

export async function disconnectNotion(
  request: Request,
  dependencies: NotionAuthDependencies,
): Promise<Response> {
  if (request.headers.get("origin") !== dependencies.appOrigin) {
    return errorResponse(403, "invalid_origin");
  }
  const session = await readSession(request, dependencies.sessionCodec);
  if (session === null) {
    return errorResponse(401, "authentication_required");
  }
  const input = disconnectSchema.safeParse(await safeJson(request));
  if (!input.success) {
    return errorResponse(400, "invalid_disconnect_request");
  }
  const payload = await readConnections(request, dependencies.connectionsCodec);
  if (payload === null) {
    return errorResponse(400, "invalid_connections_cookie");
  }
  const connection = payload.connections.find(
    (item) =>
      item.ownerUserId === session.userId &&
      item.connectionId === input.data.connectionId,
  );
  if (connection === undefined) {
    return errorResponse(404, "notion_connection_not_found");
  }

  try {
    await dependencies.notion.revoke(connection.accessToken);
  } catch {
    return errorResponse(502, "notion_revoke_failed");
  }
  const remaining = payload.connections.filter(
    (item) =>
      !(
        item.ownerUserId === session.userId &&
        item.connectionId === connection.connectionId
      ),
  );
  const headers = new Headers({ "cache-control": "no-store" });
  if (remaining.length === 0) {
    headers.append(
      "set-cookie",
      serializeExpiredCookie(
        NOTION_CONNECTIONS_COOKIE,
        dependencies.secureCookies,
      ),
    );
  } else {
    const now = dependencies.now();
    const value = await dependencies.connectionsCodec.seal(
      { connections: remaining },
      { expiresAt: now + CONNECTIONS_TTL_SECONDS, issuedAt: now },
    );
    headers.append(
      "set-cookie",
      serializeCookie(NOTION_CONNECTIONS_COOKIE, value, {
        maxAge: CONNECTIONS_TTL_SECONDS,
        secure: dependencies.secureCookies,
      }),
    );
  }
  return new Response(null, { headers, status: 204 });
}

export function createNotionAuthDependencies(
  environment: NodeJS.ProcessEnv = process.env,
): NotionAuthDependencies {
  const parsed = environmentSchema.parse(environment);
  const origin = new URL(parsed.APP_ORIGIN);
  if (
    origin.origin !== parsed.APP_ORIGIN ||
    (origin.protocol !== "https:" &&
      origin.hostname !== "localhost" &&
      origin.hostname !== "127.0.0.1")
  ) {
    throw new Error("APP_ORIGIN must be an exact HTTPS origin or localhost");
  }
  const codecOptions = {
    activeKeyId: parsed.COOKIE_ACTIVE_KEY_ID,
    keys: cookieKeysFromEnvironment(environment),
  };
  return {
    appOrigin: origin.origin,
    clientId: parsed.NOTION_OAUTH_CLIENT_ID,
    connectionsCodec: createEncryptedCookieCodec({
      ...codecOptions,
      parsePayload: (value) => connectionsPayloadSchema.parse(value),
    }),
    notion: new NotionApiClient({
      apiVersion: parsed.NOTION_API_VERSION,
      clientId: parsed.NOTION_OAUTH_CLIENT_ID,
      clientSecret: parsed.NOTION_OAUTH_CLIENT_SECRET,
    }),
    now: currentUnixTimestamp,
    randomState: () => randomBytes(32).toString("base64url"),
    secureCookies: origin.protocol === "https:",
    sessionCodec: createSessionCookieCodec(codecOptions),
    stateCodec: createEncryptedCookieCodec({
      ...codecOptions,
      parsePayload: (value) => notionStateSchema.parse(value),
    }),
  };
}

async function readSession(request: Request, codec: SessionCodec) {
  const value = readCookie(request, SESSION_COOKIE);
  return value === null ? null : codec.open(value);
}

async function readConnections(
  request: Request,
  codec: EncryptedCookieCodec<NotionConnectionsPayload>,
): Promise<NotionConnectionsPayload | null> {
  const value = readCookie(request, NOTION_CONNECTIONS_COOKIE);
  if (value === null) {
    return { connections: [] };
  }
  const opened = await codec.open(value);
  return opened?.payload ?? null;
}

function callbackUri(origin: string): string {
  return `${origin}/auth/notion/callback`;
}

function isOAuthValue(value: string | null): value is string {
  return value !== null && value.length > 0 && value.length <= 1024;
}

function callbackError(code: string, clearState: string, status = 400): Response {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json",
  });
  headers.append("set-cookie", clearState);
  return new Response(JSON.stringify({ error: code }), { headers, status });
}

async function bestEffortRevoke(
  notion: NotionOAuthClient,
  token: string,
): Promise<void> {
  try {
    await notion.revoke(token);
  } catch {
    // The new credential is never stored; provider-side cleanup can be retried manually.
  }
}

async function safeJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new NotionAuthenticationError();
  }
}
