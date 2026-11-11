// 칸반 보관 중 목록(블로그 저장소의 kanban-press-board branch, ADR 0003).
import { randomBytes } from "node:crypto";

import { createEncryptedCookieCodec, createSessionCookieCodec } from "@kanban-press/auth/server";
import { entityId } from "@kanban-press/domain";
import { describe, expect, it, vi } from "vitest";

import type { NotionConnectionsPayload } from "../auth/notion";
import { GitHubPagesClient, GitHubPagesError } from "../github/pages";

import { type BoardDependencies, changeBoard, getBoard, parseBoard } from "./board-route";

const NOW = 2_000_000_000;
const ORIGIN = "http://localhost:3000";
const USER_ID = "583231";
const CONNECTION_ID = "3c90c3cc-0d44-4b50-8888-8dd25736052a";
const PAGE_ID = "9188c6a5-7381-452f-b3dc-d4865aa89bdf";
const SUFFIX = "9188c6a57381452fb3dcd4865aa89bdf";
const OTHER = "a".repeat(32);
const BLOB = "c".repeat(40);
const REPOSITORY = { defaultBranch: "main", fullName: "octocat/octocat.github.io", isPrivate: false, providerRepositoryId: "1" };
const file = (pageIds: string[]) => ({ sha: BLOB, text: JSON.stringify({ pageIds, version: 1 }) });

describe("board route", () => {
  it("reads an empty list when the branch or file is missing or malformed", async () => {
    const context = await fixture(null);
    await expect((await getBoard(get(context.cookie), context.dependencies)).json()).resolves.toEqual({ pageIds: [] });
    expect(context.readBranchFile).toHaveBeenCalledWith(REPOSITORY, "kanban-press-board", "board.json");
    expect(parseBoard('{"version":1,"pageIds":["not-an-id"]}')).toEqual([]);
    expect(parseBoard("{")).toEqual([]);
  });

  it("adds a page by its 32-character ID and creates the file when it is missing", async () => {
    const context = await fixture(null);
    const response = await changeBoard(send(context.cookie), context.dependencies, "add");

    await expect(response.json()).resolves.toEqual({ pageIds: [SUFFIX] });
    const [, branch, path, text, sha] = context.writeBranchFile.mock.calls[0] as unknown[];
    expect([branch, path, sha]).toEqual(["kanban-press-board", "board.json", null]);
    expect(JSON.parse(String(text))).toEqual({ pageIds: [SUFFIX], version: 1 });
  });

  it("removes with the read SHA and skips the commit when nothing changes", async () => {
    const context = await fixture(file([OTHER, SUFFIX]));
    await expect((await changeBoard(send(context.cookie), context.dependencies, "add")).json()).resolves.toEqual({
      pageIds: [OTHER, SUFFIX],
    });
    expect(context.writeBranchFile).not.toHaveBeenCalled();

    await expect((await changeBoard(send(context.cookie), context.dependencies, "remove")).json()).resolves.toEqual({
      pageIds: [OTHER],
    });
    expect(context.writeBranchFile.mock.calls[0]?.[4]).toBe(BLOB);
  });

  it("reports a change made elsewhere as 409 without retrying", async () => {
    const context = await fixture(file([]));
    context.writeBranchFile.mockRejectedValueOnce(new GitHubPagesError("conflict"));
    const response = await changeBoard(send(context.cookie), context.dependencies, "add");

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "github_conflict" });
    expect(context.writeBranchFile).toHaveBeenCalledTimes(1);
  });

  it("rejects another origin, a connection the user does not own, and extra fields", async () => {
    const context = await fixture(file([]));
    expect((await changeBoard(send(context.cookie, {}, "https://evil.example"), context.dependencies, "add")).status).toBe(403);
    expect(
      (await changeBoard(send(context.cookie, { connectionId: "11111111-1111-4111-8111-111111111111" }), context.dependencies, "add")).status,
    ).toBe(404);
    expect((await changeBoard(send(context.cookie, { title: "x" }), context.dependencies, "add")).status).toBe(400);
    expect(context.writeBranchFile).not.toHaveBeenCalled();
  });

  it("requires a session to read", async () => {
    const context = await fixture(null);
    expect((await getBoard(get(""), context.dependencies)).status).toBe(401);
  });
});

describe("GitHubPagesClient board branch", () => {
  const sha = (digit: string) => digit.repeat(40);
  const client = (fetchMock: typeof fetch) =>
    new GitHubPagesClient({ accessToken: "secret", apiVersion: "2026-03-10", fetch: fetchMock });

  it("creates a missing branch as a parentless commit holding only the file", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ sha: sha("2") }))
      .mockResolvedValueOnce(Response.json({ sha: sha("3"), tree: { sha: sha("2") } }))
      .mockResolvedValueOnce(Response.json({ object: { sha: sha("3") } }));

    await client(fetchMock).writeBranchFile(REPOSITORY, "kanban-press-board", "board.json", "{}\n", null, "Add");
    const body = (index: number) => JSON.parse(String(fetchMock.mock.calls[index]?.[1]?.body)) as unknown;
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/git/ref/heads/kanban-press-board");
    expect(body(1)).toEqual({ tree: [{ content: "{}\n", mode: "100644", path: "board.json", type: "blob" }] });
    expect(body(2)).toEqual({ message: "Add", parents: [], tree: sha("2") });
    expect(body(3)).toEqual({ ref: "refs/heads/kanban-press-board", sha: sha("3") });
  });

  it("updates the file on the branch with the read SHA and maps a stale SHA to conflict", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ content: {} }))
      .mockResolvedValueOnce(new Response(null, { status: 422 }));

    await client(fetchMock).writeBranchFile(REPOSITORY, "kanban-press-board", "board.json", "{}\n", sha("4"), "Remove");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PUT");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      branch: "kanban-press-board",
      content: Buffer.from("{}\n").toString("base64"),
      message: "Remove",
      sha: sha("4"),
    });
    await expect(
      client(fetchMock).writeBranchFile(REPOSITORY, "kanban-press-board", "board.json", "{}\n", sha("4"), "Remove"),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("reads the file and its SHA from the branch, or null when the branch is missing", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ content: Buffer.from('{"a":1}').toString("base64"), encoding: "base64", sha: sha("5"), type: "file" }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }));

    await expect(client(fetchMock).readBranchFile(REPOSITORY, "kanban-press-board", "board.json")).resolves.toEqual({
      sha: sha("5"),
      text: '{"a":1}',
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/contents/board.json?ref=kanban-press-board");
    await expect(client(fetchMock).readBranchFile(REPOSITORY, "kanban-press-board", "board.json")).resolves.toBeNull();
  });
});

async function fixture(stored: { sha: string; text: string } | null) {
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
  const readBranchFile = vi.fn().mockResolvedValue(stored);
  const writeBranchFile = vi.fn().mockResolvedValue(undefined);
  const dependencies: BoardDependencies = {
    appOrigin: ORIGIN,
    createClient: () => ({
      getPagesRepository: vi.fn().mockResolvedValue(REPOSITORY),
      readBranchFile,
      writeBranchFile,
    }),
    createNotionAdapter: () => ({ getPageContent: vi.fn(), listPageOutline: vi.fn(), listPageTree: vi.fn() }),
    notionAuth: { connectionsCodec, sessionCodec },
    sessionCodec,
  };
  return { cookie: `kp_session=${session}; kp_notion_connections=${connections}`, dependencies, readBranchFile, writeBranchFile };
}

function get(cookie: string): Request {
  return new Request(`${ORIGIN}/api/board`, { headers: { cookie } });
}

function send(cookie: string, body: Record<string, unknown> = {}, origin = ORIGIN): Request {
  return new Request(`${ORIGIN}/api/board`, {
    body: JSON.stringify({ connectionId: CONNECTION_ID, providerPageId: PAGE_ID, ...body }),
    headers: { "content-type": "application/json", cookie, origin },
    method: "POST",
  });
}
