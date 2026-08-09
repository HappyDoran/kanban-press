import { randomBytes } from "node:crypto";

import {
  createEncryptedCookieCodec,
  createSessionCookieCodec,
} from "@notion-kanban-blog/auth/server";
import { entityId } from "@notion-kanban-blog/domain";
import { describe, expect, it, vi } from "vitest";

import type {
  GitHubArtifact,
  GitHubRepositoryAdapter,
} from "@notion-kanban-blog/github";
import type { NotionContentAdapter } from "@notion-kanban-blog/notion";
import type { NotionConnectionsPayload } from "../auth/notion";
import {
  artifactHash,
  getPublishStatus,
  pageSlug,
  publishNotionPage,
  type PublishDependencies,
} from "./orchestration";

const NOW = 2_000_000_000;
const ORIGIN = "http://localhost:3000";
const USER_ID = "583231";
const CONNECTION_ID = "3c90c3cc-0d44-4b50-8888-8dd25736052a";
const PAGE_ID = "9188c6a5-7381-452f-b3dc-d4865aa89bdf";
const COMMIT_SHA = "5".repeat(40);
const CONTENT_HASH = /^[a-f0-9]{64}$/;
const KEY = randomBytes(32);

async function fixture() {
  const sessionCodec = createSessionCookieCodec({
    activeKeyId: "v1",
    keys: { v1: KEY },
    now: () => NOW,
  });
  const connectionsCodec =
    createEncryptedCookieCodec<NotionConnectionsPayload>({
      activeKeyId: "v1",
      keys: { v1: KEY },
      now: () => NOW,
      parsePayload: (value) => value as NotionConnectionsPayload,
    });
  const session = await sessionCodec.seal({
    accessToken: "github-secret-token",
    expiresAt: NOW + 3_600,
    githubLogin: "octocat",
    issuedAt: NOW,
    userId: entityId("GitHubUser", USER_ID),
  });
  const connections = await connectionsCodec.seal(
    {
      connections: [
        {
          accessToken: "notion-secret-token",
          botId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          connectedAt: NOW,
          connectionId: CONNECTION_ID,
          ownerUserId: USER_ID,
          refreshToken: null,
          workspaceIcon: null,
          workspaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          workspaceName: "Workspace",
        },
      ],
    },
    { expiresAt: NOW + 3_600, issuedAt: NOW },
  );
  const getPageContent = vi.fn().mockResolvedValue({
    blocks: [
      {
        kind: "paragraph",
        richText: [
          {
            bold: false,
            code: false,
            href: null,
            italic: false,
            strikethrough: false,
            text: "최신 본문",
          },
        ],
      },
    ],
    createdAt: new Date("2026-07-18T09:00:00.000Z"),
    lastEditedAt: new Date("2026-07-19T10:00:00.000Z"),
    providerPageId: PAGE_ID,
    title: "한글 게시 글",
  });
  const notion: NotionContentAdapter = {
    getPageContent,
    listPageOutline: vi.fn(),
    listPageTree: vi.fn(),
  };
  const getPagesRepository = vi.fn().mockResolvedValue({
    defaultBranch: "pages-production",
    fullName: "octocat/octocat.github.io",
    isPrivate: false,
    providerRepositoryId: "123456",
  });
  const commitArtifacts = vi.fn().mockResolvedValue({
    commitSha: COMMIT_SHA,
    created: true,
  });
  const getDeploymentStatus = vi.fn().mockResolvedValue({
    actionsUrl:
      "https://github.com/octocat/octocat.github.io/actions/runs/1",
    pageUrl: "https://octocat.github.io/",
    state: "succeeded",
  });
  const github: GitHubRepositoryAdapter = {
    commitArtifacts,
    getDeploymentStatus,
    getPagesRepository,
  };
  const dependencies: PublishDependencies = {
    appOrigin: ORIGIN,
    createGitHubAdapter: (token) => {
      expect(token).toBe("github-secret-token");
      return github;
    },
    createNotionAdapter: (token) => {
      expect(token).toBe("notion-secret-token");
      return notion;
    },
    notionAuth: { connectionsCodec, sessionCodec },
    sessionCodec,
  };
  const cookie = `nkb_session=${session}; nkb_notion_connections=${connections}`;
  return {
    commitArtifacts,
    cookie,
    dependencies,
    getDeploymentStatus,
    getPageContent,
    getPagesRepository,
  };
}

describe("publish orchestration", () => {
  it("revalidates both providers and commits only server-generated artifacts", async () => {
    const context = await fixture();
    const response = await publishNotionPage(
      new Request(`${ORIGIN}/api/publish`, {
        body: JSON.stringify({
          connectionId: CONNECTION_ID,
          providerPageId: PAGE_ID,
        }),
        headers: {
          "content-type": "application/json",
          cookie: context.cookie,
          origin: ORIGIN,
        },
        method: "POST",
      }),
      context.dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      commitSha: COMMIT_SHA,
      contentHash: expect.stringMatching(CONTENT_HASH),
      created: true,
      pageUrl:
        "https://octocat.github.io/posts/notion-9188c6a57381/",
    });
    expect(context.getPageContent).toHaveBeenCalledWith(PAGE_ID);
    expect(context.getPagesRepository).toHaveBeenCalledWith(
      USER_ID,
      "octocat",
    );
    const artifacts = context.commitArtifacts.mock.calls[0]?.[1] as
      | readonly GitHubArtifact[]
      | undefined;
    expect(artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ".notion-kanban-blog/managed.json",
        }),
        expect.objectContaining({
          path: "src/content/blog/notion-9188c6a57381.md",
        }),
      ]),
    );
    const workflow = artifacts?.find(
      (artifact) => artifact.path === ".github/workflows/deploy.yml",
    );
    expect(new TextDecoder().decode(workflow?.bytes)).toContain(
      'branches: ["pages-production"]',
    );
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("github-secret-token");
    expect(serialized).not.toContain("notion-secret-token");
  });

  it("uses a unique commit message for repeated identical publishes", async () => {
    const context = await fixture();
    const createRequest = () =>
      new Request(`${ORIGIN}/api/publish`, {
        body: JSON.stringify({
          connectionId: CONNECTION_ID,
          providerPageId: PAGE_ID,
        }),
        headers: {
          "content-type": "application/json",
          cookie: context.cookie,
          origin: ORIGIN,
        },
        method: "POST",
      });

    await publishNotionPage(createRequest(), context.dependencies);
    await publishNotionPage(createRequest(), context.dependencies);

    const firstMessage = context.commitArtifacts.mock.calls[0]?.[2];
    const secondMessage = context.commitArtifacts.mock.calls[1]?.[2];
    expect(firstMessage).toMatch(
      /^Publish 한글 게시 글 \([a-f0-9]{12}; [a-f0-9-]{36}\)$/,
    );
    expect(secondMessage).not.toBe(firstMessage);
  });

  it("rejects cross-origin mutations before using provider credentials", async () => {
    const context = await fixture();
    const response = await publishNotionPage(
      new Request(`${ORIGIN}/api/publish`, {
        body: "{}",
        headers: { cookie: context.cookie, origin: "https://evil.example" },
        method: "POST",
      }),
      context.dependencies,
    );

    expect(response.status).toBe(403);
    expect(context.getPageContent).not.toHaveBeenCalled();
    expect(context.getPagesRepository).not.toHaveBeenCalled();
  });

  it("revalidates repository ownership before restoring deployment status", async () => {
    const context = await fixture();
    const response = await getPublishStatus(
      new Request(
        `${ORIGIN}/api/publish/status?commitSha=${COMMIT_SHA}`,
        { headers: { cookie: context.cookie } },
      ),
      context.dependencies,
    );

    await expect(response.json()).resolves.toMatchObject({
      commitSha: COMMIT_SHA,
      state: "succeeded",
    });
    expect(context.getPagesRepository).toHaveBeenCalledWith(
      USER_ID,
      "octocat",
    );
    expect(context.getDeploymentStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: "octocat/octocat.github.io",
      }),
      COMMIT_SHA,
    );
  });

  it("builds stable collision-resistant slugs and artifact hashes", () => {
    expect(pageSlug("한글 제목", PAGE_ID)).toBe(
      "notion-9188c6a57381",
    );
    expect(pageSlug("Hello, World!", PAGE_ID)).toBe(
      "hello-world-9188c6a57381",
    );
    const artifacts = [
      { bytes: new TextEncoder().encode("b"), path: "b.txt" },
      { bytes: new TextEncoder().encode("a"), path: "a.txt" },
    ];
    expect(artifactHash(artifacts)).toBe(
      artifactHash([...artifacts].reverse()),
    );
  });
});
