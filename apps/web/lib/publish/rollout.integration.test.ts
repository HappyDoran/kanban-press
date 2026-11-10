import { randomBytes } from "node:crypto";

import {
  createEncryptedCookieCodec,
  createSessionCookieCodec,
} from "@kanban-press/auth/server";
import { entityId } from "@kanban-press/domain";
import type {
  GitHubArtifact,
  GitHubRepositoryAdapter,
} from "@kanban-press/github";
import type {
  NotionContentAdapter,
  NotionPageContent,
} from "@kanban-press/notion";
import { describe, expect, it, vi } from "vitest";

import type { NotionConnectionsPayload } from "../auth/notion";
import { GitHubPagesError } from "../github/pages";
import { NotionProviderError } from "../notion/content";
import { categorySlug } from "./document";
import {
  publishNotionPage,
  type PublishDependencies,
} from "./orchestration";
import { previewNotionPage } from "./preview-orchestration";

const NOW = 2_000_000_000;
const ORIGIN = "http://localhost:3000";
const USER_ID = "583231";
const CONNECTION_ID = "3c90c3cc-0d44-4b50-8888-8dd25736052a";
const PAGE_ID = "9188c6a5-7381-452f-b3dc-d4865aa89bdf";
const COMMIT_SHA = "a".repeat(40);
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const CAPABILITY_URL =
  "https://files.notion.example/release.png?X-Amz-Signature=provider-secret";

interface RolloutFixture {
  commitArtifacts: ReturnType<typeof vi.fn>;
  cookie: string;
  dependencies: PublishDependencies;
  getPageContent: ReturnType<typeof vi.fn>;
  getPagesRepository: ReturnType<typeof vi.fn>;
  getRepositoryReadiness: ReturnType<typeof vi.fn>;
  setGitHubError(error: Error | null): void;
  setPage(page: NotionPageContent | Error): void;
}

describe("preview/category/template v2 rollout", () => {
  it("publishes only the latest source after a stale preview", async () => {
    const context = await fixture(previewPage());
    const previewResponse = await previewNotionPage(
      request("/api/publish/preview", context.cookie),
      context.dependencies,
    );
    const preview = await previewResponse.json();

    expect(previewResponse.status).toBe(200);
    expect(preview).toMatchObject({
      document: {
        category: { name: "Preview" },
        tags: ["preview-only"],
      },
      sourceLastEditedAt: "2026-08-10T01:00:00.000Z",
      templateVersion: 2,
    });

    context.setPage(releasePage());
    const publishResponse = await publishNotionPage(
      request("/api/publish", context.cookie),
      context.dependencies,
    );
    const publishResult = await publishResponse.json();

    expect(publishResponse.status).toBe(200);
    expect(publishResult).toMatchObject({
      commitSha: COMMIT_SHA,
      created: true,
      pageUrl: "https://octocat.github.io/posts/rollout-post-9188c6a57381452fb3dcd4865aa89bdf/",
    });
    expect(context.getPageContent).toHaveBeenCalledTimes(2);
    expect(context.getPagesRepository).toHaveBeenCalledOnce();
    expect(context.getRepositoryReadiness).toHaveBeenCalledOnce();
    expect(context.commitArtifacts).toHaveBeenCalledOnce();

    const artifacts = committedArtifacts(context);
    const markdown = textArtifact(
      artifacts,
      "src/content/blog/rollout-post-9188c6a57381452fb3dcd4865aa89bdf.md",
    );
    expect(markdown).toContain("schemaVersion: 2");
    expect(markdown).toContain('category: "Release"');
    expect(markdown).toContain(
      `categorySlug: "${categorySlug("Release")}"`,
    );
    expect(markdown).toContain('tags: ["latest", "v2"]');
    expect(markdown).toContain("최신 &lt;본문&gt;");
    expect(markdown).toContain(
      "../../assets/blog/rollout-post-9188c6a57381452fb3dcd4865aa89bdf/image-001.png",
    );
    expect(markdown).not.toContain("preview-only");
    expect(markdown).not.toContain("프리뷰 본문");
    expect(markdown).not.toContain("notion.example");
    expect(markdown).not.toContain("provider-secret");

    expect(artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ".kanban-press/managed.json",
        }),
        {
          bytes: PNG,
          path: "src/assets/blog/rollout-post-9188c6a57381452fb3dcd4865aa89bdf/image-001.png",
        },
      ]),
    );
    const marker = JSON.parse(
      textArtifact(artifacts, ".kanban-press/managed.json"),
    ) as unknown;
    expect(marker).toEqual({ publisher: "astro", templateVersion: 2 });
    const commitMessage = context.commitArtifacts.mock.calls[0]?.[2];
    expect(commitMessage).not.toContain("notion.example");
    expect(commitMessage).not.toContain("provider-secret");
    expect(JSON.stringify(preview)).not.toContain(CAPABILITY_URL);
  });

  it("stops when Notion access is revoked after preview", async () => {
    const context = await fixture(previewPage());
    const previewResponse = await previewNotionPage(
      request("/api/publish/preview", context.cookie),
      context.dependencies,
    );
    expect(previewResponse.status).toBe(200);

    context.setPage(new NotionProviderError("access_denied"));
    const publishResponse = await publishNotionPage(
      request("/api/publish", context.cookie),
      context.dependencies,
    );

    expect(publishResponse.status).toBe(403);
    await expect(publishResponse.json()).resolves.toEqual({
      error: "notion_access_denied",
    });
    expect(context.getPageContent).toHaveBeenCalledTimes(2);
    expect(context.getRepositoryReadiness).not.toHaveBeenCalled();
    expect(context.commitArtifacts).not.toHaveBeenCalled();
  });

  it("stops when GitHub write access is revoked after preview", async () => {
    const context = await fixture(previewPage());
    const previewResponse = await previewNotionPage(
      request("/api/publish/preview", context.cookie),
      context.dependencies,
    );
    expect(previewResponse.status).toBe(200);

    context.setPage(releasePage());
    context.setGitHubError(new GitHubPagesError("repository_write_denied"));
    const publishResponse = await publishNotionPage(
      request("/api/publish", context.cookie),
      context.dependencies,
    );

    expect(publishResponse.status).toBe(403);
    await expect(publishResponse.json()).resolves.toEqual({
      error: "github_repository_write_denied",
    });
    expect(context.getPageContent).toHaveBeenCalledTimes(2);
    expect(context.getPagesRepository).toHaveBeenCalledOnce();
    expect(context.getRepositoryReadiness).not.toHaveBeenCalled();
    expect(context.commitArtifacts).not.toHaveBeenCalled();
  });
});

async function fixture(initialPage: NotionPageContent): Promise<RolloutFixture> {
  const key = randomBytes(32);
  const sessionCodec = createSessionCookieCodec({
    activeKeyId: "v1",
    keys: { v1: key },
    now: () => NOW,
  });
  const connectionsCodec =
    createEncryptedCookieCodec<NotionConnectionsPayload>({
      activeKeyId: "v1",
      keys: { v1: key },
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

  let pageState: NotionPageContent | Error = initialPage;
  let githubError: Error | null = null;
  const getPageContent = vi.fn(async () => {
    if (pageState instanceof Error) {
      throw pageState;
    }
    return pageState;
  });
  const notion: NotionContentAdapter = {
    getPageContent,
    listPageOutline: vi.fn(),
    listPageTree: vi.fn(),
  };
  const repository = {
    defaultBranch: "main",
    fullName: "octocat/octocat.github.io",
    isPrivate: false,
    providerRepositoryId: "123456",
  };
  const getPagesRepository = vi.fn(async () => {
    if (githubError !== null) {
      throw githubError;
    }
    return repository;
  });
  const getRepositoryReadiness = vi.fn().mockResolvedValue({
    conflictingPaths: [],
    contentPaths: [],
    managedPaths: [],
    pagesSettingsUrl:
      "https://github.com/octocat/octocat.github.io/settings/pages",
    state: "ready",
  });
  const commitArtifacts = vi.fn().mockResolvedValue({
    commitSha: COMMIT_SHA,
    created: true,
  });
  const github: GitHubRepositoryAdapter = {
    commitArtifacts,
    getDeploymentStatus: vi.fn(),
    getPagesRepository,
    getRepositoryReadiness,
  };
  const dependencies: PublishDependencies = {
    appOrigin: ORIGIN,
    createGitHubAdapter: () => github,
    createNotionAdapter: () => notion,
    imageDependencies: {
      request: vi.fn().mockResolvedValue({
        body: (async function* () {
          yield PNG;
        })(),
        close: vi.fn(),
        headers: {
          "content-length": String(PNG.byteLength),
          "content-type": "image/png",
        },
        status: 200,
      }),
      resolve: vi
        .fn()
        .mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
    },
    notionAuth: { connectionsCodec, sessionCodec },
    sessionCodec,
  };

  return {
    commitArtifacts,
    cookie: `kp_session=${session}; kp_notion_connections=${connections}`,
    dependencies,
    getPageContent,
    getPagesRepository,
    getRepositoryReadiness,
    setGitHubError: (error) => {
      githubError = error;
    },
    setPage: (page) => {
      pageState = page;
    },
  };
}

function previewPage(): NotionPageContent {
  return page({
    body: "프리뷰 본문",
    category: "Preview",
    editedAt: "2026-08-10T01:00:00.000Z",
    tags: ["preview-only"],
  });
}

function releasePage(): NotionPageContent {
  return page({
    body: "최신 <본문>",
    category: "Release",
    editedAt: "2026-08-11T02:00:00.000Z",
    imageUrl: CAPABILITY_URL,
    tags: ["latest", "v2"],
  });
}

function page({
  body,
  category,
  editedAt,
  imageUrl,
  tags,
}: {
  body: string;
  category: string;
  editedAt: string;
  imageUrl?: string;
  tags: string[];
}): NotionPageContent {
  const richText = [
    {
      bold: false,
      code: false,
      href: null,
      italic: false,
      strikethrough: false,
      text: body,
    },
  ];
  return {
    blocks: [
      { kind: "paragraph", richText },
      ...(imageUrl === undefined
        ? []
        : [{ caption: [], kind: "image" as const, url: imageUrl }]),
    ],
    createdAt: new Date("2026-08-09T00:00:00.000Z"),
    lastEditedAt: new Date(editedAt),
    providerPageId: PAGE_ID,
    publishingProperties: {
      "Blog Category": { kind: "select", name: category },
      "Blog Description": { kind: "rich_text", plainText: body },
      "Blog Tags": { kind: "multi_select", names: tags },
    },
    title: "Rollout Post",
  };
}

function request(path: string, cookie: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    body: JSON.stringify({
      connectionId: CONNECTION_ID,
      providerPageId: PAGE_ID,
    }),
    headers: {
      "content-type": "application/json",
      cookie,
      origin: ORIGIN,
    },
    method: "POST",
  });
}

function committedArtifacts(context: RolloutFixture): readonly GitHubArtifact[] {
  const artifacts = context.commitArtifacts.mock.calls[0]?.[1] as
    | readonly GitHubArtifact[]
    | undefined;
  if (artifacts === undefined) {
    throw new Error("Expected committed artifacts");
  }
  return artifacts;
}

function textArtifact(
  artifacts: readonly GitHubArtifact[],
  path: string,
): string {
  const artifact = artifacts.find((candidate) => candidate.path === path);
  if (artifact === undefined) {
    throw new Error(`Missing expected artifact: ${path}`);
  }
  return new TextDecoder().decode(artifact.bytes);
}
