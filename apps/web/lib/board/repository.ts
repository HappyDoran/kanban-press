"use client";

import {
  assertBoardTransition,
  DomainInvariantError,
} from "@notion-kanban-blog/domain";
import Dexie from "dexie";
import { z } from "zod";

import type {
  BoardColumn,
  BoardTransitionInitiator,
} from "@notion-kanban-blog/domain";
import type { DexieOptions, Table } from "dexie";

const DATABASE_PREFIX = "notion-kanban-blog.board";
const CURRENT_SCHEMA_VERSION = 12;
const BOARD_STORE = "boardRecords";
const LEGACY_BOARD_COLUMNS = [
  "draft",
  "review",
  "ready",
  "publishing",
  "published",
  "failed",
] as const;

const ownerGitHubUserIdSchema = z
  .string()
  .regex(/^[1-9]\d{0,19}$/, "GitHub user ID must be numeric");
const providerIdSchema = z.string().trim().min(1).max(255);
const isoDateSchema = z.iso.datetime({ offset: true });
const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:");
const version11BoardRecordSchema = z
  .object({
    column: z.enum(["stored", "publishing", "published"]),
    connectionId: providerIdSchema,
    hasNavigableChildren: z.boolean().nullable(),
    isVisible: z.boolean(),
    ownerGitHubUserId: ownerGitHubUserIdSchema,
    pageRole: z.enum(["container", "document"]),
    pageRoleOverride: z.enum(["container", "document"]).nullable(),
    position: z.number().finite().nonnegative(),
    publishCommitSha: z
      .string()
      .regex(/^[a-f0-9]{40,64}$/)
      .nullable()
      .default(null),
    publishContentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .default(null),
    publishedUrl: httpsUrlSchema.nullable().default(null),
    providerPageId: providerIdSchema,
    sourceLastEditedAt: isoDateSchema,
    structureSourceLastEditedAt: isoDateSchema.nullable(),
    title: z.string().trim().min(1).max(2_000),
    updatedAt: isoDateSchema,
    visibilityOverride: z.enum(["hidden", "shown"]).nullable(),
  })
  .strict();
export const boardRecordSchema = version11BoardRecordSchema
  .omit({
    publishCommitSha: true,
    publishContentHash: true,
    publishedUrl: true,
  })
  .extend({
    column: z.literal("stored"),
  });
const version10BoardRecordSchema = version11BoardRecordSchema.extend({
  publishCommitSha: z
    .string()
    .regex(/^[a-f0-9]{40,64}$/)
    .nullable()
    .optional(),
  publishContentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable()
    .optional(),
  publishedUrl: httpsUrlSchema.nullable().optional(),
});
const version9BoardRecordSchema = version10BoardRecordSchema.extend({
  column: z.enum(LEGACY_BOARD_COLUMNS),
});
const version8BoardRecordSchema = version9BoardRecordSchema.omit({
  pageRoleOverride: true,
});
const version6BoardRecordSchema = version8BoardRecordSchema.omit({
  hasNavigableChildren: true,
  structureSourceLastEditedAt: true,
});
const version5BoardRecordSchema = version6BoardRecordSchema.omit({
  pageRole: true,
});
const version4BoardRecordSchema = version5BoardRecordSchema.omit({
  visibilityOverride: true,
});
const legacyBoardRecordSchema = version4BoardRecordSchema.omit({
  isVisible: true,
});

const draftSourceSchema = z
  .object({
    connectionId: providerIdSchema,
    providerPageId: providerIdSchema,
    sourceLastEditedAt: isoDateSchema,
    title: z.string().trim().min(1).max(2_000),
  })
  .strict();
const syncDraftSourceSchema = draftSourceSchema
  .extend({
    isVisibleByDefault: z.boolean(),
  })
  .strict();

export type BoardRecord = z.infer<typeof boardRecordSchema>;
export type BoardDraftSource = z.infer<typeof draftSourceSchema>;
export type BoardSyncSource = z.infer<typeof syncDraftSourceSchema>;
export type BoardRecordKey = [
  ownerGitHubUserId: string,
  connectionId: string,
  providerPageId: string,
];

export interface BoardRepositoryOptions {
  databaseName?: string;
  dexie?: DexieOptions;
  now?: () => Date;
}

export class BoardRepository {
  readonly #database: BoardDatabase;
  readonly #now: () => Date;
  readonly #ownerGitHubUserId: string;

  constructor(
    ownerGitHubUserId: string,
    options: BoardRepositoryOptions = {},
  ) {
    this.#ownerGitHubUserId =
      ownerGitHubUserIdSchema.parse(ownerGitHubUserId);
    this.#now = options.now ?? (() => new Date());
    this.#database = new BoardDatabase(
      options.databaseName ?? boardDatabaseName(this.#ownerGitHubUserId),
      this.#ownerGitHubUserId,
      options.dexie,
    );
  }

  async addDraft(source: BoardDraftSource): Promise<BoardRecord> {
    const parsedSource = draftSourceSchema.parse(source);
    return this.#database.transaction(
      "rw",
      this.#database.boardRecords,
      async () => {
        const key = recordKey(this.#ownerGitHubUserId, parsedSource);
        const existing = await this.#database.boardRecords.get(key);
        const validatedExisting =
          existing === undefined
            ? null
            : boardRecordSchema.safeParse(existing);
        if (existing !== undefined && !validatedExisting?.success) {
          await this.#database.boardRecords.delete(key);
        }

        const record = boardRecordSchema.parse({
          ...parsedSource,
          column: "stored",
          hasNavigableChildren: validatedExisting?.success
            ? validatedExisting.data.hasNavigableChildren
            : null,
          isVisible: validatedExisting?.success
            ? validatedExisting.data.isVisible
            : true,
          ownerGitHubUserId: this.#ownerGitHubUserId,
          pageRole: validatedExisting?.success
            ? validatedExisting.data.pageRole
            : "document",
          pageRoleOverride: validatedExisting?.success
            ? validatedExisting.data.pageRoleOverride
            : null,
          position: validatedExisting?.success
            ? validatedExisting.data.position
            : await this.#nextStoredPosition(),
          structureSourceLastEditedAt: validatedExisting?.success
            ? validatedExisting.data.structureSourceLastEditedAt
            : null,
          updatedAt: this.#now().toISOString(),
          visibilityOverride: validatedExisting?.success
            ? validatedExisting.data.visibilityOverride
            : "shown",
        });
        await this.#database.boardRecords.put(record);
        return record;
      },
    );
  }

  async syncDrafts(
    sources: readonly BoardSyncSource[],
  ): Promise<readonly BoardRecord[]> {
    const parsedSources = z
      .array(syncDraftSourceSchema)
      .max(10_000)
      .parse(sources);
    await this.#purgeInvalidRecords();
    await this.#database.transaction(
      "rw",
      this.#database.boardRecords,
      async () => {
        const existingValues = await this.#database.boardRecords
          .where("ownerGitHubUserId")
          .equals(this.#ownerGitHubUserId)
          .toArray();
        const existing = new Map(
          existingValues.map((value) => {
            const record = boardRecordSchema.parse(value);
            return [
              boardPageKey(record.connectionId, record.providerPageId),
              record,
            ];
          }),
        );
        let nextStoredPosition =
          Math.max(
            -1,
            ...existingValues
              .map((value) => boardRecordSchema.parse(value))
              .filter((record) => record.column === "stored")
              .map((record) => record.position),
          ) + 1;
        const now = this.#now().toISOString();
        const updates = parsedSources.map((source) => {
          const { isVisibleByDefault, ...pageSource } = source;
          const current = existing.get(
            boardPageKey(source.connectionId, source.providerPageId),
          );
          if (current !== undefined) {
            const sourceChanged =
              current.sourceLastEditedAt !== pageSource.sourceLastEditedAt;
            return boardRecordSchema.parse({
              ...current,
              ...pageSource,
              column: "stored",
              hasNavigableChildren: sourceChanged
                ? null
                : current.hasNavigableChildren,
              isVisible:
                current.pageRole === "container"
                  ? false
                  : current.visibilityOverride === "shown"
                    ? true
                    : current.visibilityOverride === "hidden"
                      ? false
                      : isVisibleByDefault,
              structureSourceLastEditedAt: sourceChanged
                ? null
                : current.structureSourceLastEditedAt,
              updatedAt: now,
            });
          }
          return boardRecordSchema.parse({
            ...pageSource,
            column: "stored",
            hasNavigableChildren: null,
            isVisible: isVisibleByDefault,
            ownerGitHubUserId: this.#ownerGitHubUserId,
            pageRole: "document",
            pageRoleOverride: null,
            position: nextStoredPosition++,
            structureSourceLastEditedAt: null,
            updatedAt: now,
            visibilityOverride: null,
          });
        });
        await this.#database.boardRecords.bulkPut(updates);
      },
    );
    return this.list();
  }

  async get(
    connectionId: string,
    providerPageId: string,
  ): Promise<BoardRecord | null> {
    const key = recordKey(this.#ownerGitHubUserId, {
      connectionId: providerIdSchema.parse(connectionId),
      providerPageId: providerIdSchema.parse(providerPageId),
    });
    const value = await this.#database.boardRecords.get(key);
    if (value === undefined) {
      return null;
    }
    const parsed = boardRecordSchema.safeParse(value);
    if (
      !parsed.success ||
      parsed.data.ownerGitHubUserId !== this.#ownerGitHubUserId
    ) {
      await this.#database.boardRecords.delete(key);
      return null;
    }
    return parsed.data;
  }

  async list(): Promise<readonly BoardRecord[]> {
    await this.#purgeInvalidRecords();
    const values = await this.#database.boardRecords
      .where("ownerGitHubUserId")
      .equals(this.#ownerGitHubUserId)
      .toArray();
    return values
      .map((value) => boardRecordSchema.parse(value))
      .sort(compareBoardRecords);
  }

  async listByColumn(column: BoardColumn): Promise<readonly BoardRecord[]> {
    const parsedColumn = z.literal("stored").parse(column);
    await this.#purgeInvalidRecords();
    const values = await this.#database.boardRecords
      .where("[ownerGitHubUserId+column]")
      .equals([this.#ownerGitHubUserId, parsedColumn])
      .toArray();
    return values
      .map((value) => boardRecordSchema.parse(value))
      .sort(compareBoardRecords);
  }

  async move(
    connectionId: string,
    providerPageId: string,
    targetColumn: BoardColumn,
    targetIndex: number,
    initiator: BoardTransitionInitiator = "user",
  ): Promise<readonly BoardRecord[]> {
    const parsedConnectionId = providerIdSchema.parse(connectionId);
    const parsedProviderPageId = providerIdSchema.parse(providerPageId);
    const parsedColumn = z.literal("stored").parse(targetColumn);
    const parsedTargetIndex = z.number().int().nonnegative().parse(targetIndex);
    const parsedInitiator = z
      .enum(["publisher", "user"])
      .parse(initiator);
    await this.#purgeInvalidRecords();

    await this.#database.transaction(
      "rw",
      this.#database.boardRecords,
      async () => {
        const activeKey = recordKey(this.#ownerGitHubUserId, {
          connectionId: parsedConnectionId,
          providerPageId: parsedProviderPageId,
        });
        const activeValue =
          await this.#database.boardRecords.get(activeKey);
        const active = boardRecordSchema.safeParse(activeValue);
        if (
          !active.success ||
          active.data.ownerGitHubUserId !== this.#ownerGitHubUserId
        ) {
          throw new DomainInvariantError("Board record was not found");
        }
        if (active.data.pageRole === "container") {
          throw new DomainInvariantError(
            "Container pages cannot move on the board",
          );
        }
        assertBoardTransition(
          active.data.column,
          parsedColumn,
          parsedInitiator,
        );

        const allRecords = (
          await this.#database.boardRecords
            .where("ownerGitHubUserId")
            .equals(this.#ownerGitHubUserId)
            .toArray()
        )
          .map((value) => boardRecordSchema.parse(value))
          .sort(compareBoardRecords);
        const withoutActive = allRecords.filter(
          (record) =>
            record.isVisible && !sameRecord(record, active.data),
        );
        const sourceRecords: BoardRecord[] = [];
        const targetRecords = withoutActive.filter(
          (record) => record.column === parsedColumn,
        );
        targetRecords.splice(
          Math.min(parsedTargetIndex, targetRecords.length),
          0,
          active.data,
        );

        const now = this.#now().toISOString();
        const updates = [
          ...reindexColumn(sourceRecords, active.data.column, now),
          ...reindexColumn(targetRecords, parsedColumn, now),
        ];
        await this.#database.boardRecords.bulkPut(updates);
      },
    );

    return this.list();
  }

  async remove(connectionId: string, providerPageId: string): Promise<void> {
    await this.#database.boardRecords.delete(
      recordKey(this.#ownerGitHubUserId, {
        connectionId: providerIdSchema.parse(connectionId),
        providerPageId: providerIdSchema.parse(providerPageId),
      }),
    );
  }

  async setVisibility(
    connectionId: string,
    providerPageId: string,
    isVisible: boolean,
  ): Promise<readonly BoardRecord[]> {
    const key = recordKey(this.#ownerGitHubUserId, {
      connectionId: providerIdSchema.parse(connectionId),
      providerPageId: providerIdSchema.parse(providerPageId),
    });
    const parsedVisibility = z.boolean().parse(isVisible);
    await this.#database.transaction(
      "rw",
      this.#database.boardRecords,
      async () => {
        const current = boardRecordSchema.safeParse(
          await this.#database.boardRecords.get(key),
        );
        if (
          !current.success ||
          current.data.ownerGitHubUserId !== this.#ownerGitHubUserId
        ) {
          throw new DomainInvariantError("Board record was not found");
        }
        if (
          current.data.pageRole === "container" &&
          parsedVisibility
        ) {
          throw new DomainInvariantError(
            "Container pages cannot be shown on the board",
          );
        }
        await this.#database.boardRecords.put(
          boardRecordSchema.parse({
            ...current.data,
            isVisible: parsedVisibility,
            position:
              parsedVisibility && !current.data.isVisible
                ? await this.#nextColumnPosition(current.data.column)
                : current.data.position,
            updatedAt: this.#now().toISOString(),
            visibilityOverride: parsedVisibility ? "shown" : "hidden",
          }),
        );
      },
    );
    return this.list();
  }

  async setPageRole(
    connectionId: string,
    providerPageId: string,
    pageRoleOverride: "container" | "document" | null,
    isVisibleByDefault: boolean,
  ): Promise<readonly BoardRecord[]> {
    const key = recordKey(this.#ownerGitHubUserId, {
      connectionId: providerIdSchema.parse(connectionId),
      providerPageId: providerIdSchema.parse(providerPageId),
    });
    const parsedOverride = z
      .enum(["container", "document"])
      .nullable()
      .parse(pageRoleOverride);
    const parsedDefaultVisibility = z
      .boolean()
      .parse(isVisibleByDefault);
    await this.#database.transaction(
      "rw",
      this.#database.boardRecords,
      async () => {
        const current = boardRecordSchema.safeParse(
          await this.#database.boardRecords.get(key),
        );
        if (
          !current.success ||
          current.data.ownerGitHubUserId !== this.#ownerGitHubUserId
        ) {
          throw new DomainInvariantError("Board record was not found");
        }
        const restoredVisibility =
          current.data.visibilityOverride === "shown"
            ? true
            : current.data.visibilityOverride === "hidden"
              ? false
              : parsedDefaultVisibility;
        const pageRole =
          parsedOverride ??
          (current.data.hasNavigableChildren === true
            ? "container"
            : "document");
        await this.#database.boardRecords.put(
          boardRecordSchema.parse({
            ...current.data,
            isVisible:
              pageRole === "container" ? false : restoredVisibility,
            pageRole,
            pageRoleOverride: parsedOverride,
            updatedAt: this.#now().toISOString(),
          }),
        );
      },
    );
    return this.list();
  }

  async setStructureInspection(
    connectionId: string,
    providerPageId: string,
    sourceLastEditedAt: string,
    hasNavigableChildren: boolean,
    isVisibleByDefault = true,
  ): Promise<readonly BoardRecord[]> {
    const key = recordKey(this.#ownerGitHubUserId, {
      connectionId: providerIdSchema.parse(connectionId),
      providerPageId: providerIdSchema.parse(providerPageId),
    });
    const parsedSourceLastEditedAt =
      isoDateSchema.parse(sourceLastEditedAt);
    const parsedHasNavigableChildren = z
      .boolean()
      .parse(hasNavigableChildren);
    const parsedDefaultVisibility = z
      .boolean()
      .parse(isVisibleByDefault);
    await this.#database.transaction(
      "rw",
      this.#database.boardRecords,
      async () => {
        const current = boardRecordSchema.safeParse(
          await this.#database.boardRecords.get(key),
        );
        if (
          !current.success ||
          current.data.ownerGitHubUserId !== this.#ownerGitHubUserId
        ) {
          throw new DomainInvariantError("Board record was not found");
        }
        if (
          current.data.sourceLastEditedAt !==
          parsedSourceLastEditedAt
        ) {
          return;
        }
        const pageRole =
          current.data.pageRoleOverride ??
          (parsedHasNavigableChildren ? "container" : "document");
        const restoredVisibility =
          current.data.visibilityOverride === "shown"
            ? true
            : current.data.visibilityOverride === "hidden"
              ? false
              : parsedDefaultVisibility;
        await this.#database.boardRecords.put(
          boardRecordSchema.parse({
            ...current.data,
            hasNavigableChildren: parsedHasNavigableChildren,
            isVisible:
              pageRole === "container" ? false : restoredVisibility,
            pageRole,
            structureSourceLastEditedAt:
              parsedSourceLastEditedAt,
            updatedAt: this.#now().toISOString(),
          }),
        );
      },
    );
    return this.list();
  }

  close(): void {
    this.#database.close();
  }

  async deleteDatabase(): Promise<void> {
    await this.#database.delete();
  }

  async #nextStoredPosition(): Promise<number> {
    return this.#nextColumnPosition("stored");
  }

  async #nextColumnPosition(column: "stored"): Promise<number> {
    const records = await this.#database.boardRecords
      .where("[ownerGitHubUserId+column]")
      .equals([this.#ownerGitHubUserId, column])
      .toArray();
    const positions = records.flatMap((value) => {
      const parsed = boardRecordSchema.safeParse(value);
      return parsed.success && parsed.data.isVisible
        ? [parsed.data.position]
        : [];
    });
    return positions.length === 0 ? 0 : Math.max(...positions) + 1;
  }

  async #purgeInvalidRecords(): Promise<void> {
    const ownerGitHubUserId = this.#ownerGitHubUserId;
    await this.#database.transaction(
      "rw",
      this.#database.boardRecords,
      () =>
        this.#database.boardRecords
          .toCollection()
          .modify((value: unknown, reference) => {
            const parsed = boardRecordSchema.safeParse(value);
            if (
              !parsed.success ||
              parsed.data.ownerGitHubUserId !== ownerGitHubUserId
            ) {
              delete (reference as { value?: unknown }).value;
            }
          }),
    );
  }
}

class BoardDatabase extends Dexie {
  boardRecords!: Table<BoardRecord, BoardRecordKey>;

  constructor(
    databaseName: string,
    ownerGitHubUserId: string,
    options?: DexieOptions,
  ) {
    super(databaseName, options);
    this.version(1).stores({
      [BOARD_STORE]:
        "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId",
    });
    this.version(2)
      .stores({
        [BOARD_STORE]:
          "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId, [ownerGitHubUserId+column], updatedAt",
      })
      .upgrade((transaction) =>
        transaction
          .table(BOARD_STORE)
          .toCollection()
          .modify((value: unknown, reference) => {
            migrateBoardRecord(value, ownerGitHubUserId, reference);
          }),
      );
    this.version(3).stores({
      [BOARD_STORE]:
        "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId, [ownerGitHubUserId+column], updatedAt",
      publishTargets: "ownerGitHubUserId, updatedAt",
    });
    this.version(4)
      .stores({
        [BOARD_STORE]:
          "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId, [ownerGitHubUserId+column], updatedAt",
        publishTargets: null,
      })
      .upgrade((transaction) =>
        transaction
          .table(BOARD_STORE)
          .toCollection()
          .modify((value: unknown, reference) => {
            migrateBoardRecord(value, ownerGitHubUserId, reference);
          }),
      );
    this.version(5)
      .stores({
        [BOARD_STORE]:
          "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId, [ownerGitHubUserId+column], updatedAt",
      })
      .upgrade((transaction) =>
        transaction
          .table(BOARD_STORE)
          .toCollection()
          .modify((value: unknown, reference) => {
            migrateBoardRecord(value, ownerGitHubUserId, reference);
          }),
      );
    this.version(6)
      .stores({
        [BOARD_STORE]:
          "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId, [ownerGitHubUserId+column], updatedAt",
      })
      .upgrade((transaction) =>
        transaction
          .table(BOARD_STORE)
          .toCollection()
          .modify((value: unknown, reference) => {
            migrateBoardRecord(value, ownerGitHubUserId, reference);
          }),
      );
    this.version(7)
      .stores({
        [BOARD_STORE]:
          "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId, [ownerGitHubUserId+column], updatedAt",
      })
      .upgrade((transaction) =>
        transaction
          .table(BOARD_STORE)
          .toCollection()
          .modify((value: unknown, reference) => {
            migrateBoardRecord(value, ownerGitHubUserId, reference);
          }),
      );
    this.version(8)
      .stores({
        [BOARD_STORE]:
          "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId, [ownerGitHubUserId+column], updatedAt",
      })
      .upgrade((transaction) =>
        transaction
          .table(BOARD_STORE)
          .toCollection()
          .modify((value: unknown, reference) => {
            const current = boardRecordSchema.safeParse(value);
            if (
              current.success &&
              current.data.ownerGitHubUserId === ownerGitHubUserId
            ) {
              return;
            }
            const version9 = version9BoardRecordSchema.safeParse(value);
            const parsed = version8BoardRecordSchema.safeParse(value);
            const migrated =
              version9.success
                ? toVersion8BoardRecord(version9.data)
                : parsed.success
                  ? parsed.data
                  : null;
            if (
              migrated === null ||
              migrated.ownerGitHubUserId !== ownerGitHubUserId
            ) {
              delete reference.value;
              return;
            }
            reference.value = {
              ...migrated,
              hasNavigableChildren: null,
              structureSourceLastEditedAt: null,
            };
          }),
      );
    this.version(9)
      .stores({
        [BOARD_STORE]:
          "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId, [ownerGitHubUserId+column], updatedAt",
      })
      .upgrade((transaction) =>
        transaction
          .table(BOARD_STORE)
          .toCollection()
          .modify((value: unknown, reference) => {
            const current = boardRecordSchema.safeParse(value);
            const version9 = version9BoardRecordSchema.safeParse(value);
            const parsed = version8BoardRecordSchema.safeParse(value);
            if (
              current.success &&
              current.data.ownerGitHubUserId === ownerGitHubUserId
            ) {
              return;
            }
            if (
              version9.success &&
              version9.data.ownerGitHubUserId === ownerGitHubUserId
            ) {
              return;
            }
            if (
              !parsed.success ||
              parsed.data.ownerGitHubUserId !== ownerGitHubUserId
            ) {
              delete reference.value;
              return;
            }
            reference.value = {
              ...parsed.data,
              pageRoleOverride:
                parsed.data.pageRole === "container"
                  ? "container"
                  : null,
            };
          }),
      );
    this.version(10)
      .stores({
        [BOARD_STORE]:
          "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId, [ownerGitHubUserId+column], updatedAt",
      })
      .upgrade((transaction) =>
        transaction
          .table(BOARD_STORE)
          .toCollection()
          .modify((value: unknown, reference) => {
            const current = version10BoardRecordSchema.safeParse(value);
            if (
              current.success &&
              current.data.ownerGitHubUserId === ownerGitHubUserId
            ) {
              return;
            }
            const legacy = version9BoardRecordSchema.safeParse(value);
            if (
              !legacy.success ||
              legacy.data.ownerGitHubUserId !== ownerGitHubUserId
            ) {
              delete reference.value;
              return;
            }
            reference.value = version10BoardRecordSchema.parse({
              ...legacy.data,
              column: migrateVersion9Column(legacy.data.column),
            });
          }),
      );
    this.version(11)
      .stores({
        [BOARD_STORE]:
          "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId, [ownerGitHubUserId+column], updatedAt",
      })
      .upgrade((transaction) =>
        transaction
          .table(BOARD_STORE)
          .toCollection()
          .modify((value: unknown, reference) => {
            const current = version11BoardRecordSchema.safeParse(value);
            if (
              current.success &&
              current.data.ownerGitHubUserId === ownerGitHubUserId
            ) {
              reference.value = current.data;
              return;
            }
            const previous = version10BoardRecordSchema.safeParse(value);
            if (
              !previous.success ||
              previous.data.ownerGitHubUserId !== ownerGitHubUserId
            ) {
              delete reference.value;
              return;
            }
            reference.value = version11BoardRecordSchema.parse(previous.data);
          }),
      );
    this.version(CURRENT_SCHEMA_VERSION)
      .stores({
        [BOARD_STORE]:
          "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId, [ownerGitHubUserId+column], updatedAt",
      })
      .upgrade((transaction) =>
        transaction
          .table(BOARD_STORE)
          .toCollection()
          .modify((value: unknown, reference) => {
            const current = boardRecordSchema.safeParse(value);
            if (
              current.success &&
              current.data.ownerGitHubUserId === ownerGitHubUserId
            ) {
              reference.value = current.data;
              return;
            }
            const previous = version11BoardRecordSchema.safeParse(value);
            if (
              !previous.success ||
              previous.data.ownerGitHubUserId !== ownerGitHubUserId
            ) {
              delete reference.value;
              return;
            }
            reference.value = toStoredBoardRecord(previous.data);
          }),
      );
    this.boardRecords = this.table(BOARD_STORE);
  }
}

export function boardDatabaseName(ownerGitHubUserId: string): string {
  return `${DATABASE_PREFIX}.${ownerGitHubUserIdSchema.parse(ownerGitHubUserId)}`;
}

function recordKey(
  ownerGitHubUserId: string,
  source: Pick<BoardDraftSource, "connectionId" | "providerPageId">,
): BoardRecordKey {
  return [
    ownerGitHubUserId,
    source.connectionId,
    source.providerPageId,
  ];
}

function compareBoardRecords(left: BoardRecord, right: BoardRecord): number {
  return (
    left.position - right.position ||
    left.updatedAt.localeCompare(right.updatedAt) ||
    left.providerPageId.localeCompare(right.providerPageId)
  );
}

function reindexColumn(
  records: readonly BoardRecord[],
  column: "stored",
  updatedAt: string,
): BoardRecord[] {
  return records.map((record, position) =>
    boardRecordSchema.parse({
      ...record,
      column,
      position,
      updatedAt:
        record.column !== column || record.position !== position
          ? updatedAt
          : record.updatedAt,
    }),
  );
}

function sameRecord(left: BoardRecord, right: BoardRecord): boolean {
  return (
    left.connectionId === right.connectionId &&
    left.providerPageId === right.providerPageId &&
    left.ownerGitHubUserId === right.ownerGitHubUserId
  );
}

function boardPageKey(connectionId: string, providerPageId: string): string {
  return `${connectionId}:${providerPageId}`;
}

function migrateBoardRecord(
  value: unknown,
  ownerGitHubUserId: string,
  reference: { value?: unknown },
): void {
  const current = boardRecordSchema.safeParse(value);
  if (
    current.success &&
    current.data.ownerGitHubUserId === ownerGitHubUserId
  ) {
    return;
  }
  const version9 = version9BoardRecordSchema.safeParse(value);
  if (
    version9.success &&
    version9.data.ownerGitHubUserId === ownerGitHubUserId
  ) {
    return;
  }
  const version8 = version8BoardRecordSchema.safeParse(value);
  const legacy = legacyBoardRecordSchema.safeParse(value);
  const version4 = version4BoardRecordSchema.safeParse(value);
  const version5 = version5BoardRecordSchema.safeParse(value);
  const version6 = version6BoardRecordSchema.safeParse(value);
  if (
    version8.success &&
    version8.data.ownerGitHubUserId === ownerGitHubUserId
  ) {
    reference.value = version9BoardRecordSchema.parse({
      ...version8.data,
      pageRoleOverride:
        version8.data.pageRole === "container" ? "container" : null,
    });
    return;
  }
  if (
    version6.success &&
    version6.data.ownerGitHubUserId === ownerGitHubUserId
  ) {
    reference.value = version9BoardRecordSchema.parse({
      ...version6.data,
      hasNavigableChildren: null,
      pageRoleOverride:
        version6.data.pageRole === "container" ? "container" : null,
      structureSourceLastEditedAt: null,
    });
    return;
  }
  if (
    version5.success &&
    version5.data.ownerGitHubUserId === ownerGitHubUserId
  ) {
    reference.value = version9BoardRecordSchema.parse({
      ...version5.data,
      hasNavigableChildren: null,
      pageRole: "document",
      pageRoleOverride: null,
      structureSourceLastEditedAt: null,
    });
    return;
  }
  if (
    version4.success &&
    version4.data.ownerGitHubUserId === ownerGitHubUserId
  ) {
    reference.value = version9BoardRecordSchema.parse({
      ...version4.data,
      hasNavigableChildren: null,
      pageRole: "document",
      pageRoleOverride: null,
      structureSourceLastEditedAt: null,
      visibilityOverride: version4.data.isVisible ? null : "hidden",
    });
    return;
  }
  if (
    legacy.success &&
    legacy.data.ownerGitHubUserId === ownerGitHubUserId
  ) {
    reference.value = version9BoardRecordSchema.parse({
      ...legacy.data,
      hasNavigableChildren: null,
      isVisible: true,
      pageRole: "document",
      pageRoleOverride: null,
      structureSourceLastEditedAt: null,
      visibilityOverride: null,
    });
    return;
  }
  delete reference.value;
}

function toVersion8BoardRecord(
  record: z.infer<typeof version9BoardRecordSchema>,
): z.infer<typeof version8BoardRecordSchema> {
  const migrated: Record<string, unknown> = { ...record };
  delete migrated.pageRoleOverride;
  return version8BoardRecordSchema.parse(migrated);
}

function migrateVersion9Column(
  column: z.infer<typeof version9BoardRecordSchema>["column"],
): BoardColumn {
  switch (column) {
    case "publishing":
    case "published":
      return column;
    case "draft":
    case "failed":
    case "ready":
    case "review":
      return "stored";
  }
}

function toStoredBoardRecord(
  record: z.infer<typeof version11BoardRecordSchema>,
): BoardRecord {
  const persistent: Record<string, unknown> = { ...record };
  delete persistent.publishCommitSha;
  delete persistent.publishContentHash;
  delete persistent.publishedUrl;
  return boardRecordSchema.parse({
    ...persistent,
    column: "stored",
  });
}
