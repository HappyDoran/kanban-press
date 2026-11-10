// Route Handler들이 공유하는 세션·쿠키·응답 도구. provider별 OAuth 흐름은 github.ts, notion.ts가 가진다.
import { timingSafeEqual } from "node:crypto";

import type { SessionCodec, UnixTimestamp } from "@kanban-press/auth";
import { decodeBase64UrlKey } from "@kanban-press/auth/server";

export const SESSION_COOKIE = "kp_session";

export function currentUnixTimestamp(): UnixTimestamp {
  return Math.floor(Date.now() / 1000);
}

/** 요청의 GitHub 세션. 쿠키가 없거나 위조·만료면 `null`. */
export async function readSession(request: Request, codec: SessionCodec) {
  const value = readCookie(request, SESSION_COOKIE);
  return value === null ? null : codec.open(value);
}

/**
 * `APP_ORIGIN`은 path 없는 정확한 origin이어야 하고 localhost가 아니면 HTTPS여야 한다.
 * OAuth redirect URI와 same-origin 검사의 기준이 된다.
 */
export function parseAppOrigin(value: string): { origin: string; secure: boolean } {
  const url = new URL(value);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.origin !== value || (url.protocol !== "https:" && !local)) {
    throw new Error("APP_ORIGIN must be an exact HTTPS origin or localhost");
  }
  return { origin: url.origin, secure: url.protocol === "https:" };
}

/** `COOKIE_ENCRYPTION_KEY_<ID>` 환경 변수를 모두 읽어 key ID(소문자) → key로 만든다. */
export function cookieKeysFromEnvironment(
  environment: NodeJS.ProcessEnv,
): Record<string, Uint8Array> {
  const prefix = "COOKIE_ENCRYPTION_KEY_";
  const keys: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(environment)) {
    if (!name.startsWith(prefix) || value === undefined) {
      continue;
    }
    const keyId = name.slice(prefix.length).toLowerCase();
    if (!/^[a-z0-9_-]{1,32}$/.test(keyId)) {
      throw new Error("Cookie encryption key environment name is invalid");
    }
    keys[keyId] = decodeBase64UrlKey(value);
  }
  return keys;
}

/**
 * 로그인 뒤 돌아갈 경로. 같은 origin의 앱 화면만 허용하고
 * 외부 URL(`//host`, `\`), 인증·API 경로는 거절한다.
 */
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

/** OAuth state처럼 비밀 값을 비교할 때 길이 외의 timing 차이를 없앤다. */
export function secureStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.byteLength === rightBuffer.byteLength &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function readCookie(request: Request, name: string): string | null {
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator >= 0 && part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim();
      return value.length === 0 ? null : value;
    }
  }
  const legacy = LEGACY_COOKIE_NAMES[name];
  return legacy === undefined ? null : readCookie(request, legacy);
}

/**
 * 프로젝트 이름을 바꾸기 전(2026-11-10) 쿠키 이름. 새 이름 쿠키가 없을 때만 읽고, 새로 쓸 때는 새 이름만 쓴다.
 * 로그아웃처럼 쿠키를 지울 때는 옛 이름도 함께 지워야 옛 값이 되살아나지 않는다(`expiredCookies`).
 */
const LEGACY_COOKIE_NAMES: Readonly<Record<string, string>> = {
  kp_notion_connections: "nkb_notion_connections",
  kp_session: "nkb_session",
};

/** 쿠키 하나를 지우는 `Set-Cookie` 값들. 옛 이름이 있으면 그것도 지운다. */
export function expiredCookies(name: string, secure: boolean): string[] {
  const legacy = LEGACY_COOKIE_NAMES[name];
  return [name, ...(legacy === undefined ? [] : [legacy])].map((cookie) => serializeExpiredCookie(cookie, secure));
}

/** 모든 인증 쿠키는 `HttpOnly; SameSite=Lax`, HTTPS origin이면 `Secure`다. */
export function serializeCookie(
  name: string,
  value: string,
  options: { maxAge: number; secure: boolean },
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

/** 오류 응답은 code 문자열만 담는다. provider 원문·token을 넣지 않는다. */
export function errorResponse(
  status: number,
  code: string,
  extraHeaders: HeadersInit = {},
): Response {
  return Response.json(
    { error: code },
    { headers: { "cache-control": "no-store", ...extraHeaders }, status },
  );
}

/** `location`으로 보내는 no-store redirect. 필요한 `Set-Cookie`를 함께 붙인다. */
export function redirectResponse(
  location: URL,
  status: 302 | 307,
  cookies: readonly string[] = [],
): Response {
  const headers = new Headers({ "cache-control": "no-store", location: location.toString() });
  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }
  return new Response(null, { headers, status });
}

/** OAuth callback 실패 응답. 일회성 state 쿠키는 실패해도 반드시 지운다. */
export function callbackError(status: number, code: string, clearState: string): Response {
  const response = errorResponse(status, code);
  response.headers.append("set-cookie", clearState);
  return response;
}
