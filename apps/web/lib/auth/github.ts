// GitHub OAuth 로그인 흐름: start → GitHub 동의 → callback → 세션 쿠키 → /api/me, logout.
import { randomBytes } from "node:crypto";

import type { SessionCodec, UnixTimestamp } from "@kanban-press/auth";
import {
  createEncryptedCookieCodec,
  createSessionCookieCodec,
  type EncryptedCookieCodec,
} from "@kanban-press/auth/server";
import { entityId } from "@kanban-press/domain";
import { z } from "zod";

import {
  providerRequest,
  ProviderTransportError,
} from "../operations/provider-request";
import type { LogSink } from "../operations/structured-log";

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
  SESSION_COOKIE,
} from "./session";

// 게시 대상 repository에 commit하고 Pages workflow 파일을 쓰려면 public_repo와 workflow가 필요하다.
const GITHUB_SCOPE = "read:user public_repo workflow";
const STATE_COOKIE = "kp_oauth_state";
const STATE_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const statePayloadSchema = z
  .object({
    nonce: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
    returnTo: z.string().min(1).max(512),
  })
  .strict();

export type OAuthStatePayload = z.infer<typeof statePayloadSchema>;

export interface GitHubOAuthClient {
  /** code를 token으로 바꾸고 그 token으로 사용자 identity를 다시 조회한다. */
  authenticate(
    code: string,
    redirectUri: string,
  ): Promise<{ accessToken: string; identity: { id: string; login: string } }>;
}

export interface GitHubAuthDependencies {
  config: { appOrigin: string; clientId: string; secureCookies: boolean };
  github: GitHubOAuthClient;
  now: () => UnixTimestamp;
  randomState: () => string;
  sessionCodec: SessionCodec;
  stateCodec: EncryptedCookieCodec<OAuthStatePayload>;
}

export class GitHubAuthenticationError extends Error {
  override readonly name = "GitHubAuthenticationError";

  constructor(readonly code: "timeout" | "unavailable" = "unavailable") {
    super("GitHub authentication failed");
  }
}

/** `GET /auth/github/start?returnTo=/` */
export async function startGitHubLogin(
  request: Request,
  { config, now, randomState, stateCodec }: GitHubAuthDependencies,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const returnTo = requestUrl.searchParams.get("returnTo") ?? "/";
  if (!isAllowedReturnTo(returnTo)) {
    return errorResponse(400, "invalid_return_to");
  }

  // 배포 alias로 들어오면 state 쿠키가 callback origin에 남도록 정식 origin으로 먼저 보낸다.
  if (requestUrl.origin !== config.appOrigin) {
    const canonical = new URL("/auth/github/start", config.appOrigin);
    canonical.searchParams.set("returnTo", returnTo);
    return redirectResponse(canonical, 307);
  }

  const issuedAt = now();
  const nonce = randomState();
  const stateCookie = await stateCodec.seal(
    statePayloadSchema.parse({ nonce, returnTo }),
    { expiresAt: issuedAt + STATE_TTL_SECONDS, issuedAt },
  );

  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("redirect_uri", callbackUri(config.appOrigin));
  authorize.searchParams.set("scope", GITHUB_SCOPE);
  authorize.searchParams.set("state", nonce);

  return redirectResponse(authorize, 302, [
    serializeCookie(STATE_COOKIE, stateCookie, {
      maxAge: STATE_TTL_SECONDS,
      secure: config.secureCookies,
    }),
  ]);
}

/**
 * `GET /auth/github/callback?code&state`
 * state 쿠키는 결과와 관계없이 지워 같은 callback을 두 번 쓸 수 없게 한다.
 */
export async function finishGitHubLogin(
  request: Request,
  { config, github, now, sessionCodec, stateCodec }: GitHubAuthDependencies,
): Promise<Response> {
  const clearState = serializeExpiredCookie(STATE_COOKIE, config.secureCookies);
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const returnedState = params.get("state");
  const stateCookie = readCookie(request, STATE_COOKIE);

  if (
    params.has("error") ||
    !isBoundedOAuthValue(code) ||
    !isBoundedOAuthValue(returnedState) ||
    stateCookie === null
  ) {
    return callbackError(400, "invalid_oauth_callback", clearState);
  }

  const state = await stateCodec.open(stateCookie);
  if (
    state === null ||
    !secureStringEqual(state.payload.nonce, returnedState) ||
    !isAllowedReturnTo(state.payload.returnTo)
  ) {
    return callbackError(400, "invalid_oauth_state", clearState);
  }

  let authenticated: Awaited<ReturnType<GitHubOAuthClient["authenticate"]>>;
  try {
    authenticated = await github.authenticate(code, callbackUri(config.appOrigin));
  } catch (error) {
    return error instanceof GitHubAuthenticationError && error.code === "timeout"
      ? callbackError(504, "github_timeout", clearState)
      : callbackError(502, "github_authentication_failed", clearState);
  }

  const issuedAt = now();
  const sessionCookie = await sessionCodec.seal({
    accessToken: authenticated.accessToken,
    expiresAt: issuedAt + SESSION_TTL_SECONDS,
    githubLogin: authenticated.identity.login,
    issuedAt,
    userId: entityId("GitHubUser", authenticated.identity.id),
  });
  return redirectResponse(new URL(state.payload.returnTo, config.appOrigin), 302, [
    clearState,
    serializeCookie(SESSION_COOKIE, sessionCookie, {
      maxAge: SESSION_TTL_SECONDS,
      secure: config.secureCookies,
    }),
  ]);
}

/** `GET /api/me`: 브라우저는 IndexedDB namespace에 쓸 user ID와 login만 받는다. */
export async function getCurrentUser(
  request: Request,
  { sessionCodec }: Pick<GitHubAuthDependencies, "sessionCodec">,
): Promise<Response> {
  const session = await readSession(request, sessionCodec);
  const headers = { "cache-control": "no-store" };
  return session === null
    ? Response.json({ authenticated: false }, { headers, status: 401 })
    : Response.json(
        {
          authenticated: true,
          user: { id: session.userId, login: session.githubLogin },
        },
        { headers },
      );
}

/** `POST /auth/logout`: 다른 사이트가 강제로 로그아웃시키지 못하게 Origin을 확인한다. */
export function logout(
  request: Request,
  { config }: Pick<GitHubAuthDependencies, "config">,
): Response {
  if (request.headers.get("origin") !== config.appOrigin) {
    return errorResponse(403, "invalid_origin");
  }
  const headers = new Headers({ "cache-control": "no-store" });
  for (const cookie of expiredCookies(SESSION_COOKIE, config.secureCookies)) headers.append("set-cookie", cookie);
  headers.append("set-cookie", serializeExpiredCookie(STATE_COOKIE, config.secureCookies));
  return new Response(null, { headers, status: 204 });
}

const environmentSchema = z.object({
  APP_ORIGIN: z.string().url(),
  COOKIE_ACTIVE_KEY_ID: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  GITHUB_API_VERSION: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  GITHUB_OAUTH_CLIENT_ID: z.string().min(1).max(255),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().min(1).max(4096),
});

export function createGitHubAuthDependencies(
  environment: NodeJS.ProcessEnv = process.env,
): GitHubAuthDependencies {
  const env = environmentSchema.parse(environment);
  const { origin, secure } = parseAppOrigin(env.APP_ORIGIN);
  const codecOptions = {
    activeKeyId: env.COOKIE_ACTIVE_KEY_ID,
    keys: cookieKeysFromEnvironment(environment),
  };
  return {
    config: { appOrigin: origin, clientId: env.GITHUB_OAUTH_CLIENT_ID, secureCookies: secure },
    github: createGitHubOAuthClient({
      apiVersion: env.GITHUB_API_VERSION,
      clientId: env.GITHUB_OAUTH_CLIENT_ID,
      clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
    }),
    now: currentUnixTimestamp,
    randomState: () => randomBytes(32).toString("base64url"),
    sessionCodec: createSessionCookieCodec(codecOptions),
    stateCodec: createEncryptedCookieCodec({
      ...codecOptions,
      parsePayload: (value) => statePayloadSchema.parse(value),
    }),
  };
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1).max(4096),
  token_type: z.literal("bearer"),
});

const githubUserSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1).max(255),
});

/** GitHub OAuth REST 호출. 실패 원인은 timeout과 그 외(unavailable)로만 구분해 밖으로 낸다. */
export function createGitHubOAuthClient(options: {
  apiVersion: string;
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  log?: LogSink;
  timeoutMs?: number;
}): GitHubOAuthClient {
  async function requestJson(
    input: string,
    init: RequestInit,
    operation: string,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await providerRequest({
        fetch: options.fetch ?? fetch,
        init,
        input,
        log: options.log,
        operation,
        provider: "github",
        timeoutMs: options.timeoutMs,
      });
    } catch (error) {
      throw error instanceof ProviderTransportError
        ? new GitHubAuthenticationError(error.code)
        : error;
    }
    if (!response.ok) {
      throw new GitHubAuthenticationError();
    }
    return response.json().catch(() => {
      throw new GitHubAuthenticationError();
    });
  }

  return {
    async authenticate(code, redirectUri) {
      const token = tokenResponseSchema.safeParse(
        await requestJson(
          "https://github.com/login/oauth/access_token",
          {
            body: new URLSearchParams({
              client_id: options.clientId,
              client_secret: options.clientSecret,
              code,
              redirect_uri: redirectUri,
            }),
            headers: {
              accept: "application/json",
              "content-type": "application/x-www-form-urlencoded",
              "user-agent": "kanban-press",
            },
            method: "POST",
          },
          "oauth.token",
        ),
      );
      if (!token.success) {
        throw new GitHubAuthenticationError();
      }

      const user = githubUserSchema.safeParse(
        await requestJson(
          "https://api.github.com/user",
          {
            headers: {
              accept: "application/vnd.github+json",
              authorization: `Bearer ${token.data.access_token}`,
              "user-agent": "kanban-press",
              "x-github-api-version": options.apiVersion,
            },
          },
          "identity.get",
        ),
      );
      if (!user.success) {
        throw new GitHubAuthenticationError();
      }
      return {
        accessToken: token.data.access_token,
        identity: { id: String(user.data.id), login: user.data.login },
      };
    },
  };
}

function callbackUri(appOrigin: string): string {
  return `${appOrigin}/auth/github/callback`;
}

function isBoundedOAuthValue(value: string | null): value is string {
  return value !== null && value.length >= 1 && value.length <= 1024;
}
