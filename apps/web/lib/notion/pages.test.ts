import { randomBytes } from "node:crypto";

import {
  createEncryptedCookieCodec,
  createSessionCookieCodec,
} from "@kanban-press/auth/server";
import { entityId } from "@kanban-press/domain";
import { describe, expect, it, vi } from "vitest";

import { NotionProviderError } from "./content";
import { listNotionPageOutline, listNotionPageTree } from "./pages";

import type {
  NotionConnection,
  NotionConnectionsPayload,
} from "../auth/notion";
import type { NotionPageTreeDependencies } from "./pages";

const NOW = 2_000_000_000;
const ORIGIN = "http://localhost:3000";
const CONNECTION_ID = "3c90c3cc-0d44-4b50-8888-8dd25736052a";
const PAGE_ID = "9188c6a5-7381-452f-b3dc-d4865aa89bdf";
const KEY = randomBytes(32);

function dependencies(
  listPageTree = vi.fn().mockResolvedValue([
    {
      hasChildren: false,
      iconUrl: null,
      lastEditedAt: new Date("2026-07-19T10:00:00.000Z"),
      parentContainerId: null,
      parentPageId: null,
      providerPageId: PAGE_ID,
      title: "공개 가능한 제목",
    },
  ]),
): NotionPageTreeDependencies {
  return {
    auth: {
      connectionsCodec:
        createEncryptedCookieCodec<NotionConnectionsPayload>({
          activeKeyId: "v1",
          keys: { v1: KEY },
          now: () => NOW,
          parsePayload: (value) => value as NotionConnectionsPayload,
        }),
      sessionCodec: createSessionCookieCodec({
        activeKeyId: "v1",
        keys: { v1: KEY },
        now: () => NOW,
      }),
    },
    createAdapter: () => ({
      getPageContent: vi.fn(),
      listPageOutline: vi.fn().mockResolvedValue([]),
      listPageTree,
    }),
  };
}

async function requestCookies(
  deps: NotionPageTreeDependencies,
  sessionUserId = "583231",
): Promise<string> {
  const session = await deps.auth.sessionCodec.seal({
    accessToken: "github-secret",
    expiresAt: NOW + 3_600,
    githubLogin: "octocat",
    issuedAt: NOW,
    userId: entityId("GitHubUser", sessionUserId),
  });
  const connection: NotionConnection = {
    accessToken: "notion-secret",
    botId: "019c75c2-3ce6-7988-a2bc-0a56ba576bc3",
    connectedAt: NOW,
    connectionId: CONNECTION_ID,
    ownerUserId: "583231",
    refreshToken: "notion-refresh-secret",
    workspaceIcon: null,
    workspaceId: CONNECTION_ID,
    workspaceName: "테스트 워크스페이스",
  };
  const connections = await deps.auth.connectionsCodec.seal(
    { connections: [connection] },
    { expiresAt: NOW + 3_600, issuedAt: NOW },
  );
  return `kp_session=${session}; kp_notion_connections=${connections}`;
}

describe("Notion page tree orchestration", () => {
  it("requires GitHub authentication", async () => {
    const response = await listNotionPageTree(
      new Request(`${ORIGIN}/api/notion/connections/${CONNECTION_ID}/pages`),
      CONNECTION_ID,
      dependencies(),
    );

    expect(response.status).toBe(401);
  });

  it("isolates a connection owned by another GitHub user", async () => {
    const deps = dependencies();
    const response = await listNotionPageTree(
      new Request(`${ORIGIN}/api/notion/connections/${CONNECTION_ID}/pages`, {
        headers: { cookie: await requestCookies(deps, "999999") },
      }),
      CONNECTION_ID,
      deps,
    );

    expect(response.status).toBe(404);
  });

  it("returns only page metadata and never provider credentials", async () => {
    const deps = dependencies();
    const response = await listNotionPageTree(
      new Request(`${ORIGIN}/api/notion/connections/${CONNECTION_ID}/pages`, {
        headers: { cookie: await requestCookies(deps) },
      }),
      CONNECTION_ID,
      deps,
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toEqual({
      pages: [
        {
          hasChildren: false,
          iconUrl: null,
          lastEditedAt: "2026-07-19T10:00:00.000Z",
          parentContainerId: null,
          parentPageId: null,
          providerPageId: PAGE_ID,
          title: "공개 가능한 제목",
        },
      ],
    });
    expect(body).not.toContain("notion-secret");
    expect(body).not.toContain("refresh");
  });

  it("returns an authenticated page outline without credentials", async () => {
    const deps = dependencies();
    const listPageOutline = vi.fn().mockResolvedValue([
      {
        kind: "toggle",
        nodeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        parentNodeId: null,
        providerId: null,
        title: "스테이터스 보드",
      },
    ]);
    deps.createAdapter = () => ({
      getPageContent: vi.fn(),
      listPageOutline,
      listPageTree: vi.fn().mockResolvedValue([]),
    });
    const response = await listNotionPageOutline(
      new Request(
        `${ORIGIN}/api/notion/connections/${CONNECTION_ID}/pages/${PAGE_ID}/outline`,
        { headers: { cookie: await requestCookies(deps) } },
      ),
      CONNECTION_ID,
      PAGE_ID,
      deps,
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toEqual({
      outline: [
        {
          kind: "toggle",
          nodeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          parentNodeId: null,
          providerId: null,
          title: "스테이터스 보드",
        },
      ],
    });
    expect(listPageOutline).toHaveBeenCalledWith(PAGE_ID);
    expect(body).not.toContain("notion-secret");
  });

  it("preserves a safe retry-after hint for rate limits", async () => {
    const deps = dependencies(
      vi.fn().mockRejectedValue(new NotionProviderError("rate_limited", 12)),
    );
    const response = await listNotionPageTree(
      new Request(`${ORIGIN}/api/notion/connections/${CONNECTION_ID}/pages`, {
        headers: { cookie: await requestCookies(deps) },
      }),
      CONNECTION_ID,
      deps,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("12");
    await expect(response.json()).resolves.toEqual({
      error: "notion_rate_limited",
    });
  });

  it("reports a revoked Notion permission without exposing provider details", async () => {
    const deps = dependencies(
      vi.fn().mockRejectedValue(new NotionProviderError("access_denied")),
    );
    const response = await listNotionPageTree(
      new Request(`${ORIGIN}/api/notion/connections/${CONNECTION_ID}/pages`, {
        headers: { cookie: await requestCookies(deps) },
      }),
      CONNECTION_ID,
      deps,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "notion_access_denied",
    });
  });
});
