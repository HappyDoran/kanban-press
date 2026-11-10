"use client";

// GitHub 사용자별 칸반 저장소(IndexedDB, Dexie). 게시 중·완료 상태는 화면 메모리에만 있고
// 여기에는 보관 중(stored) 카드의 순서·표시 여부·구조 판별 캐시만 남는다(제품 명세 §3).
import Dexie, { type DexieOptions, type Table } from "dexie";
import { z } from "zod";

const SCHEMA_VERSION = 12;
const BOARD_STORE = "boardRecords";

const ownerGitHubUserIdSchema = z.string().regex(/^[1-9]\d{0,19}$/, "GitHub user ID must be numeric");
const providerIdSchema = z.string().trim().min(1).max(255);
const isoDateSchema = z.iso.datetime({ offset: true });

// strict: 알 수 없는 field(예: token)가 섞인 record는 읽을 때 지워진다.
export const boardRecordSchema = z
  .object({
    column: z.literal("stored"),
    connectionId: providerIdSchema,
    /** 탐색 가능한 하위 구조 여부. 아직 판별 전이면 `null`. */
    hasNavigableChildren: z.boolean().nullable(),
    isVisible: z.boolean(),
    ownerGitHubUserId: ownerGitHubUserIdSchema,
    /** 유효 역할. container는 탐색 계층만 만들고 칸반·게시 대상이 아니다. */
    pageRole: z.enum(["container", "document"]),
    /** 이전 버전의 수동 역할 설정. 새 UI에서는 바꾸지 않고 읽기만 한다. */
    pageRoleOverride: z.enum(["container", "document"]).nullable(),
    position: z.number().finite().nonnegative(),
    providerPageId: providerIdSchema,
    sourceLastEditedAt: isoDateSchema,
    /** 구조 판별 결과가 어느 Notion 수정 시각 기준인지. 원문이 바뀌면 `null`로 무효화한다. */
    structureSourceLastEditedAt: isoDateSchema.nullable(),
    title: z.string().trim().min(1).max(2_000),
    updatedAt: isoDateSchema,
    /** 사용자의 명시적 표시 선택. `null`이면 계층 기본값(최상위만 표시)을 따른다. */
    visibilityOverride: z.enum(["hidden", "shown"]).nullable(),
  })
  .strict();

const syncSourceSchema = z
  .object({
    connectionId: providerIdSchema,
    isVisibleByDefault: z.boolean(),
    providerPageId: providerIdSchema,
    sourceLastEditedAt: isoDateSchema,
    title: z.string().trim().min(1).max(2_000),
  })
  .strict();

export type BoardRecord = z.infer<typeof boardRecordSchema>;
export type BoardSyncSource = z.infer<typeof syncSourceSchema>;
type BoardRecordKey = [ownerGitHubUserId: string, connectionId: string, providerPageId: string];

export class BoardRecordError extends Error {
  override readonly name = "BoardRecordError";
}

export interface BoardRepositoryOptions {
  databaseName?: string;
  /** 옮겨 올 옛 DB 이름. 기본값은 이름 변경 전 이름이며, `databaseName`을 직접 주면 기본으로 옮기지 않는다. */
  legacyDatabaseName?: string | null;
  dexie?: DexieOptions;
  now?: () => Date;
}

/** 프로젝트 이름을 바꾸기 전(2026-11-10) DB 이름. 처음 열 때 새 DB로 옮기고 지운다. */
export function legacyBoardDatabaseName(ownerGitHubUserId: string): string {
  return `notion-kanban-blog.board.${ownerGitHubUserIdSchema.parse(ownerGitHubUserId)}`;
}

export function boardDatabaseName(ownerGitHubUserId: string): string {
  return `kanban-press.board.${ownerGitHubUserIdSchema.parse(ownerGitHubUserId)}`;
}

export class BoardRepository {
  readonly #database: BoardDatabase;
  readonly #now: () => Date;
  readonly #owner: string;
  readonly #ready: Promise<void>;

  constructor(ownerGitHubUserId: string, options: BoardRepositoryOptions = {}) {
    this.#owner = ownerGitHubUserIdSchema.parse(ownerGitHubUserId);
    this.#now = options.now ?? (() => new Date());
    this.#database = new BoardDatabase(
      options.databaseName ?? boardDatabaseName(this.#owner),
      options.dexie,
    );
    const legacyName =
      options.legacyDatabaseName === undefined
        ? options.databaseName === undefined
          ? legacyBoardDatabaseName(this.#owner)
          : null
        : options.legacyDatabaseName;
    this.#ready = legacyName === null ? Promise.resolve() : this.#importLegacy(legacyName, options.dexie);
  }

  /** 현재 사용자의 모든 record(숨김 포함)를 칸반 순서로. 형식이 틀린 record는 이때 지운다. */
  async list(): Promise<readonly BoardRecord[]> {
    await this.#ready;
    await this.#purgeInvalidRecords();
    return (await this.#records()).sort(compareRecords);
  }

  async get(connectionId: string, providerPageId: string): Promise<BoardRecord | null> {
    await this.#ready;
    const key = this.#key(connectionId, providerPageId);
    const value = await this.#database.boardRecords.get(key);
    if (value === undefined) {
      return null;
    }
    const parsed = boardRecordSchema.safeParse(value);
    if (!parsed.success || parsed.data.ownerGitHubUserId !== this.#owner) {
      await this.#database.boardRecords.delete(key);
      return null;
    }
    return parsed.data;
  }

  /**
   * Notion에서 발견한 page를 칸반 record로 맞춘다. 새 page는 보관 중 끝에 추가하고,
   * 기존 page는 제목·수정 시각을 갱신하되 사용자의 표시 선택과 순서를 보존한다.
   * 원문이 바뀌었으면 구조 판별 캐시를 무효화한다.
   */
  async syncDrafts(sources: readonly BoardSyncSource[]): Promise<readonly BoardRecord[]> {
    await this.#ready;
    const parsedSources = z.array(syncSourceSchema).max(10_000).parse(sources);
    await this.#purgeInvalidRecords();
    await this.#transaction(async () => {
      const existing = await this.#records();
      const byPage = new Map(existing.map((record) => [pageKey(record), record]));
      let nextPosition = Math.max(-1, ...existing.map((record) => record.position)) + 1;
      const now = this.#now().toISOString();

      await this.#database.boardRecords.bulkPut(
        parsedSources.map(({ isVisibleByDefault, ...source }) => {
          const current = byPage.get(pageKey(source));
          if (current === undefined) {
            return boardRecordSchema.parse({
              ...source,
              column: "stored",
              hasNavigableChildren: null,
              isVisible: isVisibleByDefault,
              ownerGitHubUserId: this.#owner,
              pageRole: "document",
              pageRoleOverride: null,
              position: nextPosition++,
              structureSourceLastEditedAt: null,
              updatedAt: now,
              visibilityOverride: null,
            });
          }
          const sourceChanged = current.sourceLastEditedAt !== source.sourceLastEditedAt;
          return boardRecordSchema.parse({
            ...current,
            ...source,
            hasNavigableChildren: sourceChanged ? null : current.hasNavigableChildren,
            isVisible: current.pageRole === "container" ? false : visibility(current, isVisibleByDefault),
            structureSourceLastEditedAt: sourceChanged ? null : current.structureSourceLastEditedAt,
            updatedAt: now,
          });
        }),
      );
    });
    return this.list();
  }

  /** 보관 중 열 안에서 카드를 `targetIndex` 자리로 옮기고 보이는 카드의 순서를 0부터 다시 매긴다. */
  async move(
    connectionId: string,
    providerPageId: string,
    targetIndex: number,
  ): Promise<readonly BoardRecord[]> {
    await this.#ready;
    const index = z.number().int().nonnegative().parse(targetIndex);
    const key = this.#key(connectionId, providerPageId);
    await this.#purgeInvalidRecords();
    await this.#transaction(async () => {
      const active = await this.#require(key);
      if (active.pageRole === "container") {
        throw new BoardRecordError("Container pages cannot move on the board");
      }
      const ordered = (await this.#records())
        .sort(compareRecords)
        .filter((record) => record.isVisible && pageKey(record) !== pageKey(active));
      ordered.splice(Math.min(index, ordered.length), 0, active);

      const now = this.#now().toISOString();
      await this.#database.boardRecords.bulkPut(
        ordered.map((record, position) =>
          record.position === position ? record : { ...record, position, updatedAt: now },
        ),
      );
    });
    return this.list();
  }

  /** 칸반 표시 여부를 사용자 선택으로 고정한다. 다시 보이게 하면 보관 중 맨 끝에 놓는다. */
  async setVisibility(
    connectionId: string,
    providerPageId: string,
    isVisible: boolean,
  ): Promise<readonly BoardRecord[]> {
    await this.#ready;
    const shown = z.boolean().parse(isVisible);
    await this.#update(this.#key(connectionId, providerPageId), async (current) => {
      if (current.pageRole === "container" && shown) {
        throw new BoardRecordError("Container pages cannot be shown on the board");
      }
      return {
        isVisible: shown,
        position: shown && !current.isVisible ? await this.#nextPosition() : current.position,
        visibilityOverride: shown ? "shown" : "hidden",
      };
    });
    return this.list();
  }

  /**
   * 구조 판별 결과를 저장하고 역할을 정한다. 하위 구조가 있으면 container로 칸반에서 빠진다.
   * 판별하는 동안 Notion 원문이 바뀌었으면(`sourceLastEditedAt` 불일치) 오래된 결과라 버린다.
   */
  async setStructureInspection(
    connectionId: string,
    providerPageId: string,
    sourceLastEditedAt: string,
    hasNavigableChildren: boolean,
    isVisibleByDefault = true,
  ): Promise<readonly BoardRecord[]> {
    await this.#ready;
    const inspectedAt = isoDateSchema.parse(sourceLastEditedAt);
    const hasChildren = z.boolean().parse(hasNavigableChildren);
    const defaultVisibility = z.boolean().parse(isVisibleByDefault);
    await this.#update(this.#key(connectionId, providerPageId), (current) => {
      if (current.sourceLastEditedAt !== inspectedAt) {
        return null;
      }
      const pageRole = current.pageRoleOverride ?? (hasChildren ? "container" : "document");
      return {
        hasNavigableChildren: hasChildren,
        isVisible: pageRole === "container" ? false : visibility(current, defaultVisibility),
        pageRole,
        structureSourceLastEditedAt: inspectedAt,
      };
    });
    return this.list();
  }

  close(): void {
    this.#database.close();
  }

  #key(connectionId: string, providerPageId: string): BoardRecordKey {
    return [this.#owner, providerIdSchema.parse(connectionId), providerIdSchema.parse(providerPageId)];
  }

  #transaction<T>(work: () => Promise<T>): Promise<T> {
    return this.#database.transaction("rw", this.#database.boardRecords, work);
  }

  /** 현재 사용자의 record 중 schema를 통과한 것만. */
  /**
   * 옛 이름 DB가 있으면 record를 새 DB로 옮기고 옛 DB를 지운다. 새 DB에 이미 record가 있으면 옮기지 않는다.
   * v12가 아닌 옛 DB는 v11 이하 정책대로 옮기지 않고 지운다. 실패해도 새 DB는 그대로 쓴다.
   */
  async #importLegacy(legacyName: string, dexieOptions: DexieOptions | undefined): Promise<void> {
    const legacy = new Dexie(legacyName, dexieOptions);
    try {
      await legacy.open();
    } catch {
      return; // 옛 DB가 없다(NoSuchDatabaseError) 또는 열 수 없다.
    }
    try {
      if (legacy.verno === SCHEMA_VERSION && legacy.tables.some((table) => table.name === BOARD_STORE)) {
        const records = await legacy.table(BOARD_STORE).toArray();
        if (records.length > 0 && (await this.#database.boardRecords.count()) === 0) {
          await this.#database.boardRecords.bulkPut(records as BoardRecord[]);
        }
      }
      await legacy.delete(); // 같은 indexedDB 구현으로 지운다(테스트의 fake-indexeddb 포함).
    } catch {
      legacy.close();
    }
  }

  async #records(): Promise<BoardRecord[]> {
    const values = await this.#database.boardRecords
      .where("ownerGitHubUserId")
      .equals(this.#owner)
      .toArray();
    return values.flatMap((value) => {
      const parsed = boardRecordSchema.safeParse(value);
      return parsed.success ? [parsed.data] : [];
    });
  }

  async #require(key: BoardRecordKey): Promise<BoardRecord> {
    const current = boardRecordSchema.safeParse(await this.#database.boardRecords.get(key));
    if (!current.success || current.data.ownerGitHubUserId !== this.#owner) {
      throw new BoardRecordError("Board record was not found");
    }
    return current.data;
  }

  /** record 하나를 읽고 `change`가 돌려준 field만 바꿔 저장한다. `null`이면 저장하지 않는다. */
  async #update(
    key: BoardRecordKey,
    change: (current: BoardRecord) => Partial<BoardRecord> | null | Promise<Partial<BoardRecord> | null>,
  ): Promise<void> {
    await this.#transaction(async () => {
      const current = await this.#require(key);
      const changed = await change(current);
      if (changed !== null) {
        await this.#database.boardRecords.put(
          boardRecordSchema.parse({ ...current, ...changed, updatedAt: this.#now().toISOString() }),
        );
      }
    });
  }

  async #nextPosition(): Promise<number> {
    const positions = (await this.#records())
      .filter((record) => record.isVisible)
      .map((record) => record.position);
    return positions.length === 0 ? 0 : Math.max(...positions) + 1;
  }

  /** 형식이 틀리거나 다른 사용자의 record는 읽기 전에 지운다. */
  async #purgeInvalidRecords(): Promise<void> {
    const owner = this.#owner;
    await this.#transaction(() =>
      this.#database.boardRecords.toCollection().modify((value: unknown, reference) => {
        const parsed = boardRecordSchema.safeParse(value);
        if (!parsed.success || parsed.data.ownerGitHubUserId !== owner) {
          delete (reference as { value?: unknown }).value;
        }
      }),
    );
  }
}

class BoardDatabase extends Dexie {
  boardRecords!: Table<BoardRecord, BoardRecordKey>;

  constructor(databaseName: string, options?: DexieOptions) {
    super(databaseName, options);
    // v11 이하 DB는 옮기지 않고 비운다. 칸반은 다음 Notion 동기화로 다시 채워지고
    // 그때 사용자의 표시·숨김 선택만 사라진다(2026-11-10 결정). 새 DB 생성 시에는 upgrade가 실행되지 않는다.
    this.version(SCHEMA_VERSION)
      .stores({
        [BOARD_STORE]:
          "[ownerGitHubUserId+connectionId+providerPageId], ownerGitHubUserId, [ownerGitHubUserId+column], updatedAt",
      })
      .upgrade((transaction) => transaction.table(BOARD_STORE).clear());
    this.boardRecords = this.table(BOARD_STORE);
  }
}

/** 사용자 선택(`visibilityOverride`)이 있으면 그것, 없으면 계층 기본값. */
function visibility(record: BoardRecord, isVisibleByDefault: boolean): boolean {
  return record.visibilityOverride === null ? isVisibleByDefault : record.visibilityOverride === "shown";
}

function pageKey(record: Pick<BoardRecord, "connectionId" | "providerPageId">): string {
  return `${record.connectionId}:${record.providerPageId}`;
}

function compareRecords(left: BoardRecord, right: BoardRecord): number {
  return (
    left.position - right.position ||
    left.updatedAt.localeCompare(right.updatedAt) ||
    left.providerPageId.localeCompare(right.providerPageId)
  );
}
