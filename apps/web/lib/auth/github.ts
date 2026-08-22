import { randomBytes, timingSafeEqual } from "node:crypto";

import type { SessionCodec, UnixTimestamp } from "@notion-kanban-blog/auth";
import {
  createEncryptedCookieCodec,
  createSessionCookieCodec,
  decodeBase64UrlKey,
} from "@notion-kanban-blog/auth/server";
import { entityId } from "@notion-kanban-blog/domain";
import { z } from "zod";

import {
  providerRequest,
  ProviderTransportError,
} from "../operations/provider-request";
import type { LogSink } from "../operations/structured-log";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_SCOPE = "read:user public_repo workflow";
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const OAUTH_STATE_COOKIE = "nkb_oauth_state";
export const SESSION_COOKIE = "nkb_session";

const oauthStatePayloadSchema = z
  .object({
    nonce: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
    returnTo: z.string().min(1).max(512),
  })
  .strict();

const tokenResponseSchema = z
  .object({
    access_token: z.string().min(1).max(4096),
    token_type: z.literal("bearer"),
  })
  .passthrough();

const githubUserSchema = z
  .object({
    id: z.number().int().safe().positive(),
    login: z.string().min(1).max(255),
  })
  .passthrough();

const runtimeEnvironmentSchema = z.object({
  APP_ORIGIN: z.string().url(),
  COOKIE_ACTIVE_KEY_ID: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  GITHUB_API_VERSION: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  GITHUB_OAUTH_CLIENT_ID: z.string().min(1).max(255),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().min(1).max(4096),
});

export interface OAuthStatePayload {
  nonce: string;
  returnTo: string;
}

export interface GitHubIdentity {
  id: string;
  login: string;
}

export interface GitHubOAuthClient {
  authenticate(code: string, redirectUri: string): Promise<{
    accessToken: string;
    identity: GitHubIdentity;
  }>;
}

export interface GitHubAuthConfig {
  appOrigin: string;
  clientId: string;
  secureCookies: boolean;
}

export interface GitHubAuthDependencies {
  config: GitHubAuthConfig;
  github: GitHubOAuthClient;
  now: () => UnixTimestamp;
  randomState: () => string;
  sessionCodec: SessionCodec;
  stateCodec: ReturnType<
    typeof createEncryptedCookieCodec<OAuthStatePayload>
  >;
}

interface GitHubApiClientOptions {
  apiVersion: string;
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  log?: LogSink;
  timeoutMs?: number;
}

export class GitHubApiClient implements GitHubOAuthClient {
  readonly #apiVersion: string;
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #fetch: typeof fetch;
  readonly #log: LogSink | undefined;
  readonly #timeoutMs: number | undefined;

  constructor(options: GitHubApiClientOptions) {
    this.#apiVersion = options.apiVersion;
    this.#clientId = options.clientId;
    this.#clientSecret = options.clientSecret;
    this.#fetch = options.fetch ?? fetch;
    this.#log = options.log;
    this.#timeoutMs = options.timeoutMs;
  }

  async authenticate(code: string, redirectUri: string) {
    const tokenResponse = await this.#request(GITHUB_TOKEN_URL, {
      body: new URLSearchParams({
        client_id: this.#clientId,
        client_secret: this.#clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "notion-kanban-blog",
      },
      method: "POST",
    }, "oauth.token");
    if (!tokenResponse.ok) {
      throw new GitHubAuthenticationError();
    }

    const tokenResult = tokenResponseSchema.safeParse(
      await readJson(tokenResponse),
    );
    if (!tokenResult.success) {
      throw new GitHubAuthenticationError();
    }

    const accessToken = tokenResult.data.access_token;
    const userResponse = await this.#request(GITHUB_USER_URL, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${accessToken}`,
        "user-agent": "notion-kanban-blog",
        "x-github-api-version": this.#apiVersion,
      },
    }, "identity.get");
    if (!userResponse.ok) {
      throw new GitHubAuthenticationError();
    }

    const userResult = githubUserSchema.safeParse(await readJson(userResponse));
    if (!userResult.success) {
      throw new GitHubAuthenticationError();
    }

    return {
      accessToken,
      identity: {
        id: String(userResult.data.id),
        login: userResult.data.login,
      },
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
        provider: "github",
        timeoutMs: this.#timeoutMs,
      });
    } catch (error) {
      if (error instanceof ProviderTransportError) {
        throw new GitHubAuthenticationError(error.code);
      }
      throw error;
    }
  }
}

export class GitHubAuthenticationError extends Error {
  override readonly name = "GitHubAuthenticationError";

  constructor(readonly code: "timeout" | "unavailable" = "unavailable") {
    super("GitHub authentication failed");
  }
}

export async function startGitHubLogin(
  request: Request,
  dependencies: GitHubAuthDependencies,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const returnTo = requestUrl.searchParams.get("returnTo") ?? "/";
  if (!isAllowedReturnTo(returnTo)) {
    return errorResponse(400, "invalid_return_to");
  }

  if (requestUrl.origin !== dependencies.config.appOrigin) {
    const canonicalStart = new URL(
      "/auth/github/start",
      dependencies.config.appOrigin,
    );
    canonicalStart.searchParams.set("returnTo", returnTo);
    return new Response(null, {
      headers: {
        "cache-control": "no-store",
        location: canonicalStart.toString(),
      },
      status: 307,
    });
  }

  const now = dependencies.now();
  const nonce = dependencies.randomState();
  const payload = oauthStatePayloadSchema.parse({ nonce, returnTo });
  const stateCookie = await dependencies.stateCodec.seal(payload, {
    expiresAt: now + OAUTH_STATE_TTL_SECONDS,
    issuedAt: now,
  });

  const authorizationUrl = new URL(GITHUB_AUTHORIZE_URL);
  authorizationUrl.searchParams.set("client_id", dependencies.config.clientId);
  authorizationUrl.searchParams.set(
    "redirect_uri",
    callbackUri(dependencies.config.appOrigin),
  );
  authorizationUrl.searchParams.set("scope", GITHUB_SCOPE);
  authorizationUrl.searchParams.set("state", nonce);

  const headers = new Headers({
    "cache-control": "no-store",
    location: authorizationUrl.toString(),
  });
  headers.append(
    "set-cookie",
    serializeCookie(OAUTH_STATE_COOKIE, stateCookie, {
      maxAge: OAUTH_STATE_TTL_SECONDS,
      secure: dependencies.config.secureCookies,
    }),
  );
  return new Response(null, { headers, status: 302 });
}

export async function finishGitHubLogin(
  request: Request,
  dependencies: GitHubAuthDependencies,
): Promise<Response> {
  const clearStateCookie = serializeExpiredCookie(
    OAUTH_STATE_COOKIE,
    dependencies.config.secureCookies,
  );
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const returnedState = requestUrl.searchParams.get("state");
  const stateCookie = readCookie(request, OAUTH_STATE_COOKIE);

  if (
    requestUrl.searchParams.has("error") ||
    !isBoundedOAuthValue(code) ||
    !isBoundedOAuthValue(returnedState) ||
    stateCookie === null
  ) {
    return callbackError("invalid_oauth_callback", clearStateCookie);
  }

  const openedState = await dependencies.stateCodec.open(stateCookie);
  if (
    openedState === null ||
    !secureStringEqual(openedState.payload.nonce, returnedState) ||
    !isAllowedReturnTo(openedState.payload.returnTo)
  ) {
    return callbackError("invalid_oauth_state", clearStateCookie);
  }

  try {
    const authenticated = await dependencies.github.authenticate(
      code,
      callbackUri(dependencies.config.appOrigin),
    );
    const now = dependencies.now();
    const sessionCookie = await dependencies.sessionCodec.seal({
      accessToken: authenticated.accessToken,
      expiresAt: now + SESSION_TTL_SECONDS,
      githubLogin: authenticated.identity.login,
      issuedAt: now,
      userId: entityId("GitHubUser", authenticated.identity.id),
    });

    const headers = new Headers({
      "cache-control": "no-store",
      location: new URL(
        openedState.payload.returnTo,
        dependencies.config.appOrigin,
      ).toString(),
    });
    headers.append("set-cookie", clearStateCookie);
    headers.append(
      "set-cookie",
      serializeCookie(SESSION_COOKIE, sessionCookie, {
        maxAge: SESSION_TTL_SECONDS,
        secure: dependencies.config.secureCookies,
      }),
    );
    return new Response(null, { headers, status: 302 });
  } catch (error) {
    return callbackError(
      error instanceof GitHubAuthenticationError && error.code === "timeout"
        ? "github_timeout"
        : "github_authentication_failed",
      clearStateCookie,
      error instanceof GitHubAuthenticationError && error.code === "timeout"
        ? 504
        : 502,
    );
  }
}

export async function getCurrentUser(
  request: Request,
  dependencies: Pick<GitHubAuthDependencies, "sessionCodec">,
): Promise<Response> {
  const sessionCookie = readCookie(request, SESSION_COOKIE);
  const session =
    sessionCookie === null
      ? null
      : await dependencies.sessionCodec.open(sessionCookie);
  if (session === null) {
    return Response.json(
      { authenticated: false },
      {
        headers: { "cache-control": "no-store" },
        status: 401,
      },
    );
  }

  return Response.json(
    {
      authenticated: true,
      user: {
        id: session.userId,
        login: session.githubLogin,
      },
    },
    {
      headers: { "cache-control": "no-store" },
      status: 200,
    },
  );
}

export function logout(
  request: Request,
  dependencies: Pick<GitHubAuthDependencies, "config">,
): Response {
  if (request.headers.get("origin") !== dependencies.config.appOrigin) {
    return errorResponse(403, "invalid_origin");
  }

  const headers = new Headers({ "cache-control": "no-store" });
  headers.append(
    "set-cookie",
    serializeExpiredCookie(
      SESSION_COOKIE,
      dependencies.config.secureCookies,
    ),
  );
  headers.append(
    "set-cookie",
    serializeExpiredCookie(
      OAUTH_STATE_COOKIE,
      dependencies.config.secureCookies,
    ),
  );
  return new Response(null, { headers, status: 204 });
}

export function createGitHubAuthDependencies(
  environment: NodeJS.ProcessEnv = process.env,
): GitHubAuthDependencies {
  const parsedEnvironment = runtimeEnvironmentSchema.parse(environment);
  const appOriginUrl = new URL(parsedEnvironment.APP_ORIGIN);
  if (
    appOriginUrl.origin !== parsedEnvironment.APP_ORIGIN ||
    (appOriginUrl.protocol !== "https:" &&
      appOriginUrl.hostname !== "localhost" &&
      appOriginUrl.hostname !== "127.0.0.1")
  ) {
    throw new Error("APP_ORIGIN must be an exact HTTPS origin or localhost");
  }

  const keys = cookieKeysFromEnvironment(environment);
  const codecOptions = {
    activeKeyId: parsedEnvironment.COOKIE_ACTIVE_KEY_ID,
    keys,
  };

  return {
    config: {
      appOrigin: appOriginUrl.origin,
      clientId: parsedEnvironment.GITHUB_OAUTH_CLIENT_ID,
      secureCookies: appOriginUrl.protocol === "https:",
    },
    github: new GitHubApiClient({
      apiVersion: parsedEnvironment.GITHUB_API_VERSION,
      clientId: parsedEnvironment.GITHUB_OAUTH_CLIENT_ID,
      clientSecret: parsedEnvironment.GITHUB_OAUTH_CLIENT_SECRET,
    }),
    now: currentUnixTimestamp,
    randomState: () => randomBytes(32).toString("base64url"),
    sessionCodec: createSessionCookieCodec(codecOptions),
    stateCodec: createEncryptedCookieCodec({
      ...codecOptions,
      parsePayload: (value) => oauthStatePayloadSchema.parse(value),
    }),
  };
}

export function cookieKeysFromEnvironment(
  environment: NodeJS.ProcessEnv,
): Record<string, Uint8Array> {
  const keys: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(environment)) {
    if (!name.startsWith("COOKIE_ENCRYPTION_KEY_") || value === undefined) {
      continue;
    }
    const keyId = name.slice("COOKIE_ENCRYPTION_KEY_".length).toLowerCase();
    if (!/^[a-z0-9_-]{1,32}$/.test(keyId)) {
      throw new Error("Cookie encryption key environment name is invalid");
    }
    keys[keyId] = decodeBase64UrlKey(value);
  }
  return keys;
}

function callbackUri(appOrigin: string): string {
  return `${appOrigin}/auth/github/callback`;
}

export function currentUnixTimestamp(): UnixTimestamp {
  return Math.floor(Date.now() / 1000);
}

export function isAllowedReturnTo(returnTo: string): boolean {
  if (
    !returnTo.startsWith("/") ||
    returnTo.startsWith("//") ||
    returnTo.includes("\\") ||
    returnTo.length > 512
  ) {
    return false;
  }

  try {
    const parsed = new URL(returnTo, "https://local.invalid");
    return (
      parsed.origin === "https://local.invalid" &&
      !parsed.pathname.startsWith("/auth/") &&
      !parsed.pathname.startsWith("/api/")
    );
  } catch {
    return false;
  }
}

function isBoundedOAuthValue(value: string | null): value is string {
  return value !== null && value.length >= 1 && value.length <= 1024;
}

export function secureStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.byteLength === rightBuffer.byteLength &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader === null) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) {
      continue;
    }
    const value = part.slice(separator + 1).trim();
    return value.length === 0 ? null : value;
  }
  return null;
}

export interface CookieOptions {
  maxAge: number;
  secure: boolean;
}

export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions,
): string {
  const attributes = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${options.maxAge}`,
  ];
  if (options.secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

export function serializeExpiredCookie(name: string, secure: boolean): string {
  return serializeCookie(name, "", { maxAge: 0, secure });
}

function callbackError(
  code: string,
  clearStateCookie: string,
  status = 400,
): Response {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json",
  });
  headers.append("set-cookie", clearStateCookie);
  return new Response(JSON.stringify({ error: code }), { headers, status });
}

export function errorResponse(
  status: number,
  code: string,
  extraHeaders: HeadersInit = {},
): Response {
  return Response.json(
    { error: code },
    {
      headers: { "cache-control": "no-store", ...extraHeaders },
      status,
    },
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new GitHubAuthenticationError();
  }
}
