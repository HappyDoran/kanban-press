import Dexie from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import {
  BoardRepository,
  boardDatabaseName,
  boardRecordSchema,
} from "./repository";

import type {
  BoardDraftSource,
  BoardRecord,
} from "./repository";

const OWNER_A = "583231";
const OWNER_B = "999999";
const CONNECTION_ID = "3c90c3cc-0d44-4b50-8888-8dd25736052a";
const PAGE_ID = "9188c6a5-7381-452f-b3dc-d4865aa89bdf";
const DEXIE_OPTIONS = { IDBKeyRange, indexedDB };
const databases = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...databases].map((databaseName) =>
      new Dexie(databaseName, DEXIE_OPTIONS).delete(),
    ),
  );
  databases.clear();
});

function repository(
  ownerGitHubUserId: string,
  databaseName = uniqueDatabaseName(ownerGitHubUserId),
) {
  databases.add(databaseName);
  return new BoardRepository(ownerGitHubUserId, {
    databaseName,
    dexie: DEXIE_OPTIONS,
    now: () => new Date("2026-07-19T10:30:00.000Z"),
  });
}

function source(
  overrides: Partial<BoardDraftSource> = {},
): BoardDraftSource {
  return {
    connectionId: CONNECTION_ID,
    providerPageId: PAGE_ID,
    sourceLastEditedAt: "2026-07-19T10:00:00.000Z",
    title: "테스트 문서",
    ...overrides,
  };
}

describe("BoardRepository", () => {
  it("uses independent GitHub numeric ID namespaces", async () => {
    const first = repository(OWNER_A);
    const second = repository(OWNER_B);
    await first.addDraft(source({ title: "사용자 A 문서" }));
    await second.addDraft(source({ title: "사용자 B 문서" }));

    await expect(first.list()).resolves.toMatchObject([
      { ownerGitHubUserId: OWNER_A, title: "사용자 A 문서" },
    ]);
    await expect(second.list()).resolves.toMatchObject([
      { ownerGitHubUserId: OWNER_B, title: "사용자 B 문서" },
    ]);
    expect(boardDatabaseName(OWNER_A)).not.toBe(boardDatabaseName(OWNER_B));

    first.close();
    second.close();
  });

  it("creates draft positions deterministically and restores them after reopen", async () => {
    const databaseName = uniqueDatabaseName(OWNER_A);
    const first = repository(OWNER_A, databaseName);
    await first.addDraft(source());
    await first.addDraft(
      source({
        providerPageId: "019c75c2-3ce6-7988-a2bc-0a56ba576bc3",
        title: "두 번째 문서",
      }),
    );
    first.close();

    const reopened = repository(OWNER_A, databaseName);
    const records = await reopened.listByColumn("stored");

    expect(records.map(({ position, title }) => ({ position, title }))).toEqual([
      { position: 0, title: "테스트 문서" },
      { position: 1, title: "두 번째 문서" },
    ]);
    reopened.close();
  });

  it("rejects credentials and unknown fields before writing", async () => {
    const board = repository(OWNER_A);
    const unsafe = {
      ...source(),
      accessToken: "must-never-be-persisted",
    } as unknown as BoardDraftSource;

    await expect(board.addDraft(unsafe)).rejects.toThrow();
    await expect(board.list()).resolves.toEqual([]);
    board.close();
  });

  it("migrates version 1 and purges malformed or foreign-owner records", async () => {
    const databaseName = uniqueDatabaseName(OWNER_A);
    databases.add(databaseName);
    const legacy = new Dexie(databaseName, DEXIE_OPTIONS);
    legacy.version(1).stores({
      boardRecords:
        "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId",
    });
    const valid = boardRecord({
      ownerGitHubUserId: OWNER_A,
      title: "유효한 기존 문서",
    });
    const version1Valid = {
      ...valid,
      column: "draft",
    } as Record<string, unknown>;
    delete version1Valid.pageRoleOverride;
    await legacy.table("boardRecords").bulkPut([
      version1Valid,
      {
        ...boardRecord({
          providerPageId: "019c75c2-3ce6-7988-a2bc-0a56ba576bc3",
        }),
        accessToken: "legacy-leaked-token",
      },
      boardRecord({
        ownerGitHubUserId: OWNER_B,
        providerPageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    ]);
    legacy.close();

    const migrated = repository(OWNER_A, databaseName);

    await expect(migrated.list()).resolves.toEqual([valid]);
    migrated.close();
  });

  it("removes a document only from its current owner repository", async () => {
    const board = repository(OWNER_A);
    await board.addDraft(source());

    await board.remove(CONNECTION_ID, PAGE_ID);

    await expect(board.get(CONNECTION_ID, PAGE_ID)).resolves.toBeNull();
    board.close();
  });

  it("validates every record read from IndexedDB", async () => {
    const databaseName = uniqueDatabaseName(OWNER_A);
    const raw = new Dexie(databaseName, DEXIE_OPTIONS);
    databases.add(databaseName);
    raw.version(2).stores({
      boardRecords:
        "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId, [ownerGitHubUserId+column], updatedAt",
    });
    await raw.table("boardRecords").put({
      ...boardRecord(),
      refreshToken: "tampered-token",
    });
    raw.close();

    const board = repository(OWNER_A, databaseName);

    await expect(board.list()).resolves.toEqual([]);
    board.close();
  });

  it("reorders stored records atomically", async () => {
    const board = repository(OWNER_A);
    await board.addDraft(source({ title: "첫 번째" }));
    const secondPageId = "019c75c2-3ce6-7988-a2bc-0a56ba576bc3";
    await board.addDraft(
      source({ providerPageId: secondPageId, title: "두 번째" }),
    );

    await board.move(CONNECTION_ID, PAGE_ID, "stored", 1);
    expect(
      (await board.listByColumn("stored")).map((record) => record.title),
    ).toEqual(["두 번째", "첫 번째"]);

    board.close();
  });

  it("does not persist transient publishing columns", async () => {
    const board = repository(OWNER_A);
    await board.addDraft(source());

    await expect(
      board.move(
        CONNECTION_ID,
        PAGE_ID,
        "publishing",
        0,
        "publisher",
      ),
    ).rejects.toThrow();
    await expect(board.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      column: "stored",
      position: 0,
    });
    board.close();
  });

  it("automatically syncs discovered pages while preserving visibility", async () => {
    const board = repository(OWNER_A);
    await board.syncDrafts([
      { ...source({ title: "첫 번째" }), isVisibleByDefault: true },
      {
        ...source({
          providerPageId: "019c75c2-3ce6-7988-a2bc-0a56ba576bc3",
          title: "두 번째",
        }),
        isVisibleByDefault: false,
      },
    ]);
    await board.setVisibility(CONNECTION_ID, PAGE_ID, false);

    const records = await board.syncDrafts([
      {
        ...source({
          sourceLastEditedAt: "2026-07-19T11:00:00.000Z",
          title: "수정된 첫 번째",
        }),
        isVisibleByDefault: true,
      },
    ]);

    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          column: "stored",
          isVisible: false,
          providerPageId: PAGE_ID,
          sourceLastEditedAt: "2026-07-19T11:00:00.000Z",
          title: "수정된 첫 번째",
        }),
        expect.objectContaining({
          column: "stored",
          isVisible: false,
          title: "두 번째",
        }),
      ]),
    );
    board.close();
  });

  it("persists per-page kanban visibility without deleting the record", async () => {
    const board = repository(OWNER_A);
    await board.addDraft(source());
    await board.setVisibility(CONNECTION_ID, PAGE_ID, false);
    await expect(board.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      isVisible: false,
      visibilityOverride: "hidden",
    });
    await board.setVisibility(CONNECTION_ID, PAGE_ID, true);
    await expect(board.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      isVisible: true,
      visibilityOverride: "shown",
    });
    board.close();
  });

  it("keeps an explicitly shown child visible across default visibility sync", async () => {
    const board = repository(OWNER_A);
    await board.syncDrafts([
      { ...source(), isVisibleByDefault: false },
    ]);
    await expect(board.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      isVisible: false,
      visibilityOverride: null,
    });

    await board.setVisibility(CONNECTION_ID, PAGE_ID, true);
    await board.syncDrafts([
      { ...source(), isVisibleByDefault: false },
    ]);

    await expect(board.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      isVisible: true,
      visibilityOverride: "shown",
    });
    board.close();
  });

  it("treats a container as navigation-only and restores its document state", async () => {
    const board = repository(OWNER_A);
    await board.addDraft(source());

    await board.setPageRole(
      CONNECTION_ID,
      PAGE_ID,
      "container",
      true,
    );
    await board.syncDrafts([
      { ...source(), isVisibleByDefault: true },
    ]);
    await expect(board.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      column: "stored",
      isVisible: false,
      pageRole: "container",
      pageRoleOverride: "container",
      position: 0,
      visibilityOverride: "shown",
    });
    await expect(
      board.setVisibility(CONNECTION_ID, PAGE_ID, true),
    ).rejects.toThrow("cannot be shown");
    await expect(
      board.move(CONNECTION_ID, PAGE_ID, "stored", 0),
    ).rejects.toThrow("cannot move");

    await board.setPageRole(
      CONNECTION_ID,
      PAGE_ID,
      "document",
      true,
    );
    await expect(board.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      column: "stored",
      isVisible: true,
      pageRole: "document",
      pageRoleOverride: "document",
      position: 0,
      visibilityOverride: "shown",
    });
    board.close();
  });

  it("applies the inspected role automatically and supports advanced overrides", async () => {
    const board = repository(OWNER_A);
    await board.syncDrafts([
      { ...source(), isVisibleByDefault: true },
    ]);

    await board.setStructureInspection(
      CONNECTION_ID,
      PAGE_ID,
      "2026-07-19T10:00:00.000Z",
      true,
      true,
    );
    await expect(board.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      isVisible: false,
      pageRole: "container",
      pageRoleOverride: null,
    });

    await board.setPageRole(CONNECTION_ID, PAGE_ID, "document", true);
    await expect(board.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      isVisible: true,
      pageRole: "document",
      pageRoleOverride: "document",
    });

    await board.setPageRole(CONNECTION_ID, PAGE_ID, null, true);
    await expect(board.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      isVisible: false,
      pageRole: "container",
      pageRoleOverride: null,
    });

    await board.setStructureInspection(
      CONNECTION_ID,
      PAGE_ID,
      "2026-07-19T10:00:00.000Z",
      false,
      true,
    );
    await expect(board.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      isVisible: true,
      pageRole: "document",
      pageRoleOverride: null,
    });
    board.close();
  });

  it("caches structure inspection and invalidates it when Notion changes", async () => {
    const board = repository(OWNER_A);
    await board.syncDrafts([
      { ...source(), isVisibleByDefault: true },
    ]);
    await board.setStructureInspection(
      CONNECTION_ID,
      PAGE_ID,
      "2026-07-19T10:00:00.000Z",
      true,
    );
    await expect(board.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      hasNavigableChildren: true,
      structureSourceLastEditedAt: "2026-07-19T10:00:00.000Z",
    });

    await board.syncDrafts([
      {
        ...source({
          sourceLastEditedAt: "2026-07-19T11:00:00.000Z",
        }),
        isVisibleByDefault: true,
      },
    ]);
    await expect(board.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      hasNavigableChildren: null,
      structureSourceLastEditedAt: null,
    });
    board.close();
  });

  it("does not cache a stale structure inspection response", async () => {
    const board = repository(OWNER_A);
    await board.syncDrafts([
      {
        ...source({
          sourceLastEditedAt: "2026-07-19T11:00:00.000Z",
        }),
        isVisibleByDefault: true,
      },
    ]);
    await board.setStructureInspection(
      CONNECTION_ID,
      PAGE_ID,
      "2026-07-19T10:00:00.000Z",
      true,
    );

    await expect(board.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      hasNavigableChildren: null,
      structureSourceLastEditedAt: null,
    });
    board.close();
  });

  it("migrates version 3 visibility and removes the obsolete publish target store", async () => {
    const databaseName = uniqueDatabaseName(OWNER_A);
    databases.add(databaseName);
    const legacy = new Dexie(databaseName, DEXIE_OPTIONS);
    legacy.version(3).stores({
      boardRecords:
        "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId, [ownerGitHubUserId+column], updatedAt",
      publishTargets: "ownerGitHubUserId, updatedAt",
    });
    const legacyRecord = {
      ...boardRecord(),
      column: "draft",
    } as Record<string, unknown>;
    delete legacyRecord.hasNavigableChildren;
    delete legacyRecord.isVisible;
    delete legacyRecord.pageRole;
    delete legacyRecord.pageRoleOverride;
    delete legacyRecord.structureSourceLastEditedAt;
    delete legacyRecord.visibilityOverride;
    await legacy.table("boardRecords").put(legacyRecord);
    await legacy.table("publishTargets").put({
      branch: "main",
      installationId: "987654",
      ownerGitHubUserId: OWNER_A,
      providerRepositoryId: "1234567",
      repositoryFullName: "octocat/notion-blog",
      updatedAt: "2026-07-19T10:10:00.000Z",
    });
    legacy.close();

    const migrated = repository(OWNER_A, databaseName);
    await expect(migrated.list()).resolves.toMatchObject([
      { isVisible: true, providerPageId: PAGE_ID },
    ]);
    const tableNames = (await migratedDatabaseTables(databaseName)).sort();
    expect(tableNames).toEqual(["boardRecords"]);
    migrated.close();
  });

  it("re-evaluates version 4 auto visibility but preserves an explicit hidden choice", async () => {
    const databaseName = uniqueDatabaseName(OWNER_A);
    databases.add(databaseName);
    const legacy = new Dexie(databaseName, DEXIE_OPTIONS);
    legacy.version(4).stores({
      boardRecords:
        "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId, [ownerGitHubUserId+column], updatedAt",
    });
    const autoVisible = {
      ...boardRecord(),
      column: "draft",
    } as Record<string, unknown>;
    delete autoVisible.hasNavigableChildren;
    delete autoVisible.pageRole;
    delete autoVisible.pageRoleOverride;
    delete autoVisible.structureSourceLastEditedAt;
    delete autoVisible.visibilityOverride;
    const hiddenPageId = "019c75c2-3ce6-7988-a2bc-0a56ba576bc3";
    const explicitlyHidden = {
      ...boardRecord({
        isVisible: false,
        providerPageId: hiddenPageId,
      }),
      column: "draft",
    } as Record<string, unknown>;
    delete explicitlyHidden.hasNavigableChildren;
    delete explicitlyHidden.pageRole;
    delete explicitlyHidden.pageRoleOverride;
    delete explicitlyHidden.structureSourceLastEditedAt;
    delete explicitlyHidden.visibilityOverride;
    await legacy
      .table("boardRecords")
      .bulkPut([autoVisible, explicitlyHidden]);
    legacy.close();

    const migrated = repository(OWNER_A, databaseName);
    await migrated.syncDrafts([
      { ...source(), isVisibleByDefault: false },
      {
        ...source({ providerPageId: hiddenPageId }),
        isVisibleByDefault: false,
      },
    ]);

    await expect(migrated.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      isVisible: false,
      visibilityOverride: null,
    });
    await expect(
      migrated.get(CONNECTION_ID, hiddenPageId),
    ).resolves.toMatchObject({
      isVisible: false,
      visibilityOverride: "hidden",
    });
    migrated.close();
  });

  it("migrates version 5 records to the document role", async () => {
    const databaseName = uniqueDatabaseName(OWNER_A);
    databases.add(databaseName);
    const legacy = new Dexie(databaseName, DEXIE_OPTIONS);
    legacy.version(5).stores({
      boardRecords:
        "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId, [ownerGitHubUserId+column], updatedAt",
    });
    const version5Record = {
      ...boardRecord(),
      column: "draft",
    } as Record<string, unknown>;
    delete version5Record.hasNavigableChildren;
    delete version5Record.pageRole;
    delete version5Record.pageRoleOverride;
    delete version5Record.structureSourceLastEditedAt;
    await legacy.table("boardRecords").put(version5Record);
    legacy.close();

    const migrated = repository(OWNER_A, databaseName);
    await expect(migrated.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      isVisible: true,
      pageRole: "document",
    });
    migrated.close();
  });

  it("migrates version 6 records with an unknown structure cache", async () => {
    const databaseName = uniqueDatabaseName(OWNER_A);
    databases.add(databaseName);
    const legacy = new Dexie(databaseName, DEXIE_OPTIONS);
    legacy.version(6).stores({
      boardRecords:
        "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId, [ownerGitHubUserId+column], updatedAt",
    });
    const version6Record = {
      ...boardRecord(),
      column: "draft",
    } as Record<string, unknown>;
    delete version6Record.hasNavigableChildren;
    delete version6Record.pageRoleOverride;
    delete version6Record.structureSourceLastEditedAt;
    await legacy.table("boardRecords").put(version6Record);
    legacy.close();

    const migrated = repository(OWNER_A, databaseName);
    await expect(migrated.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      hasNavigableChildren: null,
      pageRole: "document",
      structureSourceLastEditedAt: null,
    });
    migrated.close();
  });

  it("invalidates version 7 structure cache while preserving user state", async () => {
    const databaseName = uniqueDatabaseName(OWNER_A);
    databases.add(databaseName);
    const legacy = new Dexie(databaseName, DEXIE_OPTIONS);
    legacy.version(7).stores({
      boardRecords:
        "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId, [ownerGitHubUserId+column], updatedAt",
    });
    const version7Record = {
      ...boardRecord({
        hasNavigableChildren: true,
        isVisible: false,
        pageRole: "container",
        structureSourceLastEditedAt:
          "2026-07-19T10:00:00.000Z",
      }),
      column: "review",
    } as Record<string, unknown>;
    delete version7Record.pageRoleOverride;
    await legacy.table("boardRecords").put(version7Record);
    legacy.close();

    const migrated = repository(OWNER_A, databaseName);
    await expect(migrated.get(CONNECTION_ID, PAGE_ID)).resolves.toMatchObject({
      column: "stored",
      hasNavigableChildren: null,
      isVisible: false,
      pageRole: "container",
      pageRoleOverride: "container",
      structureSourceLastEditedAt: null,
    });
    migrated.close();
  });

  it("migrates version 8 containers to an explicit override and documents to automatic", async () => {
    const databaseName = uniqueDatabaseName(OWNER_A);
    databases.add(databaseName);
    const legacy = new Dexie(databaseName, DEXIE_OPTIONS);
    legacy.version(8).stores({
      boardRecords:
        "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId, [ownerGitHubUserId+column], updatedAt",
    });
    const container = {
      ...boardRecord({
        isVisible: false,
        pageRole: "container",
      }),
      column: "ready",
    } as Record<string, unknown>;
    const document = {
      ...boardRecord({
        providerPageId: "019c75c2-3ce6-7988-a2bc-0a56ba576bc3",
      }),
      column: "published",
    } as Record<string, unknown>;
    delete container.pageRoleOverride;
    delete document.pageRoleOverride;
    await legacy.table("boardRecords").bulkPut([container, document]);
    legacy.close();

    const migrated = repository(OWNER_A, databaseName);
    await expect(
      migrated.get(CONNECTION_ID, PAGE_ID),
    ).resolves.toMatchObject({
      pageRole: "container",
      pageRoleOverride: "container",
    });
    await expect(
      migrated.get(
        CONNECTION_ID,
        "019c75c2-3ce6-7988-a2bc-0a56ba576bc3",
      ),
    ).resolves.toMatchObject({
      pageRole: "document",
      pageRoleOverride: null,
    });
    migrated.close();
  });

  it("collapses every version 9 workflow column into stored", async () => {
    const databaseName = uniqueDatabaseName(OWNER_A);
    databases.add(databaseName);
    const legacy = new Dexie(databaseName, DEXIE_OPTIONS);
    legacy.version(9).stores({
      boardRecords:
        "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId, [ownerGitHubUserId+column], updatedAt",
    });
    const columns = [
      "draft",
      "review",
      "ready",
      "publishing",
      "published",
      "failed",
    ] as const;
    await legacy.table("boardRecords").bulkPut(
      columns.map((column, index) => ({
        ...boardRecord({
          providerPageId: `legacy-page-${index}`,
          position: index,
        }),
        column,
      })),
    );
    legacy.close();

    const migrated = repository(OWNER_A, databaseName);
    await expect(migrated.list()).resolves.toMatchObject([
      { column: "stored", providerPageId: "legacy-page-0" },
      { column: "stored", providerPageId: "legacy-page-1" },
      { column: "stored", providerPageId: "legacy-page-2" },
      { column: "stored", providerPageId: "legacy-page-3" },
      { column: "stored", providerPageId: "legacy-page-4" },
      { column: "stored", providerPageId: "legacy-page-5" },
    ]);
    migrated.close();
  });

  it("migrates version 10 records without adding publish tracking fields", async () => {
    const databaseName = uniqueDatabaseName(OWNER_A);
    databases.add(databaseName);
    const legacy = new Dexie(databaseName, DEXIE_OPTIONS);
    legacy.version(10).stores({
      boardRecords:
        "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId, [ownerGitHubUserId+column], updatedAt",
    });
    const value = { ...boardRecord() } as Record<string, unknown>;
    delete value.publishCommitSha;
    delete value.publishContentHash;
    delete value.publishedUrl;
    await legacy.table("boardRecords").put(value);
    legacy.close();

    const migrated = repository(OWNER_A, databaseName);
    const record = await migrated.get(CONNECTION_ID, PAGE_ID);
    expect(record).toMatchObject({ column: "stored" });
    expect(record).not.toHaveProperty("publishCommitSha");
    expect(record).not.toHaveProperty("publishContentHash");
    expect(record).not.toHaveProperty("publishedUrl");
    migrated.close();
  });

  it("removes version 11 transient publish state and metadata", async () => {
    const databaseName = uniqueDatabaseName(OWNER_A);
    databases.add(databaseName);
    const legacy = new Dexie(databaseName, DEXIE_OPTIONS);
    legacy.version(11).stores({
      boardRecords:
        "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId, [ownerGitHubUserId+column], updatedAt",
    });
    await legacy.table("boardRecords").put({
      ...boardRecord(),
      column: "published",
      publishCommitSha: "a".repeat(40),
      publishContentHash: "b".repeat(64),
      publishedUrl: "https://octocat.github.io/posts/test/",
    });
    legacy.close();

    const migrated = repository(OWNER_A, databaseName);
    const record = await migrated.get(CONNECTION_ID, PAGE_ID);
    expect(record).toMatchObject({ column: "stored" });
    expect(record).not.toHaveProperty("publishCommitSha");
    expect(record).not.toHaveProperty("publishContentHash");
    expect(record).not.toHaveProperty("publishedUrl");
    migrated.close();
  });
});

function boardRecord(
  overrides: Partial<BoardRecord> = {},
): BoardRecord {
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
    sourceLastEditedAt: "2026-07-19T10:00:00.000Z",
    structureSourceLastEditedAt: null,
    title: "기존 문서",
    updatedAt: "2026-07-19T10:10:00.000Z",
    visibilityOverride: null,
    ...overrides,
  });
}

function uniqueDatabaseName(ownerGitHubUserId: string): string {
  return `test.${ownerGitHubUserId}.${crypto.randomUUID()}`;
}

async function migratedDatabaseTables(databaseName: string): Promise<string[]> {
  const database = new Dexie(databaseName, DEXIE_OPTIONS);
  await database.open();
  const names = database.tables.map((table) => table.name);
  database.close();
  return names;
}
