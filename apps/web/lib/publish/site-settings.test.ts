// R11 사이트 설정 읽기·저장(결정 D3).
import { randomBytes } from "node:crypto";

import { createSessionCookieCodec } from "@kanban-press/auth/server";
import { entityId } from "@kanban-press/domain";
import { describe, expect, it, vi } from "vitest";

import { GitHubPagesClient } from "../github/pages";

import { getSiteSettings, saveSiteSettings, type SiteSettingsDependencies } from "./site-settings-route";

const NOW = 2_000_000_000;
const ORIGIN = "http://localhost:3000";
const SETTINGS = {
  description: "Notion으로 쓰는 개발 기록",
  links: [{ label: "GitHub", url: "https://github.com/octocat" }],
  title: "옥토캣 블로그",
};

describe("site settings route", () => {
  it("returns defaults when the repository has no settings file", async () => {
    const context = await fixture(null);
    const response = await getSiteSettings(get(context.cookie), context.dependencies);
    await expect(response.json()).resolves.toEqual({
      settings: {
        description: "Notion에서 쓰고 GitHub Pages에 쌓아 가는 개발 기록입니다.",
        links: [],
        title: "octocat.log",
      },
      stored: false,
    });
    expect(context.readFile).toHaveBeenCalledWith(expect.anything(), ".kanban-press/site.json");
  });

  it("returns stored settings and falls back to defaults for a malformed file", async () => {
    const stored = await fixture(JSON.stringify(SETTINGS));
    await expect((await getSiteSettings(get(stored.cookie), stored.dependencies)).json()).resolves.toEqual({
      settings: SETTINGS,
      stored: true,
    });
    const broken = await fixture('{"title": 1}');
    await expect((await getSiteSettings(get(broken.cookie), broken.dependencies)).json()).resolves.toMatchObject({
      stored: false,
    });
  });

  it("commits only the settings file with deterministic JSON", async () => {
    const context = await fixture(null);
    const response = await saveSiteSettings(put(context.cookie, SETTINGS), context.dependencies);
    expect(response.status).toBe(200);
    const [, artifacts, message, deletePaths] = context.commitArtifacts.mock.calls[0] as [
      unknown,
      { bytes: Uint8Array; path: string }[],
      string,
      unknown,
    ];
    expect(message).toBe("Update blog settings");
    expect(deletePaths).toEqual([]);
    expect(artifacts.map((artifact) => artifact.path)).toEqual([".kanban-press/site.json"]);
    expect(JSON.parse(new TextDecoder().decode(artifacts[0]?.bytes))).toEqual(SETTINGS);
  });

  it.each([
    { ...SETTINGS, links: [{ label: "x", url: "http://insecure.example" }] },
    { ...SETTINGS, title: "" },
    { ...SETTINGS, title: "가".repeat(41) },
    { ...SETTINGS, extra: true },
    { ...SETTINGS, links: Array(5).fill(SETTINGS.links[0]) },
  ])("rejects invalid settings without committing: %j", async (body) => {
    const context = await fixture(null);
    const response = await saveSiteSettings(put(context.cookie, body), context.dependencies);
    expect(response.status).toBe(400);
    expect(context.commitArtifacts).not.toHaveBeenCalled();
  });

  it("rejects cross-origin, signed-out and unmanaged-repository saves", async () => {
    const context = await fixture(null);
    const crossOrigin = put(context.cookie, SETTINGS, "https://evil.example");
    expect((await saveSiteSettings(crossOrigin, context.dependencies)).status).toBe(403);
    expect((await saveSiteSettings(put("", SETTINGS), context.dependencies)).status).toBe(401);
    context.getRepositoryReadiness.mockResolvedValueOnce({ state: "repository_not_managed" });
    expect((await saveSiteSettings(put(context.cookie, SETTINGS), context.dependencies)).status).toBe(409);
    expect(context.commitArtifacts).not.toHaveBeenCalled();
  });
});

describe("GitHubPagesClient.readFile", () => {
  it("decodes a base64 file on the default branch and returns null when absent", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ content: Buffer.from('{"title":"블로그"}').toString("base64"), encoding: "base64", type: "file" }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const client = new GitHubPagesClient({ accessToken: "secret", apiVersion: "2026-03-10", fetch: fetchMock });
    const repository = {
      defaultBranch: "release/site",
      fullName: "octocat/octocat.github.io",
      isPrivate: false,
      providerRepositoryId: "1",
    };

    await expect(client.readFile(repository, ".kanban-press/site.json")).resolves.toBe('{"title":"블로그"}');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.github.com/repos/octocat/octocat.github.io/contents/.kanban-press/site.json?ref=release%2Fsite",
    );
    await expect(client.readFile(repository, ".kanban-press/site.json")).resolves.toBeNull();
  });
});

async function fixture(file: string | null) {
  const sessionCodec = createSessionCookieCodec({ activeKeyId: "v1", keys: { v1: randomBytes(32) }, now: () => NOW });
  const session = await sessionCodec.seal({
    accessToken: "github-token",
    expiresAt: NOW + 3_600,
    githubLogin: "octocat",
    issuedAt: NOW,
    userId: entityId("GitHubUser", "583231"),
  });
  const readFile = vi.fn().mockResolvedValue(file);
  const commitArtifacts = vi.fn().mockResolvedValue({ commitSha: "5".repeat(40), created: true });
  const getRepositoryReadiness = vi.fn().mockResolvedValue({ contentPaths: [], state: "ready" });
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
      getRepositoryReadiness,
      readFile,
    }),
    sessionCodec,
  };
  return { commitArtifacts, cookie: `kp_session=${session}`, dependencies, getRepositoryReadiness, readFile };
}

function get(cookie: string): Request {
  return new Request(`${ORIGIN}/api/blog/settings`, { headers: { cookie } });
}

function put(cookie: string, body: unknown, origin = ORIGIN): Request {
  return new Request(`${ORIGIN}/api/blog/settings`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", cookie, origin },
    method: "PUT",
  });
}
