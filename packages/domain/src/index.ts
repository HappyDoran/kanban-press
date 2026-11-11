// provider·UI와 무관한 식별자와 칸반 열. 칸반 이동 규칙은 쓰는 곳(apps/web/app/board-drop.ts)이 가진다.
declare const entityIdBrand: unique symbol;

/** 문자열이지만 다른 종류의 ID와 섞어 쓰면 타입 오류가 나는 ID. */
export type EntityId<Entity extends string> = string & {
  readonly [entityIdBrand]: Entity;
};

export type ContentItemId = EntityId<"ContentItem">;
export type NotionConnectionId = EntityId<"NotionConnection">;
export type UserId = EntityId<"GitHubUser">;

/** 칸반 열. 저장하지 않고 Notion 목록·블로그 저장소·화면의 게시 상태로 정한다. */
export const BOARD_COLUMNS = ["stored", "publishing", "published"] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export class DomainInvariantError extends Error {
  override readonly name = "DomainInvariantError";
}

export function entityId<Entity extends string>(
  entity: Entity,
  value: string,
): EntityId<Entity> {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new DomainInvariantError(`${entity} ID must not be empty`);
  }
  return normalized as EntityId<Entity>;
}
