import { randomBytes } from "node:crypto";

import {
  createEncryptedCookieCodec,
  createSessionCookieCodec,
} from "@notion-kanban-blog/auth/server";
import { entityId } from "@notion-kanban-blog/domain";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  finishGitHubLogin,
  getCurrentUser,
  createGitHubOAuthClient,
  GitHubAuthenticationError,
  logout,
  startGitHubLogin,
} from "./github";

import type {
  GitHubAuthDependencies,
  GitHubOAuthClient,
  OAuthStatePayload,
} from "./github";

const NOW = 2_000_000_000;
const APP_ORIGIN = "http://localhost:3000";
const KEY = randomBytes(32);

const statePayloadSchema = z
  .object({
    nonce: z.string(),
    returnTo: z.string(),
  })
  .strict();

function createDependencies(
  overrides: Partial<GitHubAuthDependencies> = {},
): GitHubAuthDependencies {
  const now = overrides.now ?? (() => NOW);
  const github: GitHubOAuthClient = {
    authenticate: vi.fn().mockResolvedValue({
      accessToken: "github-access-token",
      identity: { id: "583231", login: "octocat" },
    }),
  };

  return {
    config: {
      appOrigin: APP_ORIGIN,
      clientId: "oauth-client-id",
      secureCookies: false,
    },
    github,
    now,
    randomState: () => "a".repeat(43),
    sessionCodec: createSessionCookieCodec({
      activeKeyId: "v1",
      keys: { v1: KEY },
      now,
    }),
    stateCodec: createEncryptedCookieCodec<OAuthStatePayload>({
      activeKeyId: "v1",
      keys: { v1: KEY },
      now,
      parsePayload: (value) => statePayloadSchema.parse(value),
    }),
    ...overrides,
  };
}

async function beginLogin(dependencies: GitHubAuthDependencies) {
  const response = await startGitHubLogin(
    new Request(`${APP_ORIGIN}/auth/github/start?returnTo=/dashboard`),
    dependencies,
  );
  const location = response.headers.get("location");
  if (location === null) {
    throw new Error("Expected GitHub authorization location");
  }
  const state = new URL(location).searchParams.get("state");
  const stateCookie = cookiePair(response, "nkb_oauth_state");
  if (state === null || stateCookie === null) {
    throw new Error("Expected OAuth state and cookie");
  }
  return { response, state, stateCookie };
}

describe("GitHub login flow", () => {
  it("starts with a least-privilege GitHub redirect and protected state cookie", async () => {
    const { response } = await beginLogin(createDependencies());
    const location = new URL(response.headers.get("location") ?? "");

    expect(response.status).toBe(302);
    expect(location.origin).toBe("https://github.com");
    expect(location.pathname).toBe("/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("oauth-client-id");
    expect(location.searchParams.get("redirect_uri")).toBe(
      `${APP_ORIGIN}/auth/github/callback`,
    );
    expect(location.searchParams.get("scope")).toBe(
      "read:user public_repo workflow",
    );
    expect(setCookies(response).join(";")).toContain("HttpOnly");
    expect(setCookies(response).join(";")).toContain("SameSite=Lax");
    expect(setCookies(response).join(";")).toContain("Max-Age=600");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("moves deployment aliases to the canonical origin before issuing state", async () => {
    const response = await startGitHubLogin(
      new Request(
        "https://preview-deployment.vercel.app/auth/github/start?returnTo=%2Fdashboard",
      ),
      createDependencies(),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `${APP_ORIGIN}/auth/github/start?returnTo=%2Fdashboard`,
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "/\\evil",
    "/auth/github/callback",
    "/api/me",
  ])("rejects an unsafe return path: %s", async (returnTo) => {
    const response = await startGitHubLogin(
      new Request(
        `${APP_ORIGIN}/auth/github/start?returnTo=${encodeURIComponent(returnTo)}`,
      ),
      createDependencies(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_return_to",
    });
  });

  it("exchanges the code, revalidates identity, seals a session, and redirects", async () => {
    const dependencies = createDependencies();
    const { state, stateCookie } = await beginLogin(dependencies);

    const response = await finishGitHubLogin(
      callbackRequest(state, stateCookie),
      dependencies,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${APP_ORIGIN}/dashboard`);
    expect(dependencies.github.authenticate).toHaveBeenCalledWith(
      "temporary-code",
      `${APP_ORIGIN}/auth/github/callback`,
    );
    expect(setCookies(response).join(";")).toContain(
      "nkb_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );

    const sessionCookie = cookiePair(response, "nkb_session");
    expect(sessionCookie).not.toBeNull();
    await expect(
      dependencies.sessionCodec.open(sessionCookie?.split("=")[1] ?? ""),
    ).resolves.toEqual({
      accessToken: "github-access-token",
      expiresAt: NOW + 7 * 24 * 60 * 60,
      githubLogin: "octocat",
      issuedAt: NOW,
      userId: "583231",
    });
  });

  it("rejects forged, expired, and missing state before token exchange", async () => {
    let now = NOW;
    const github: GitHubOAuthClient = {
      authenticate: vi.fn().mockResolvedValue({
        accessToken: "github-access-token",
        identity: { id: "583231", login: "octocat" },
      }),
    };
    const dependencies = createDependencies({
      github,
      now: () => now,
    });
    const started = await beginLogin(dependencies);

    const forged = await finishGitHubLogin(
      callbackRequest("b".repeat(43), started.stateCookie),
      dependencies,
    );
    expect(forged.status).toBe(400);

    now += 601;
    const expired = await finishGitHubLogin(
      callbackRequest(started.state, started.stateCookie),
      dependencies,
    );
    expect(expired.status).toBe(400);

    const missing = await finishGitHubLogin(
      callbackRequest(started.state, null),
      dependencies,
    );
    expect(missing.status).toBe(400);
    expect(github.authenticate).not.toHaveBeenCalled();
  });

  it("rejects a second callback after the browser applies state-cookie deletion", async () => {
    const dependencies = createDependencies();
    const started = await beginLogin(dependencies);

    const first = await finishGitHubLogin(
      callbackRequest(started.state, started.stateCookie),
      dependencies,
    );
    const second = await finishGitHubLogin(
      callbackRequest(started.state, null),
      dependencies,
    );

    expect(first.status).toBe(302);
    expect(second.status).toBe(400);
    expect(dependencies.github.authenticate).toHaveBeenCalledTimes(1);
  });

  it("clears OAuth state and returns a redacted error when GitHub fails", async () => {
    const dependencies = createDependencies({
      github: {
        authenticate: vi.fn().mockRejectedValue(new Error("token=secret")),
      },
    });
    const { state, stateCookie } = await beginLogin(dependencies);

    const response = await finishGitHubLogin(
      callbackRequest(state, stateCookie),
      dependencies,
    );

    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toBe(
      JSON.stringify({ error: "github_authentication_failed" }),
    );
    expect(body).not.toContain("secret");
    expect(setCookies(response).join(";")).toContain("Max-Age=0");
  });

  it("reports a GitHub timeout as 504 without issuing a session", async () => {
    const dependencies = createDependencies({
      github: {
        authenticate: vi
          .fn()
          .mockRejectedValue(new GitHubAuthenticationError("timeout")),
      },
    });
    const { state, stateCookie } = await beginLogin(dependencies);

    const response = await finishGitHubLogin(
      callbackRequest(state, stateCookie),
      dependencies,
    );

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toEqual({ error: "github_timeout" });
    expect(cookiePair(response, "nkb_session")).toBeNull();
  });
});

describe("session endpoints", () => {
  it("returns only the stable GitHub namespace and login from /api/me", async () => {
    const dependencies = createDependencies();
    const cookieValue = await dependencies.sessionCodec.seal({
      accessToken: "never-return-this-token",
      expiresAt: NOW + 100,
      githubLogin: "octocat",
      issuedAt: NOW,
      userId: entityId("GitHubUser", "583231"),
    });

    const response = await getCurrentUser(
      new Request(`${APP_ORIGIN}/api/me`, {
        headers: { cookie: `nkb_session=${cookieValue}` },
      }),
      dependencies,
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toEqual({
      authenticated: true,
      user: { id: "583231", login: "octocat" },
    });
    expect(body).not.toContain("never-return-this-token");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 401 for a missing or invalid session", async () => {
    const response = await getCurrentUser(
      new Request(`${APP_ORIGIN}/api/me`),
      createDependencies(),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ authenticated: false });
  });

  it("requires a same-origin logout request and expires auth cookies", () => {
    const dependencies = createDependencies();
    const rejected = logout(
      new Request(`${APP_ORIGIN}/auth/logout`, {
        headers: { origin: "https://evil.example" },
        method: "POST",
      }),
      dependencies,
    );
    expect(rejected.status).toBe(403);

    const response = logout(
      new Request(`${APP_ORIGIN}/auth/logout`, {
        headers: { origin: APP_ORIGIN },
        method: "POST",
      }),
      dependencies,
    );
    expect(response.status).toBe(204);
    expect(setCookies(response)).toHaveLength(2);
    expect(setCookies(response).join(";")).toContain(
      "nkb_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
  });
});

describe("GitHub API contract", () => {
  it("exchanges an authorization code and immediately fetches the authenticated user", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          access_token: "provider-token",
          token_type: "bearer",
        }),
      )
      .mockResolvedValueOnce(Response.json({ id: 583231, login: "octocat" }));
    const client = createGitHubOAuthClient({
      apiVersion: "2026-03-10",
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: fetchMock,
    });

    await expect(
      client.authenticate("temporary-code", `${APP_ORIGIN}/auth/github/callback`),
    ).resolves.toEqual({
      accessToken: "provider-token",
      identity: { id: "583231", login: "octocat" },
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://github.com/login/oauth/access_token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/user",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer provider-token",
          "x-github-api-version": "2026-03-10",
        }),
      }),
    );
  });

  it.each([
    ["token endpoint error", () => new Response("bad", { status: 401 })],
    ["non-bearer token", () => Response.json({ access_token: "t", token_type: "mac" })],
    ["non-JSON body", () => new Response("<html>", { status: 200 })],
  ])("turns a %s into a redacted authentication error", async (_, response) => {
    const client = createGitHubOAuthClient({
      apiVersion: "2026-03-10",
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response()),
    });

    await expect(
      client.authenticate("temporary-code", `${APP_ORIGIN}/auth/github/callback`),
    ).rejects.toEqual(new GitHubAuthenticationError("unavailable"));
  });
});

function callbackRequest(state: string, stateCookie: string | null): Request {
  const headers = new Headers();
  if (stateCookie !== null) {
    headers.set("cookie", stateCookie);
  }
  return new Request(
    `${APP_ORIGIN}/auth/github/callback?code=temporary-code&state=${state}`,
    { headers },
  );
}

function setCookies(response: Response): string[] {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  return headers.getSetCookie?.() ?? [headers.get("set-cookie") ?? ""];
}

function cookiePair(response: Response, name: string): string | null {
  const cookie = setCookies(response).find((value) =>
    value.startsWith(`${name}=`),
  );
  return cookie?.split(";")[0] ?? null;
}
