// 프로젝트 이름 변경(notion-kanban-blog → kanban-press, 2026-11-10) 전 데이터와의 호환.
// 쿠키 AAD 호환은 packages/auth server.test의 재작성 전 fixture가 증명한다.
import { randomBytes } from "node:crypto";

import { createSessionCookieCodec } from "@kanban-press/auth/server";
import { entityId } from "@kanban-press/domain";
import { describe, expect, it, vi } from "vitest";

import { logout } from "./auth/github";
import { readSession } from "./auth/session";
import { GitHubPagesClient } from "./github/pages";
import { getSiteSettings, saveSiteSettings, type SiteSettingsDependencies } from "./publish/site-settings-route";

const NOW = 2_000_000_000;
const ORIGIN = "http://localhost:3000";
const sha = (digit: string) => digit.repeat(40);

describe("legacy cookie names", () => {
  it("reads a session from the old cookie name when the new one is absent, and logout clears both", async () => {
    const sessionCodec = createSessionCookieCodec({ activeKeyId: "v1", keys: { v1: randomBytes(32) }, now: () => NOW });
    const sealed = await sessionCodec.seal({
      accessToken: "token",
      expiresAt: NOW + 60,
      githubLogin: "octocat",
      issuedAt: NOW,
      userId: entityId("GitHubUser", "1"),
    });
    const session = await readSession(
      new Request(ORIGIN, { headers: { cookie: `nkb_session=${sealed}` } }),
      sessionCodec,
    );
    expect(session?.githubLogin).toBe("octocat");

    const response = logout(new Request(`${ORIGIN}/auth/logout`, { headers: { origin: ORIGIN }, method: "POST" }), {
      config: { appOrigin: ORIGIN, clientId: "id", secureCookies: false },
    });
    const cleared = response.headers.getSetCookie().map((cookie) => cookie.split("=")[0]);
    expect(cleared).toEqual(expect.arrayContaining(["kp_session", "nkb_session"]));
  });
});

describe("legacy blog repository folder (.notion-kanban-blog/)", () => {
  it("treats a repository with only the old marker as managed and reports the old files", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ object: { sha: sha("1") } }))
      .mockResolvedValueOnce(Response.json({ build_type: "workflow" }))
      .mockResolvedValueOnce(Response.json({ sha: sha("1"), tree: { sha: sha("2") } }))
      .mockResolvedValueOnce(
        Response.json({
          tree: [
            { mode: "100644", path: ".notion-kanban-blog/managed.json", sha: sha("3"), type: "blob" },
            { mode: "100644", path: ".notion-kanban-blog/site.json", sha: sha("4"), type: "blob" },
            { mode: "100644", path: "README.md", sha: sha("5"), type: "blob" },
          ],
          truncated: false,
        }),
      );
    const client = new GitHubPagesClient({ accessToken: "secret", apiVersion: "2026-03-10", fetch: fetchMock });
    const readiness = await client.getRepositoryReadiness(
      { defaultBranch: "main", fullName: "octocat/octocat.github.io", isPrivate: false, providerRepositoryId: "1" },
      ["package.json"],
    );
    expect(readiness).toMatchObject({
      conflictingPaths: [],
      contentPaths: [".notion-kanban-blog/managed.json", ".notion-kanban-blog/site.json"],
      state: "ready",
    });
  });

  it("reads settings from the old path and moves them to the new path on save", async () => {
    const sessionCodec = createSessionCookieCodec({ activeKeyId: "v1", keys: { v1: randomBytes(32) }, now: () => NOW });
    const cookie = `kp_session=${await sessionCodec.seal({
      accessToken: "token",
      expiresAt: NOW + 60,
      githubLogin: "octocat",
      issuedAt: NOW,
      userId: entityId("GitHubUser", "1"),
    })}`;
    const settings = { description: "옛 소개", links: [], title: "옛 블로그" };
    const readFile = vi.fn(async (_repository: unknown, path: string) =>
      path === ".notion-kanban-blog/site.json" ? JSON.stringify(settings) : null,
    );
    const commitArtifacts = vi.fn().mockResolvedValue({ commitSha: sha("6"), created: true });
    const dependencies: SiteSettingsDependencies = {
      appOrigin: ORIGIN,
      createClient: () => ({
        commitArtifacts,
        getPagesRepository: vi.fn().mockResolvedValue({
          defaultBranch: "main",
          fullName: "octocat/octocat.github.io",
          isPrivate: false,
          providerRepositoryId: "1",
        }),
        getRepositoryReadiness: vi.fn().mockResolvedValue({
          contentPaths: [".notion-kanban-blog/managed.json", ".notion-kanban-blog/site.json"],
          state: "ready",
        }),
        readFile,
      }),
      sessionCodec,
    };

    const read = await getSiteSettings(new Request(`${ORIGIN}/api/blog/settings`, { headers: { cookie } }), dependencies);
    await expect(read.json()).resolves.toEqual({ settings, stored: true });

    await saveSiteSettings(
      new Request(`${ORIGIN}/api/blog/settings`, {
        body: JSON.stringify({ ...settings, title: "새 블로그" }),
        headers: { "content-type": "application/json", cookie, origin: ORIGIN },
        method: "PUT",
      }),
      dependencies,
    );
    const [, artifacts, , deletePaths] = commitArtifacts.mock.calls[0] as [unknown, { path: string }[], string, string[]];
    expect(artifacts.map((artifact) => artifact.path)).toEqual([".kanban-press/site.json"]);
    expect(deletePaths).toEqual([".notion-kanban-blog/site.json"]);
  });
});
