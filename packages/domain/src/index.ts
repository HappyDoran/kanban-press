declare const entityIdBrand: unique symbol;

export type EntityId<Entity extends string> = string & {
  readonly [entityIdBrand]: Entity;
};

export type ContentItemId = EntityId<"ContentItem">;
export type GitHubInstallationId = EntityId<"GitHubInstallation">;
export type NotionConnectionId = EntityId<"NotionConnection">;
export type PublishTargetId = EntityId<"PublishTarget">;
export type UserId = EntityId<"GitHubUser">;

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
