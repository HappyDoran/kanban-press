import { randomBytes } from "node:crypto";

import {
  createEncryptedCookieCodec,
  createSessionCookieCodec,
} from "@kanban-press/auth/server";
import { entityId } from "@kanban-press/domain";
import { describe, expect, it, vi } from "vitest";

import type {
  GitHubArtifact,
  GitHubRepositoryAdapter,
} from "@kanban-press/github";
import type { NotionContentAdapter } from "@kanban-press/notion";
import { createMarkdownArtifact } from "@kanban-press/publisher";
import type { NotionConnectionsPayload } from "../auth/notion";
import { NotionProviderError } from "../notion/content";
import {
  artifactHash,
  getPublishStatus,
  pageSlug,
  publishNotionPage,
  type PublishDependencies,
} from "./orchestration";
import { previewNotionPage } from "./preview-orchestration";

vi.mock("@kanban-press/publisher", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@kanban-press/publisher")>();
  return {
    ...actual,
    createMarkdownArtifact: vi.fn((document: { slug: string }) => ({
      bytes: new TextEncoder().encode("shared publish document"),
      path: `src/content/blog/${document.slug}.md`,
    })),
  };
});

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
    publishingProperties: {},
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
  const getRepositoryReadiness = vi.fn().mockResolvedValue({
    conflictingPaths: [],
    contentPaths: [],
    managedPaths: ["package.json"],
    pagesSettingsUrl:
      "https://github.com/octocat/octocat.github.io/settings/pages",
    state: "ready",
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
    getRepositoryReadiness,
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
    imageDependencies: {
      request: vi.fn(),
      resolve: vi.fn(),
    },
    notionAuth: { connectionsCodec, sessionCodec },
    sessionCodec,
  };
  const cookie = `kp_session=${session}; kp_notion_connections=${connections}`;
  return {
    commitArtifacts,
    cookie,
    dependencies,
    getDeploymentStatus,
    getPageContent,
    getPagesRepository,
    getRepositoryReadiness,
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
        "https://octocat.github.io/posts/notion-9188c6a57381452fb3dcd4865aa89bdf/",
    });
    expect(context.getPageContent).toHaveBeenCalledWith(PAGE_ID);
    expect(context.getPagesRepository).toHaveBeenCalledWith(
      USER_ID,
      "octocat",
    );
    expect(context.getRepositoryReadiness).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: "octocat/octocat.github.io" }),
      expect.arrayContaining([
        "package.json",
        "src/content/blog/notion-9188c6a57381452fb3dcd4865aa89bdf.md",
      ]),
    );
    expect(createMarkdownArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        category: { name: "미분류", slug: "uncategorized" },
        description: "최신 본문",
        publishedAt: "2026-07-18T09:00:00.000Z",
        schemaVersion: 2,
        slug: "notion-9188c6a57381452fb3dcd4865aa89bdf",
        tags: [],
      }),
    );
    const artifacts = context.commitArtifacts.mock.calls[0]?.[1] as
      | readonly GitHubArtifact[]
      | undefined;
    expect(artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ".kanban-press/managed.json",
        }),
        expect.objectContaining({
          path: "src/content/blog/notion-9188c6a57381452fb3dcd4865aa89bdf.md",
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

  it("downloads provider images into local artifacts without leaking capability URLs", async () => {
    const context = await fixture();
    const capabilityUrl =
      "https://files.notion.example/private.png?X-Amz-Signature=provider-secret";
    context.getPageContent.mockResolvedValue({
      blocks: [
        {
          caption: [],
          kind: "image",
          url: capabilityUrl,
        },
      ],
      createdAt: new Date("2026-07-18T09:00:00.000Z"),
      lastEditedAt: new Date("2026-07-19T10:00:00.000Z"),
      providerPageId: PAGE_ID,
      publishingProperties: {},
      title: "이미지 게시 글",
    });
    context.dependencies.imageDependencies = {
      request: vi.fn().mockResolvedValue({
        body: (async function* () {
          yield new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
        })(),
        close: vi.fn(),
        headers: {
          "content-length": "8",
          "content-type": "image/png",
        },
        status: 200,
      }),
      resolve: vi
        .fn()
        .mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
    };

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
    expect(createMarkdownArtifact).toHaveBeenLastCalledWith(
      expect.objectContaining({
        blocks: [
          {
            assetPath:
              "../../assets/blog/notion-9188c6a57381452fb3dcd4865aa89bdf/image-001.png",
            caption: [],
            kind: "image",
          },
        ],
      }),
    );
    const artifacts = context.commitArtifacts.mock.calls[0]?.[1] as
      | readonly GitHubArtifact[]
      | undefined;
    expect(artifacts).toEqual(
      expect.arrayContaining([
        {
          bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
          path: "src/assets/blog/notion-9188c6a57381452fb3dcd4865aa89bdf/image-001.png",
        },
      ]),
    );
    expect(context.getRepositoryReadiness).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        "src/assets/blog/notion-9188c6a57381452fb3dcd4865aa89bdf/image-001.png",
      ]),
    );
    const commitMessage = context.commitArtifacts.mock.calls[0]?.[2];
    expect(commitMessage).not.toContain("notion.example");
    expect(commitMessage).not.toContain("provider-secret");
    expect(JSON.stringify(body)).not.toContain(capabilityUrl);
  });

  it("returns a URL-free 422 before readiness or commit for blocked image hosts", async () => {
    const context = await fixture();
    const capabilityUrl =
      "https://files.notion.example/private.png?X-Amz-Signature=provider-secret";
    context.getPageContent.mockResolvedValue({
      blocks: [{ caption: [], kind: "image", url: capabilityUrl }],
      createdAt: new Date("2026-07-18T09:00:00.000Z"),
      lastEditedAt: new Date("2026-07-19T10:00:00.000Z"),
      providerPageId: PAGE_ID,
      publishingProperties: {},
      title: "차단 이미지",
    });
    context.dependencies.imageDependencies = {
      request: vi.fn(),
      resolve: vi
        .fn()
        .mockResolvedValue([{ address: "169.254.169.254", family: 4 }]),
    };

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

    expect(response.status).toBe(422);
    expect(body).toEqual({ detail: "blocked_address", error: "invalid_publish_image" });
    expect(JSON.stringify(body)).not.toContain("notion.example");
    expect(JSON.stringify(body)).not.toContain("provider-secret");
    expect(context.getRepositoryReadiness).not.toHaveBeenCalled();
    expect(context.commitArtifacts).not.toHaveBeenCalled();
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

  it.each([
    ["pages_setup_required", "github_pages_setup_required"],
    ["repository_not_managed", "github_repository_not_managed"],
  ] as const)(
    "stops with 409 before commit when readiness is %s",
    async (state, code) => {
      const context = await fixture();
      context.getRepositoryReadiness.mockResolvedValue({
        conflictingPaths:
          state === "repository_not_managed" ? ["README.md"] : [],
        managedPaths: ["package.json"],
        pagesSettingsUrl:
          "https://github.com/octocat/octocat.github.io/settings/pages",
        state,
      });

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

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: code });
      expect(context.getPageContent).toHaveBeenCalledWith(PAGE_ID);
      expect(context.getRepositoryReadiness).toHaveBeenCalledOnce();
      expect(context.commitArtifacts).not.toHaveBeenCalled();
    },
  );

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

  it("rejects browser-supplied publishing metadata and readiness input", async () => {
    const context = await fixture();
    const response = await publishNotionPage(
      new Request(`${ORIGIN}/api/publish`, {
        body: JSON.stringify({
          connectionId: CONNECTION_ID,
          providerPageId: PAGE_ID,
          category: "browser category",
          markdown: "# browser content",
          readiness: { state: "ready" },
          slug: "browser-slug",
          tags: ["browser-tag"],
          title: "browser title",
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

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_publish_request",
    });
    expect(context.getPageContent).not.toHaveBeenCalled();
    expect(context.getRepositoryReadiness).not.toHaveBeenCalled();
    expect(context.commitArtifacts).not.toHaveBeenCalled();
  });

  it("maps shared builder metadata failures to HTTP 422", async () => {
    const context = await fixture();
    context.getPageContent.mockResolvedValue({
      blocks: [],
      createdAt: new Date("2026-07-18T09:00:00.000Z"),
      lastEditedAt: new Date("2026-07-19T10:00:00.000Z"),
      providerPageId: PAGE_ID,
      publishingProperties: {
        "Blog Category": { kind: "select", name: "" },
      },
      title: "한글 게시 글",
    });

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

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      detail: "Blog Category",
      error: "invalid_blog_metadata",
    });
    expect(context.getRepositoryReadiness).not.toHaveBeenCalled();
    expect(context.commitArtifacts).not.toHaveBeenCalled();
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
      "notion-9188c6a57381452fb3dcd4865aa89bdf",
    );
    expect(pageSlug("Hello, World!", PAGE_ID)).toBe(
      "hello-world-9188c6a57381452fb3dcd4865aa89bdf",
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

describe("preview orchestration", () => {
  function request(cookie: string, body: unknown) {
    return new Request(`${ORIGIN}/api/publish/preview`, {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        cookie,
        origin: ORIGIN,
      },
      method: "POST",
    });
  }

  it("revalidates the owned Notion page and returns a no-store DTO without GitHub access", async () => {
    const context = await fixture();
    context.getPageContent.mockResolvedValue({
      blocks: [
        {
          caption: [
            {
              bold: false,
              code: false,
              href: null,
              italic: false,
              strikethrough: false,
              text: "이미지 설명",
            },
          ],
          kind: "image",
          url: "https://files.notion.example/image.png?signature=secret",
        },
      ],
      createdAt: new Date("2026-07-18T09:00:00.000Z"),
      lastEditedAt: new Date("2026-07-19T10:00:00.000Z"),
      providerPageId: PAGE_ID,
      publishingProperties: {
        "Blog Category": { kind: "select", name: "개발" },
      },
      title: "한글 게시 글",
    });

    const response = await previewNotionPage(
      request(context.cookie, {
        connectionId: CONNECTION_ID,
        providerPageId: PAGE_ID,
      }),
      context.dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(body).toMatchObject({
      document: {
        blocks: [{ caption: expect.any(Array), kind: "image" }],
        category: { name: "개발" },
        slug: "notion-9188c6a57381452fb3dcd4865aa89bdf",
        title: "한글 게시 글",
      },
      previewSchemaVersion: 1,
      sourceLastEditedAt: "2026-07-19T10:00:00.000Z",
      templateVersion: 2,
      warnings: [{ code: "image_placeholder" }],
    });
    expect(context.getPageContent).toHaveBeenCalledWith(PAGE_ID);
    expect(context.getPagesRepository).not.toHaveBeenCalled();
    expect(context.getRepositoryReadiness).not.toHaveBeenCalled();
    expect(context.commitArtifacts).not.toHaveBeenCalled();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("files.notion.example");
    expect(serialized).not.toContain("signature");
    expect(serialized).not.toContain("notion-secret-token");
    expect(serialized).not.toContain("publishingProperties");
  });

  it("rejects extra browser fields and unowned connections before reading content", async () => {
    const context = await fixture();
    const extraField = await previewNotionPage(
      request(context.cookie, {
        connectionId: CONNECTION_ID,
        markdown: "# browser supplied",
        providerPageId: PAGE_ID,
      }),
      context.dependencies,
    );
    expect(extraField.status).toBe(400);
    await expect(extraField.json()).resolves.toEqual({
      error: "invalid_preview_request",
    });

    const unowned = await previewNotionPage(
      request(context.cookie, {
        connectionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        providerPageId: PAGE_ID,
      }),
      context.dependencies,
    );
    expect(unowned.status).toBe(404);
    await expect(unowned.json()).resolves.toEqual({
      error: "notion_connection_not_found",
    });
    expect(context.getPageContent).not.toHaveBeenCalled();
    expect(context.getPagesRepository).not.toHaveBeenCalled();
    expect(context.commitArtifacts).not.toHaveBeenCalled();
  });

  it("rejects missing sessions, cross-origin requests, and mismatched provider pages", async () => {
    const context = await fixture();
    const unauthenticated = await previewNotionPage(
      request("", {
        connectionId: CONNECTION_ID,
        providerPageId: PAGE_ID,
      }),
      context.dependencies,
    );
    expect(unauthenticated.status).toBe(401);

    const crossOrigin = await previewNotionPage(
      new Request(`${ORIGIN}/api/publish/preview`, {
        body: "{}",
        headers: {
          "content-type": "application/json",
          cookie: context.cookie,
          origin: "https://evil.example",
        },
        method: "POST",
      }),
      context.dependencies,
    );
    expect(crossOrigin.status).toBe(403);

    context.getPageContent.mockResolvedValue({
      ...(await context.getPageContent()),
      providerPageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    context.getPageContent.mockClear();
    const mismatch = await previewNotionPage(
      request(context.cookie, {
        connectionId: CONNECTION_ID,
        providerPageId: PAGE_ID,
      }),
      context.dependencies,
    );
    expect(mismatch.status).toBe(403);
    await expect(mismatch.json()).resolves.toEqual({
      error: "notion_page_mismatch",
    });
    expect(context.getPagesRepository).not.toHaveBeenCalled();
    expect(context.commitArtifacts).not.toHaveBeenCalled();
  });

  it("maps shared metadata failures to 422 without GitHub mutation", async () => {
    const context = await fixture();
    context.getPageContent.mockResolvedValue({
      blocks: [],
      createdAt: new Date("2026-07-18T09:00:00.000Z"),
      lastEditedAt: new Date("2026-07-19T10:00:00.000Z"),
      providerPageId: PAGE_ID,
      publishingProperties: {
        "Blog Category": { kind: "select", name: "" },
      },
      title: "한글 게시 글",
    });

    const response = await previewNotionPage(
      request(context.cookie, {
        connectionId: CONNECTION_ID,
        providerPageId: PAGE_ID,
      }),
      context.dependencies,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      detail: "Blog Category",
      error: "invalid_blog_metadata",
    });
    expect(context.getPagesRepository).not.toHaveBeenCalled();
    expect(context.commitArtifacts).not.toHaveBeenCalled();
  });

  it("maps Notion rate limits with a bounded retry header", async () => {
    const context = await fixture();
    context.getPageContent.mockRejectedValue(
      new NotionProviderError("rate_limited", 45),
    );

    const response = await previewNotionPage(
      request(context.cookie, {
        connectionId: CONNECTION_ID,
        providerPageId: PAGE_ID,
      }),
      context.dependencies,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("45");
    await expect(response.json()).resolves.toEqual({
      error: "notion_rate_limited",
    });
    expect(context.getPagesRepository).not.toHaveBeenCalled();
    expect(context.commitArtifacts).not.toHaveBeenCalled();
  });
});
