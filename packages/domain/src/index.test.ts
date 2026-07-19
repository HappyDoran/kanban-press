import { describe, expect, it } from "vitest";

import { DomainInvariantError, entityId } from "./index.js";

describe("entityId", () => {
  it("normalizes a non-empty provider ID", () => {
    expect(entityId("GitHubUser", " 123456 ")).toBe("123456");
  });

  it("rejects an empty ID at the domain boundary", () => {
    expect(() => entityId("GitHubUser", "   ")).toThrow(DomainInvariantError);
  });
});
