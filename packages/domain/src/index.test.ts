import { describe, expect, it } from "vitest";

import {
  allowedBoardTransitions,
  assertBoardTransition,
  canTransitionBoardColumn,
  DomainInvariantError,
  entityId,
} from "./index.js";

describe("entityId", () => {
  it("normalizes a non-empty provider ID", () => {
    expect(entityId("GitHubUser", " 123456 ")).toBe("123456");
  });

  it("rejects an empty ID at the domain boundary", () => {
    expect(() => entityId("GitHubUser", "   ")).toThrow(DomainInvariantError);
  });
});

describe("board transitions", () => {
  it("lets users return a published document to storage", () => {
    expect(allowedBoardTransitions("stored", "user")).toEqual([]);
    expect(allowedBoardTransitions("published", "user")).toEqual(["stored"]);
    expect(canTransitionBoardColumn("published", "stored", "user")).toBe(true);
  });

  it("reserves publishing transitions for the publisher", () => {
    expect(canTransitionBoardColumn("stored", "publishing", "user")).toBe(
      false,
    );
    expect(canTransitionBoardColumn("stored", "publishing", "publisher")).toBe(
      true,
    );
    expect(
      canTransitionBoardColumn("publishing", "published", "publisher"),
    ).toBe(true);
    expect(
      canTransitionBoardColumn("publishing", "stored", "publisher"),
    ).toBe(true);
  });

  it("rejects skipped or unauthorized states", () => {
    expect(() =>
      assertBoardTransition("stored", "publishing", "user"),
    ).toThrow(DomainInvariantError);
    expect(() =>
      assertBoardTransition("publishing", "published", "user"),
    ).toThrow(DomainInvariantError);
  });
});
