import { randomBytes } from "node:crypto";

import {
  createEncryptedCookieCodec,
  createSessionCookieCodec,
} from "@kanban-press/auth/server";
import { entityId } from "@kanban-press/domain";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  disconnectNotion,
  finishNotionConnection,
  listNotionConnections,
  createNotionOAuthClient,
  NotionAuthenticationError,
  startNotionConnection,
} from "./notion";

import type {
  NotionAuthDependencies,
  NotionConnectionsPayload,
  NotionOAuthClient,
  NotionOAuthState,
} from "./notion";

const NOW = 2_000_000_000;
const ORIGIN = "http://localhost:3000";
const KEY = randomBytes(32);
const WORKSPACE_ID = "3c90c3cc-0d44-4b50-8888-8dd25736052a";
const BOT_ID = "9188c6a5-7381-452f-b3dc-d4865aa89bdf";

const stateSchema = z.object({
  nonce: z.string(),
  ownerUserId: z.string(),
  returnTo: z.string(),
});
const connectionsSchema = z.object({
  connections: z.array(z.any()),
});

function dependencies(
  overrides: Partial<NotionAuthDependencies> = {},
): NotionAuthDependencies {
  const now = overrides.now ?? (() => NOW);
  const notion: NotionOAuthClient = {
    authorize: vi.fn().mockResolvedValue({
      accessToken: "notion-access-token",
      botId: BOT_ID,
      refreshToken: "notion-refresh-token",
      workspaceIcon: null,
      workspaceId: WORKSPACE_ID,
      workspaceName: "테스트 워크스페이스",
    }),
    revoke: vi.fn().mockResolvedValue(undefined),
  };
  return {
    appOrigin: ORIGIN,
    clientId: "notion-client-id",
    connectionsCodec: createEncryptedCookieCodec<NotionConnectionsPayload>({
      activeKeyId: "v1",
      keys: { v1: KEY },
      now,
      parsePayload: (value) =>
        connectionsSchema.parse(value) as NotionConnectionsPayload,
    }),
    notion,
    now,
    randomState: () => "n".repeat(43),
    secureCookies: false,
    sessionCodec: createSessionCookieCodec({
      activeKeyId: "v1",
      keys: { v1: KEY },
      now,
    }),
    stateCodec: createEncryptedCookieCodec<NotionOAuthState>({
      activeKeyId: "v1",
      keys: { v1: KEY },
      now,
      parsePayload: (value) => stateSchema.parse(value),
    }),
    ...overrides,
  };
}

async function sessionCookie(
  deps: NotionAuthDependencies,
  userId = "583231",
): Promise<string> {
  const value = await deps.sessionCodec.seal({
    accessToken: "github-token",
    expiresAt: NOW + 3_600,
    githubLogin: "octocat",
    issuedAt: NOW,
    userId: entityId("GitHubUser", userId),
  });
  return `kp_session=${value}`;
}

async function start(deps: NotionAuthDependencies) {
  const response = await startNotionConnection(
    new Request(`${ORIGIN}/auth/notion/start?returnTo=/`, {
      headers: { cookie: await sessionCookie(deps) },
    }),
    deps,
  );
  const location = new URL(response.headers.get("location") ?? "");
  const state = location.searchParams.get("state");
  const stateCookie = cookiePair(response, "kp_notion_oauth_state");
  if (state === null || stateCookie === null) {
    throw new Error("Expected Notion OAuth state");
  }
  return { response, state, stateCookie };
}

describe("Notion OAuth connections", () => {
  it("requires GitHub authentication before starting", async () => {
    const response = await startNotionConnection(
      new Request(`${ORIGIN}/auth/notion/start`),
      dependencies(),
    );
    expect(response.status).toBe(401);
  });

  it("creates a Notion authorization redirect with protected state", async () => {
    const { response } = await start(dependencies());
    const location = new URL(response.headers.get("location") ?? "");

    expect(response.status).toBe(302);
    expect(location.origin).toBe("https://api.notion.com");
    expect(location.searchParams.get("client_id")).toBe("notion-client-id");
    expect(location.searchParams.get("owner")).toBe("user");
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("redirect_uri")).toBe(
      `${ORIGIN}/auth/notion/callback`,
    );
    expect(setCookies(response).join(";")).toContain("Max-Age=600");
  });

  it("stores a connection in an encrypted cookie and lists no credentials", async () => {
    const deps = dependencies();
    const begun = await start(deps);
    const session = await sessionCookie(deps);
    const response = await finishNotionConnection(
      callbackRequest(begun.state, [session, begun.stateCookie]),
      deps,
    );

    expect(response.status).toBe(302);
    const connectionsCookie = cookiePair(response, "kp_notion_connections");
    expect(connectionsCookie).not.toBeNull();
    expect(connectionsCookie).not.toContain("notion-access-token");

    const listed = await listNotionConnections(
      new Request(`${ORIGIN}/api/notion/connections`, {
        headers: { cookie: [session, connectionsCookie].join("; ") },
      }),
      deps,
    );
    const body = await listed.text();
    expect(JSON.parse(body)).toEqual({
      connections: [
        {
          connectedAt: NOW,
          connectionId: WORKSPACE_ID,
          workspaceIcon: null,
          workspaceName: "테스트 워크스페이스",
        },
      ],
    });
    expect(body).not.toContain("token");

    const isolated = await listNotionConnections(
      new Request(`${ORIGIN}/api/notion/connections`, {
        headers: {
          cookie: [
            await sessionCookie(deps, "999999"),
            connectionsCookie,
          ].join("; "),
        },
      }),
      deps,
    );
    await expect(isolated.json()).resolves.toEqual({ connections: [] });
  });

  it("replaces a reconnected workspace and revokes only the previous token", async () => {
    const deps = dependencies();
    const session = await sessionCookie(deps);
    const first = await start(deps);
    const connected = await finishNotionConnection(
      callbackRequest(first.state, [session, first.stateCookie]),
      deps,
    );
    const connectionsCookie = cookiePair(connected, "kp_notion_connections") ?? "";

    vi.mocked(deps.notion.authorize).mockResolvedValueOnce({
      accessToken: "second-access-token",
      botId: BOT_ID,
      refreshToken: null,
      workspaceIcon: null,
      workspaceId: WORKSPACE_ID,
      workspaceName: "테스트 워크스페이스",
    });
    const second = await start(deps);
    const reconnected = await finishNotionConnection(
      callbackRequest(second.state, [session, second.stateCookie, connectionsCookie]),
      deps,
    );

    expect(reconnected.status).toBe(302);
    expect(deps.notion.revoke).toHaveBeenCalledTimes(1);
    expect(deps.notion.revoke).toHaveBeenCalledWith("notion-access-token");
    const listed = await listNotionConnections(
      new Request(`${ORIGIN}/api/notion/connections`, {
        headers: {
          cookie: [session, cookiePair(reconnected, "kp_notion_connections")].join("; "),
        },
      }),
      deps,
    );
    await expect(listed.json()).resolves.toMatchObject({
      connections: [{ connectionId: WORKSPACE_ID }],
    });
  });

  it("reports a Notion timeout as 504 and stores no connection", async () => {
    const deps = dependencies({
      notion: {
        authorize: vi.fn().mockRejectedValue(new NotionAuthenticationError("timeout")),
        revoke: vi.fn(),
      },
    });
    const begun = await start(deps);
    const response = await finishNotionConnection(
      callbackRequest(begun.state, [await sessionCookie(deps), begun.stateCookie]),
      deps,
    );

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toEqual({ error: "notion_timeout" });
    expect(cookiePair(response, "kp_notion_connections")).toBeNull();
  });

  it("rejects state owned by another GitHub user", async () => {
    const deps = dependencies();
    const begun = await start(deps);
    const response = await finishNotionConnection(
      callbackRequest(begun.state, [
        await sessionCookie(deps, "999999"),
        begun.stateCookie,
      ]),
      deps,
    );

    expect(response.status).toBe(400);
    expect(deps.notion.authorize).not.toHaveBeenCalled();
  });

  it("rejects an oversized encrypted cookie and revokes the new token", async () => {
    const notion: NotionOAuthClient = {
      authorize: vi.fn().mockResolvedValue({
        accessToken: "x".repeat(4_000),
        botId: BOT_ID,
        refreshToken: null,
        workspaceIcon: null,
        workspaceId: WORKSPACE_ID,
        workspaceName: "큰 워크스페이스",
      }),
      revoke: vi.fn().mockResolvedValue(undefined),
    };
    const deps = dependencies({ notion });
    const begun = await start(deps);
    const response = await finishNotionConnection(
      callbackRequest(begun.state, [
        await sessionCookie(deps),
        begun.stateCookie,
      ]),
      deps,
    );

    expect(response.status).toBe(409);
    expect(notion.revoke).toHaveBeenCalledWith("x".repeat(4_000));
    expect(cookiePair(response, "kp_notion_connections")).toBeNull();
  });

  it("enforces the three-connection limit and revokes the rejected token", async () => {
    const deps = dependencies();
    const existing = [1, 2, 3].map((index) => ({
      accessToken: `existing-${index}`,
      botId: BOT_ID,
      connectedAt: NOW,
      connectionId: `${index}1111111-1111-4111-8111-111111111111`,
      ownerUserId: "583231",
      refreshToken: null,
      workspaceIcon: null,
      workspaceId: `${index}1111111-1111-4111-8111-111111111111`,
      workspaceName: `Workspace ${index}`,
    }));
    const value = await deps.connectionsCodec.seal(
      { connections: existing },
      { expiresAt: NOW + 3_600, issuedAt: NOW },
    );
    const begun = await start(deps);
    const response = await finishNotionConnection(
      callbackRequest(begun.state, [
        await sessionCookie(deps),
        begun.stateCookie,
        `kp_notion_connections=${value}`,
      ]),
      deps,
    );

    expect(response.status).toBe(409);
    expect(deps.notion.revoke).toHaveBeenCalledWith("notion-access-token");
  });

  it("disconnects only the current user's connection and revokes its token", async () => {
    const deps = dependencies();
    const begun = await start(deps);
    const session = await sessionCookie(deps);
    const connected = await finishNotionConnection(
      callbackRequest(begun.state, [session, begun.stateCookie]),
      deps,
    );
    const connectionsCookie = cookiePair(connected, "kp_notion_connections");

    const response = await disconnectNotion(
      new Request(`${ORIGIN}/api/notion/connections/disconnect`, {
        body: JSON.stringify({ connectionId: WORKSPACE_ID }),
        headers: {
          "content-type": "application/json",
          cookie: [session, connectionsCookie].join("; "),
          origin: ORIGIN,
        },
        method: "POST",
      }),
      deps,
    );

    expect(response.status).toBe(204);
    expect(deps.notion.revoke).toHaveBeenCalledWith("notion-access-token");
    expect(setCookies(response).join(";")).toContain("Max-Age=0");
  });
});

describe("Notion OAuth API contract", () => {
  it("uses Basic auth and the configured API version for token and revoke calls", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          access_token: "access",
          bot_id: BOT_ID,
          refresh_token: null,
          token_type: "bearer",
          workspace_icon: null,
          workspace_id: WORKSPACE_ID,
          workspace_name: "Workspace",
        }),
      )
      .mockResolvedValueOnce(Response.json({ request_id: WORKSPACE_ID }));
    const client = createNotionOAuthClient({
      apiVersion: "2026-03-11",
      clientId: "client-id",
      clientSecret: "client-secret",
      fetch: fetchMock,
    });

    await client.authorize("code", `${ORIGIN}/auth/notion/callback`);
    await client.revoke("access");

    for (const call of fetchMock.mock.calls) {
      expect(call[1]?.headers).toEqual(
        expect.objectContaining({
          authorization: `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
          "notion-version": "2026-03-11",
        }),
      );
    }
  });
});

function callbackRequest(state: string, cookies: string[]): Request {
  return new Request(
    `${ORIGIN}/auth/notion/callback?code=temporary-code&state=${state}`,
    { headers: { cookie: cookies.join("; ") } },
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
