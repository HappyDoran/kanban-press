import { randomBytes } from "node:crypto";

import { createSessionCookieCodec } from "@notion-kanban-blog/auth/server";
import { entityId } from "@notion-kanban-blog/domain";
import { describe, expect, it, vi } from "vitest";

import {
  getGitHubPagesRepository,
  GitHubPagesClient,
  GitHubPagesError,
} from "./pages";

const NOW = 2_000_000_000;
const ORIGIN = "http://localhost:3000";
const USER_ID = "583231";
const KEY = randomBytes(32);

function repositoryResponse(
  overrides: Record<string, unknown> = {},
): Response {
  return Response.json(
    {
      default_branch: "main",
      full_name: "octocat/octocat.github.io",
      id: 123456,
      name: "octocat.github.io",
      owner: { id: 583231, login: "octocat", type: "User" },
      permissions: { push: true },
      private: false,
      ...overrides,
    },
    { headers: { "x-oauth-scopes": "read:user, public_repo, workflow" } },
  );
}

describe("GitHubPagesClient", () => {
  it("allows only the signed-in user's public writable username.github.io repository", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(repositoryResponse());
    const client = new GitHubPagesClient({
      accessToken: "secret-oauth-token",
      apiVersion: "2026-03-10",
      fetch: fetchMock,
    });

    await expect(
      client.getPagesRepository(USER_ID, "octocat"),
    ).resolves.toEqual({
      defaultBranch: "main",
      fullName: "octocat/octocat.github.io",
      isPrivate: false,
      providerRepositoryId: "123456",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/octocat/octocat.github.io",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer secret-oauth-token",
        }),
      }),
    );
  });

  it.each([
    [
      { owner: { id: 999999, login: "other", type: "User" } },
      "repository_owner_mismatch",
    ],
    [{ name: "another-repository" }, "repository_owner_mismatch"],
    [{ private: true }, "repository_must_be_public"],
    [{ permissions: { push: false } }, "repository_write_denied"],
  ] as const)("rejects an unsafe repository: %s", async (overrides, code) => {
    const client = new GitHubPagesClient({
      accessToken: "secret",
      apiVersion: "2026-03-10",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        repositoryResponse(overrides),
      ),
    });

    await expect(
      client.getPagesRepository(USER_ID, "octocat"),
    ).rejects.toMatchObject({ code } satisfies Partial<GitHubPagesError>);
  });

  it.each([
    ["repository write", "read:user"],
    ["workflow", "read:user, public_repo"],
  ])("requires the OAuth %s scope on every check", async (_name, scopes) => {
    const response = repositoryResponse();
    response.headers.set("x-oauth-scopes", scopes);
    const client = new GitHubPagesClient({
      accessToken: "secret",
      apiVersion: "2026-03-10",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response),
    });

    await expect(
      client.getPagesRepository(USER_ID, "octocat"),
    ).rejects.toMatchObject({
      code: "oauth_scope_missing",
    } satisfies Partial<GitHubPagesError>);
  });

  it("accepts the broader repo scope only when workflow is also present", async () => {
    const response = repositoryResponse();
    response.headers.set("x-oauth-scopes", "read:user, repo, workflow");
    const client = new GitHubPagesClient({
      accessToken: "secret",
      apiVersion: "2026-03-10",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response),
    });

    await expect(
      client.getPagesRepository(USER_ID, "octocat"),
    ).resolves.toMatchObject({
      fullName: "octocat/octocat.github.io",
    });
  });

  it("does not report a missing repository when a later Git object is missing", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ object: { sha: "1".repeat(40) } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const client = new GitHubPagesClient({
      accessToken: "secret",
      apiVersion: "2026-03-10",
      fetch: fetchMock,
    });

    await expect(
      client.commitArtifacts(
        {
          defaultBranch: "main",
          fullName: "octocat/octocat.github.io",
          isPrivate: false,
          providerRepositoryId: "123456",
        },
        [{ bytes: new TextEncoder().encode("hello"), path: "hello.md" }],
        "Publish hello",
      ),
    ).rejects.toMatchObject({
      code: "git_resource_not_found",
    } satisfies Partial<GitHubPagesError>);
  });

  it("creates one Git commit and updates the default branch without force", async () => {
    const headSha = "1".repeat(40);
    const baseTreeSha = "2".repeat(40);
    const blobSha = "3".repeat(40);
    const treeSha = "4".repeat(40);
    const commitSha = "5".repeat(40);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ object: { sha: headSha } }))
      .mockResolvedValueOnce(
        Response.json({ sha: headSha, tree: { sha: baseTreeSha } }),
      )
      .mockResolvedValueOnce(Response.json({ sha: blobSha }))
      .mockResolvedValueOnce(Response.json({ sha: treeSha }))
      .mockResolvedValueOnce(
        Response.json({ sha: commitSha, tree: { sha: treeSha } }),
      )
      .mockResolvedValueOnce(
        Response.json({ object: { sha: commitSha } }),
      );
    const client = new GitHubPagesClient({
      accessToken: "secret",
      apiVersion: "2026-03-10",
      fetch: fetchMock,
    });

    await expect(
      client.commitArtifacts(
        {
          defaultBranch: "main",
          fullName: "octocat/octocat.github.io",
          isPrivate: false,
          providerRepositoryId: "123456",
        },
        [{ bytes: new TextEncoder().encode("hello"), path: "hello.md" }],
        "Publish hello",
      ),
    ).resolves.toEqual({ commitSha, created: true });
    expect(JSON.parse(String(fetchMock.mock.calls[5]?.[1]?.body))).toEqual({
      force: false,
      sha: commitSha,
    });
  });

  it("creates a new commit when the generated tree is unchanged", async () => {
    const headSha = "1".repeat(40);
    const baseTreeSha = "2".repeat(40);
    const commitSha = "4".repeat(40);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ object: { sha: headSha } }))
      .mockResolvedValueOnce(
        Response.json({ sha: headSha, tree: { sha: baseTreeSha } }),
      )
      .mockResolvedValueOnce(Response.json({ sha: "3".repeat(40) }))
      .mockResolvedValueOnce(Response.json({ sha: baseTreeSha }))
      .mockResolvedValueOnce(
        Response.json({
          sha: commitSha,
          tree: { sha: baseTreeSha },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ object: { sha: commitSha } }),
      );
    const client = new GitHubPagesClient({
      accessToken: "secret",
      apiVersion: "2026-03-10",
      fetch: fetchMock,
    });

    await expect(
      client.commitArtifacts(
        {
          defaultBranch: "main",
          fullName: "octocat/octocat.github.io",
          isPrivate: false,
          providerRepositoryId: "123456",
        },
        [{ bytes: new TextEncoder().encode("same"), path: "same.md" }],
        "Publish same",
      ),
    ).resolves.toEqual({ commitSha, created: true });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("creates the first branch ref for an empty Pages repository", async () => {
    const blobSha = "3".repeat(40);
    const treeSha = "4".repeat(40);
    const commitSha = "5".repeat(40);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ sha: blobSha }))
      .mockResolvedValueOnce(Response.json({ sha: treeSha }))
      .mockResolvedValueOnce(
        Response.json({ sha: commitSha, tree: { sha: treeSha } }),
      )
      .mockResolvedValueOnce(
        Response.json({ object: { sha: commitSha } }),
      );
    const client = new GitHubPagesClient({
      accessToken: "secret",
      apiVersion: "2026-03-10",
      fetch: fetchMock,
    });

    await expect(
      client.commitArtifacts(
        {
          defaultBranch: "main",
          fullName: "octocat/octocat.github.io",
          isPrivate: false,
          providerRepositoryId: "123456",
        },
        [{ bytes: new TextEncoder().encode("first"), path: "first.md" }],
        "Initial publish",
      ),
    ).resolves.toEqual({ commitSha, created: true });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      tree: [
        {
          mode: "100644",
          path: "first.md",
          sha: blobSha,
          type: "blob",
        },
      ],
    });
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({
      message: "Initial publish",
      tree: treeSha,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body))).toEqual({
      ref: "refs/heads/main",
      sha: commitSha,
    });
  });

  it("combines Actions and Pages state for a commit", async () => {
    const commitSha = "5".repeat(40);
    const client = new GitHubPagesClient({
      accessToken: "secret",
      apiVersion: "2026-03-10",
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({
            workflow_runs: [
              {
                conclusion: "success",
                head_sha: commitSha,
                html_url: "https://github.com/octocat/octocat.github.io/actions/runs/1",
                status: "completed",
              },
            ],
          }),
        )
        .mockResolvedValueOnce(Response.json({ status: "succeed" })),
    });

    await expect(
      client.getDeploymentStatus(
        {
          defaultBranch: "main",
          fullName: "octocat/octocat.github.io",
          isPrivate: false,
          providerRepositoryId: "123456",
        },
        commitSha,
      ),
    ).resolves.toEqual({
      actionsUrl:
        "https://github.com/octocat/octocat.github.io/actions/runs/1",
      pageUrl: "https://octocat.github.io/",
      state: "succeeded",
    });
  });
});

describe("GitHub Pages repository route orchestration", () => {
  it("uses the encrypted session credential without returning it", async () => {
    const sessionCodec = createSessionCookieCodec({
      activeKeyId: "v1",
      keys: { v1: KEY },
      now: () => NOW,
    });
    const session = await sessionCodec.seal({
      accessToken: "never-return-this-oauth-token",
      expiresAt: NOW + 3600,
      githubLogin: "octocat",
      issuedAt: NOW,
      userId: entityId("GitHubUser", USER_ID),
    });
    const getPagesRepository = vi.fn().mockResolvedValue({
      defaultBranch: "main",
      fullName: "octocat/octocat.github.io",
      isPrivate: false,
      providerRepositoryId: "123456",
    });

    const response = await getGitHubPagesRepository(
      new Request(`${ORIGIN}/api/github/pages-repository`, {
        headers: { cookie: `nkb_session=${session}` },
      }),
      {
        createClient: (accessToken) => {
          expect(accessToken).toBe("never-return-this-oauth-token");
          return {
            commitArtifacts: vi.fn(),
            getDeploymentStatus: vi.fn(),
            getPagesRepository,
          };
        },
        sessionCodec,
      },
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain("never-return-this-oauth-token");
    expect(getPagesRepository).toHaveBeenCalledWith(USER_ID, "octocat");
  });
});
