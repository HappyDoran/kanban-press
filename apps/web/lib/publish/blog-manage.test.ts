// R8 블로그 글 관리: 옛 글 정리, 블로그에서 내리기, 게시된 글 목록.
import { randomBytes } from "node:crypto";

import { createEncryptedCookieCodec, createSessionCookieCodec } from "@kanban-press/auth/server";
import { entityId } from "@kanban-press/domain";
import type { GitHubArtifact } from "@kanban-press/github";
import { describe, expect, it, vi } from "vitest";

import type { NotionConnectionsPayload } from "../auth/notion";
import { GitHubPagesClient } from "../github/pages";

import { pageFiles, pageIdSuffix, publishedPosts, redirectPage } from "./blog-files";
import { listPublishedPosts, publishNotionPage, type PublishDependencies, unpublishNotionPage } from "./orchestration";

const NOW = 2_000_000_000;
const ORIGIN = "http://localhost:3000";
const USER_ID = "583231";
const CONNECTION_ID = "3c90c3cc-0d44-4b50-8888-8dd25736052a";
const PAGE_ID = "9188c6a5-7381-452f-b3dc-d4865aa89bdf";
const SUFFIX = "9188c6a57381";
const OTHER = "src/content/blog/other-post-aaaaaaaaaaaa.md";
const LEGACY = "src/content/blog/legacy-post.md";

describe("blog-files", () => {
  const paths = [
    `src/content/blog/old-title-${SUFFIX}.md`,
    `src/assets/blog/old-title-${SUFFIX}/image-001.png`,
    `public/posts/older-title-${SUFFIX}/index.html`,
    `src/content/blog/notion-${SUFFIX}.md`,
    OTHER,
    "src/assets/blog/other-post-aaaaaaaaaaaa/image-001.png",
    LEGACY,
  ];

  it("finds every file of one page by its ID suffix and leaves other and v1 posts alone", () => {
    expect(pageIdSuffix(PAGE_ID)).toBe(SUFFIX);
    const files = pageFiles(paths, SUFFIX);
    expect(files.paths).toEqual(paths.slice(0, 4));
    expect(files.slugs.sort()).toEqual([`notion-${SUFFIX}`, `old-title-${SUFFIX}`, `older-title-${SUFFIX}`]);
    expect(publishedPosts(paths)).toEqual([
      { slug: `old-title-${SUFFIX}`, suffix: SUFFIX },
      { slug: `notion-${SUFFIX}`, suffix: SUFFIX },
      { slug: "other-post-aaaaaaaaaaaa", suffix: "aaaaaaaaaaaa" },
    ]);
  });

  it("writes a redirect page that works without JavaScript and escapes the URL", () => {
    const page = redirectPage("old", "new", 'https://octocat.github.io/posts/new/"><script>');
    const html = new TextDecoder().decode(page.bytes);
    expect(page.path).toBe("public/posts/old/index.html");
    expect(html).toContain('<meta http-equiv="refresh" content="0; url=../new/">');
    expect(html).toContain('<a href="../new/">');
    expect(html).toContain('<link rel="canonical" href="https://octocat.github.io/posts/new/&quot;&gt;&lt;script&gt;">');
    expect(html).not.toContain("<script>");
  });
});

describe("publish cleanup", () => {
  it("deletes the old title's post and images, keeps other posts, and leaves a redirect", async () => {
    const context = await fixture([
      `src/content/blog/old-title-${SUFFIX}.md`,
      `src/assets/blog/old-title-${SUFFIX}/image-001.png`,
      `src/assets/blog/notion-${SUFFIX}/image-002.png`,
      `public/posts/notion-${SUFFIX}/index.html`,
      OTHER,
      LEGACY,
    ]);
    const response = await publishNotionPage(request("/api/publish", context.cookie), context.dependencies);
    expect(response.status).toBe(200);

    const [, artifacts, , deletePaths] = context.commitArtifacts.mock.calls[0] as [
      unknown,
      GitHubArtifact[],
      string,
      string[],
    ];
    expect(deletePaths.sort()).toEqual(
      [
        `public/posts/notion-${SUFFIX}/index.html`,
        `src/assets/blog/notion-${SUFFIX}/image-002.png`,
        `src/assets/blog/old-title-${SUFFIX}/image-001.png`,
        `src/content/blog/old-title-${SUFFIX}.md`,
      ].sort(),
    );
    const redirect = artifacts.find((artifact) => artifact.path === `public/posts/old-title-${SUFFIX}/index.html`);
    const html = new TextDecoder().decode(redirect?.bytes);
    expect(html).toContain(`url=../notion-${SUFFIX}/`);
    expect(html).toContain(`href="https://octocat.github.io/posts/notion-${SUFFIX}/"`);
    expect(artifacts.map((artifact) => artifact.path)).toContain(`src/content/blog/notion-${SUFFIX}.md`);
  });

  it("deletes the old app marker folder file when publishing to a repository from before the rename", async () => {
    const context = await fixture([".notion-kanban-blog/managed.json", ".notion-kanban-blog/site.json"]);
    await publishNotionPage(request("/api/publish", context.cookie), context.dependencies);
    const [, artifacts, , deletePaths] = context.commitArtifacts.mock.calls[0] as [unknown, GitHubArtifact[], string, string[]];
    expect(deletePaths).toEqual([".notion-kanban-blog/managed.json"]);
    expect(artifacts.map((artifact) => artifact.path)).toContain(".kanban-press/managed.json");
  });

  it("deletes nothing on a first publish", async () => {
    const context = await fixture([OTHER]);
    await publishNotionPage(request("/api/publish", context.cookie), context.dependencies);
    expect(context.commitArtifacts.mock.calls[0]?.[3]).toEqual([]);
  });
});

describe("unpublish", () => {
  it("deletes only this page's files in one commit without reading Notion", async () => {
    const context = await fixture([
      `src/content/blog/notion-${SUFFIX}.md`,
      `src/assets/blog/notion-${SUFFIX}/image-001.png`,
      `public/posts/old-title-${SUFFIX}/index.html`,
      OTHER,
      LEGACY,
    ]);
    const response = await unpublishNotionPage(request("/api/publish/unpublish", context.cookie), context.dependencies);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ commitSha: "5".repeat(40) });
    expect(context.getPageContent).not.toHaveBeenCalled();
    const [, artifacts, message, deletePaths] = context.commitArtifacts.mock.calls[0] as unknown[];
    expect(artifacts).toEqual([]);
    expect(message).toBe(`Unpublish notion-${SUFFIX}, old-title-${SUFFIX}`);
    expect(deletePaths).toEqual([
      `src/content/blog/notion-${SUFFIX}.md`,
      `src/assets/blog/notion-${SUFFIX}/image-001.png`,
      `public/posts/old-title-${SUFFIX}/index.html`,
    ]);
  });

  it("returns 404 without committing when the page is not on the blog", async () => {
    const context = await fixture([OTHER, LEGACY]);
    const response = await unpublishNotionPage(request("/api/publish/unpublish", context.cookie), context.dependencies);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "blog_post_not_found" });
    expect(context.commitArtifacts).not.toHaveBeenCalled();
  });

  it("rejects a connection the user does not own and a repository it does not manage", async () => {
    const context = await fixture([`src/content/blog/notion-${SUFFIX}.md`]);
    const unowned = await unpublishNotionPage(
      request("/api/publish/unpublish", context.cookie, "11111111-1111-4111-8111-111111111111"),
      context.dependencies,
    );
    expect(unowned.status).toBe(404);

    context.getRepositoryReadiness.mockResolvedValueOnce({
      conflictingPaths: ["README.md"],
      contentPaths: [],
      managedPaths: [],
      pagesSettingsUrl: "",
      state: "repository_not_managed",
    });
    const unmanaged = await unpublishNotionPage(request("/api/publish/unpublish", context.cookie), context.dependencies);
    expect(unmanaged.status).toBe(409);
    expect(context.commitArtifacts).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request", async () => {
    const context = await fixture([`src/content/blog/notion-${SUFFIX}.md`]);
    const response = await unpublishNotionPage(
      new Request(`${ORIGIN}/api/publish/unpublish`, {
        body: JSON.stringify({ connectionId: CONNECTION_ID, providerPageId: PAGE_ID }),
        headers: { "content-type": "application/json", cookie: context.cookie, origin: "https://evil.example" },
        method: "POST",
      }),
      context.dependencies,
    );
    expect(response.status).toBe(403);
    expect(context.commitArtifacts).not.toHaveBeenCalled();
  });
});

describe("published posts", () => {
  it("lists posts with an ID suffix as suffix and URL only", async () => {
    const context = await fixture([`src/content/blog/notion-${SUFFIX}.md`, LEGACY]);
    const response = await listPublishedPosts(
      new Request(`${ORIGIN}/api/publish/posts`, { headers: { cookie: context.cookie } }),
      context.dependencies,
    );
    await expect(response.json()).resolves.toEqual({
      posts: [{ pageIdSuffix: SUFFIX, pageUrl: `https://octocat.github.io/posts/notion-${SUFFIX}/` }],
    });
  });

  it("requires a session", async () => {
    const context = await fixture([]);
    const response = await listPublishedPosts(new Request(`${ORIGIN}/api/publish/posts`), context.dependencies);
    expect(response.status).toBe(401);
  });
});

describe("GitHubPagesClient deletions", () => {
  it("sends deleted paths as null-sha tree entries and reports content paths", async () => {
    const sha = (digit: string) => digit.repeat(40);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ object: { sha: sha("1") } }))
      .mockResolvedValueOnce(Response.json({ sha: sha("1"), tree: { sha: sha("2") } }))
      .mockResolvedValueOnce(Response.json({ sha: sha("4") }))
      .mockResolvedValueOnce(Response.json({ sha: sha("5"), tree: { sha: sha("4") } }))
      .mockResolvedValueOnce(Response.json({ object: { sha: sha("5") } }));
    const client = new GitHubPagesClient({ accessToken: "secret", apiVersion: "2026-03-10", fetch: fetchMock });
    const repository = {
      defaultBranch: "main",
      fullName: "octocat/octocat.github.io",
      isPrivate: false,
      providerRepositoryId: "1",
    };

    await client.commitArtifacts(repository, [], "Unpublish", [`src/content/blog/notion-${SUFFIX}.md`]);
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      base_tree: sha("2"),
      tree: [{ mode: "100644", path: `src/content/blog/notion-${SUFFIX}.md`, sha: null, type: "blob" }],
    });
    await expect(client.commitArtifacts(repository, [], "Nothing")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});

async function fixture(contentPaths: string[]) {
  const key = randomBytes(32);
  const sessionCodec = createSessionCookieCodec({ activeKeyId: "v1", keys: { v1: key }, now: () => NOW });
  const connectionsCodec = createEncryptedCookieCodec<NotionConnectionsPayload>({
    activeKeyId: "v1",
    keys: { v1: key },
    now: () => NOW,
    parsePayload: (value) => value as NotionConnectionsPayload,
  });
  const session = await sessionCodec.seal({
    accessToken: "github-token",
    expiresAt: NOW + 3_600,
    githubLogin: "octocat",
    issuedAt: NOW,
    userId: entityId("GitHubUser", USER_ID),
  });
  const connections = await connectionsCodec.seal(
    {
      connections: [
        {
          accessToken: "notion-token",
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
    blocks: [],
    createdAt: new Date("2026-07-18T09:00:00.000Z"),
    lastEditedAt: new Date("2026-07-19T10:00:00.000Z"),
    providerPageId: PAGE_ID,
    publishingProperties: {},
    title: "한글 게시 글",
  });
  const commitArtifacts = vi.fn().mockResolvedValue({ commitSha: "5".repeat(40), created: true });
  const getRepositoryReadiness = vi.fn().mockResolvedValue({
    conflictingPaths: [],
    contentPaths,
    managedPaths: [],
    pagesSettingsUrl: "",
    state: "ready",
  });
  const dependencies: PublishDependencies = {
    appOrigin: ORIGIN,
    createGitHubAdapter: () => ({
      commitArtifacts,
      getDeploymentStatus: vi.fn(),
      getPagesRepository: vi.fn().mockResolvedValue({
        defaultBranch: "main",
        fullName: "octocat/octocat.github.io",
        isPrivate: false,
        providerRepositoryId: "1",
      }),
      getRepositoryReadiness,
    }),
    createNotionAdapter: () => ({ getPageContent, listPageOutline: vi.fn(), listPageTree: vi.fn() }),
    imageDependencies: { request: vi.fn(), resolve: vi.fn() },
    notionAuth: { connectionsCodec, sessionCodec },
    sessionCodec,
  };
  return {
    commitArtifacts,
    cookie: `kp_session=${session}; kp_notion_connections=${connections}`,
    dependencies,
    getPageContent,
    getRepositoryReadiness,
  };
}

function request(path: string, cookie: string, connectionId = CONNECTION_ID): Request {
  return new Request(`${ORIGIN}${path}`, {
    body: JSON.stringify({ connectionId, providerPageId: PAGE_ID }),
    headers: { "content-type": "application/json", cookie, origin: ORIGIN },
    method: "POST",
  });
}
