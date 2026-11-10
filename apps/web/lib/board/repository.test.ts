import Dexie from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import {
  BoardRepository,
  boardDatabaseName,
  boardRecordSchema,
  type BoardRecord,
  type BoardSyncSource,
} from "./repository";

const OWNER_A = "583231";
const OWNER_B = "999999";
const CONNECTION_ID = "3c90c3cc-0d44-4b50-8888-8dd25736052a";
const PAGE_ID = "9188c6a5-7381-452f-b3dc-d4865aa89bdf";
const SECOND_PAGE_ID = "019c75c2-3ce6-7988-a2bc-0a56ba576bc3";
const EDITED_AT = "2026-07-19T10:00:00.000Z";
const DEXIE_OPTIONS = { IDBKeyRange, indexedDB };
const STORES = {
  boardRecords:
    "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId, [ownerGitHubUserId+column], updatedAt",
};
const databases = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...databases].map((name) => new Dexie(name, DEXIE_OPTIONS).delete()),
  );
  databases.clear();
});

function repository(owner: string, databaseName = uniqueDatabaseName(owner)) {
  databases.add(databaseName);
  return new BoardRepository(owner, {
    databaseName,
    dexie: DEXIE_OPTIONS,
    now: () => new Date("2026-07-19T10:30:00.000Z"),
  });
}

function source(overrides: Partial<BoardSyncSource> = {}): BoardSyncSource {
  return {
    connectionId: CONNECTION_ID,
    isVisibleByDefault: true,
    providerPageId: PAGE_ID,
    sourceLastEditedAt: EDITED_AT,
    title: "테스트 문서",
    ...overrides,
  };
}

/** 지정한 schema version으로 DB를 만들고 raw 값을 그대로 넣는다. */
async function seed(version: number, values: unknown[]): Promise<string> {
  const databaseName = uniqueDatabaseName(OWNER_A);
  databases.add(databaseName);
  const raw = new Dexie(databaseName, DEXIE_OPTIONS);
  raw.version(version).stores(STORES);
  await raw.table("boardRecords").bulkPut(values);
  raw.close();
  return databaseName;
}

describe("BoardRepository", () => {
  it("uses independent GitHub numeric ID namespaces", async () => {
    const first = repository(OWNER_A);
    const second = repository(OWNER_B);
    await first.syncDrafts([source({ title: "사용자 A 문서" })]);
    await second.syncDrafts([source({ title: "사용자 B 문서" })]);

    await expect(first.list()).resolves.toMatchObject([
      { ownerGitHubUserId: OWNER_A, title: "사용자 A 문서" },
    ]);
    await expect(second.list()).resolves.toMatchObject([
      { ownerGitHubUserId: OWNER_B, title: "사용자 B 문서" },
    ]);
    expect(boardDatabaseName(OWNER_A)).toBe("kanban-press.board.583231");
    expect(() => new BoardRepository("octocat")).toThrow("numeric");
    first.close();
    second.close();
  });

  it("appends new pages in order and restores positions after reopen", async () => {
    const databaseName = uniqueDatabaseName(OWNER_A);
    const first = repository(OWNER_A, databaseName);
    await first.syncDrafts([
      source(),
      source({ providerPageId: SECOND_PAGE_ID, title: "두 번째 문서" }),
    ]);
    first.close();

    const reopened = repository(OWNER_A, databaseName);
    expect((await reopened.list()).map(({ position, title }) => ({ position, title }))).toEqual([
      { position: 0, title: "테스트 문서" },
      { position: 1, title: "두 번째 문서" },
    ]);
    reopened.close();
  });

  it("rejects credentials and unknown fields before writing", async () => {
    const board = repository(OWNER_A);
    const unsafe = { ...source(), accessToken: "must-never-be-persisted" };

    await expect(board.syncDrafts([unsafe])).rejects.toThrow();
    await expect(board.list()).resolves.toEqual([]);
    board.close();
  });

  it("purges malformed and foreign-owner records on read", async () => {
    const valid = boardRecord({ title: "유효한 기존 문서" });
    const databaseName = await seed(12, [
      valid,
      { ...boardRecord({ providerPageId: SECOND_PAGE_ID }), refreshToken: "tampered-token" },
      boardRecord({ ownerGitHubUserId: OWNER_B, providerPageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    ]);

    const board = repository(OWNER_A, databaseName);
    await expect(board.list()).resolves.toEqual([valid]);
    await expect(board.get(CONNECTION_ID, SECOND_PAGE_ID)).resolves.toBeNull();
    board.close();
  });

  it("keeps existing version 12 records, including a legacy role override", async () => {
    const legacyContainer = boardRecord({
      isVisible: false,
      pageRole: "container",
      pageRoleOverride: "container",
      visibilityOverride: "shown",
    });
    const databaseName = await seed(12, [legacyContainer]);

    const board = repository(OWNER_A, databaseName);
    await expect(board.list()).resolves.toEqual([legacyContainer]);
    // 수동 container 설정은 구조 판별 결과보다 우선한다.
    await board.setStructureInspection(CONNECTION_ID, PAGE_ID, EDITED_AT, false);
    await expect(board.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      isVisible: false,
      pageRole: "container",
    });
    board.close();
  });

  it("clears a version 11 or older database instead of migrating it", async () => {
    const databaseName = await seed(11, [
      { ...boardRecord(), column: "published", publishedUrl: "https://octocat.github.io/posts/a/" },
    ]);

    const board = repository(OWNER_A, databaseName);
    await expect(board.list()).resolves.toEqual([]);
    await board.syncDrafts([source()]);
    await expect(board.list()).resolves.toMatchObject([{ title: "테스트 문서" }]);
    board.close();
  });

  it("reorders visible stored records", async () => {
    const board = repository(OWNER_A);
    await board.syncDrafts([
      source({ title: "첫 번째" }),
      source({ providerPageId: SECOND_PAGE_ID, title: "두 번째" }),
    ]);

    const records = await board.move(CONNECTION_ID, PAGE_ID, 1);

    expect(records.map(({ position, title }) => ({ position, title }))).toEqual([
      { position: 0, title: "두 번째" },
      { position: 1, title: "첫 번째" },
    ]);
    board.close();
  });

  it("syncs discovered pages while preserving explicit visibility", async () => {
    const board = repository(OWNER_A);
    await board.syncDrafts([
      source({ title: "첫 번째" }),
      source({ isVisibleByDefault: false, providerPageId: SECOND_PAGE_ID, title: "두 번째" }),
    ]);
    await board.setVisibility(CONNECTION_ID, PAGE_ID, false);

    const records = await board.syncDrafts([
      source({ sourceLastEditedAt: "2026-07-19T11:00:00.000Z", title: "수정된 첫 번째" }),
    ]);

    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          isVisible: false,
          sourceLastEditedAt: "2026-07-19T11:00:00.000Z",
          title: "수정된 첫 번째",
          visibilityOverride: "hidden",
        }),
        expect.objectContaining({ isVisible: false, title: "두 번째", visibilityOverride: null }),
      ]),
    );
    board.close();
  });

  it("keeps an explicitly shown child visible and moves it to the end", async () => {
    const board = repository(OWNER_A);
    await board.syncDrafts([
      source({ isVisibleByDefault: false }),
      source({ providerPageId: SECOND_PAGE_ID, title: "보이는 문서" }),
    ]);

    await board.setVisibility(CONNECTION_ID, PAGE_ID, true);
    await board.syncDrafts([source({ isVisibleByDefault: false })]);

    await expect(board.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      isVisible: true,
      position: 2,
      visibilityOverride: "shown",
    });
    board.close();
  });

  it("treats an inspected container as navigation-only and restores it as a document", async () => {
    const board = repository(OWNER_A);
    await board.syncDrafts([source()]);
    await board.setVisibility(CONNECTION_ID, PAGE_ID, true);

    await board.setStructureInspection(CONNECTION_ID, PAGE_ID, EDITED_AT, true);
    await expect(board.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      hasNavigableChildren: true,
      isVisible: false,
      pageRole: "container",
      pageRoleOverride: null,
    });
    await expect(board.setVisibility(CONNECTION_ID, PAGE_ID, true)).rejects.toThrow("cannot be shown");
    await expect(board.move(CONNECTION_ID, PAGE_ID, 0)).rejects.toThrow("cannot move");

    await board.setStructureInspection(CONNECTION_ID, PAGE_ID, EDITED_AT, false);
    await expect(board.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      isVisible: true,
      pageRole: "document",
      visibilityOverride: "shown",
    });
    board.close();
  });

  it("caches structure inspection and invalidates it when Notion changes", async () => {
    const board = repository(OWNER_A);
    await board.syncDrafts([source()]);
    await board.setStructureInspection(CONNECTION_ID, PAGE_ID, EDITED_AT, true);
    await expect(board.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      hasNavigableChildren: true,
      structureSourceLastEditedAt: EDITED_AT,
    });

    await board.syncDrafts([source({ sourceLastEditedAt: "2026-07-19T11:00:00.000Z" })]);
    await expect(board.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      hasNavigableChildren: null,
      structureSourceLastEditedAt: null,
    });
    board.close();
  });

  it("ignores a structure inspection for an older Notion revision", async () => {
    const board = repository(OWNER_A);
    await board.syncDrafts([source({ sourceLastEditedAt: "2026-07-19T11:00:00.000Z" })]);

    await board.setStructureInspection(CONNECTION_ID, PAGE_ID, EDITED_AT, true);

    await expect(board.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      hasNavigableChildren: null,
      pageRole: "document",
      structureSourceLastEditedAt: null,
    });
    board.close();
  });
});

function boardRecord(overrides: Partial<BoardRecord> = {}): BoardRecord {
  return boardRecordSchema.parse({
    column: "stored",
    connectionId: CONNECTION_ID,
    hasNavigableChildren: null,
    isVisible: true,
    ownerGitHubUserId: OWNER_A,
    pageRole: "document",
    pageRoleOverride: null,
    position: 0,
    providerPageId: PAGE_ID,
    sourceLastEditedAt: EDITED_AT,
    structureSourceLastEditedAt: null,
    title: "기존 문서",
    updatedAt: "2026-07-19T10:10:00.000Z",
    visibilityOverride: null,
    ...overrides,
  });
}

function uniqueDatabaseName(owner: string): string {
  return `test.${owner}.${crypto.randomUUID()}`;
}

describe("legacy database import (project rename)", () => {
  it("moves v12 records from the old database name into the new one and deletes the old database", async () => {
    const legacyName = `legacy-${Math.random()}`;
    const newName = `new-${Math.random()}`;
    databases.add(legacyName);
    databases.add(newName);
    const seed = repository(OWNER_A, legacyName);
    await seed.syncDrafts([source(), source({ providerPageId: SECOND_PAGE_ID, title: "둘째 문서" })]);
    await seed.setVisibility(CONNECTION_ID, SECOND_PAGE_ID, false);
    seed.close();

    const migrated = new BoardRepository(OWNER_A, {
      databaseName: newName,
      dexie: DEXIE_OPTIONS,
      legacyDatabaseName: legacyName,
    });
    const records = await migrated.list();
    expect(records.map((record) => [record.title, record.isVisible])).toEqual([
      ["테스트 문서", true],
      ["둘째 문서", false],
    ]);
    migrated.close();

    const reopened = new Dexie(legacyName, DEXIE_OPTIONS);
    await expect(reopened.open()).rejects.toThrow();
    reopened.close();
  });

  it("keeps existing records in the new database instead of overwriting them", async () => {
    const legacyName = `legacy-${Math.random()}`;
    const newName = `new-${Math.random()}`;
    databases.add(legacyName);
    databases.add(newName);
    const old = repository(OWNER_A, legacyName);
    await old.syncDrafts([source({ title: "옛 제목" })]);
    old.close();
    const current = repository(OWNER_A, newName);
    await current.syncDrafts([source({ title: "새 제목" })]);
    current.close();

    const migrated = new BoardRepository(OWNER_A, {
      databaseName: newName,
      dexie: DEXIE_OPTIONS,
      legacyDatabaseName: legacyName,
    });
    expect((await migrated.list()).map((record) => record.title)).toEqual(["새 제목"]);
    migrated.close();
  });
});
