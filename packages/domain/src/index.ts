declare const entityIdBrand: unique symbol;

export type EntityId<Entity extends string> = string & {
  readonly [entityIdBrand]: Entity;
};

export type ContentItemId = EntityId<"ContentItem">;
export type NotionConnectionId = EntityId<"NotionConnection">;
export type UserId = EntityId<"GitHubUser">;

export const BOARD_COLUMNS = [
  "stored",
  "publishing",
  "published",
] as const;

export type BoardColumn = (typeof BOARD_COLUMNS)[number];
export type BoardTransitionInitiator = "publisher" | "user";

const USER_TRANSITIONS: Readonly<
  Record<BoardColumn, readonly BoardColumn[]>
> = {
  published: ["stored"],
  publishing: [],
  stored: [],
};

const PUBLISHER_TRANSITIONS: Readonly<
  Record<BoardColumn, readonly BoardColumn[]>
> = {
  published: [],
  publishing: ["published", "stored"],
  stored: ["publishing"],
};

export class DomainInvariantError extends Error {
  override readonly name = "DomainInvariantError";
}

export function allowedBoardTransitions(
  from: BoardColumn,
  initiator: BoardTransitionInitiator,
): readonly BoardColumn[] {
  return initiator === "user"
    ? USER_TRANSITIONS[from]
    : PUBLISHER_TRANSITIONS[from];
}

export function canTransitionBoardColumn(
  from: BoardColumn,
  to: BoardColumn,
  initiator: BoardTransitionInitiator,
): boolean {
  return from === to || allowedBoardTransitions(from, initiator).includes(to);
}

export function assertBoardTransition(
  from: BoardColumn,
  to: BoardColumn,
  initiator: BoardTransitionInitiator,
): void {
  if (!canTransitionBoardColumn(from, to, initiator)) {
    throw new DomainInvariantError(
      `${initiator} cannot move a board item from ${from} to ${to}`,
    );
  }
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
