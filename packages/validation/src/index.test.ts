import { describe, expect, it } from "vitest";

import { paginationSchema, slugSchema } from "./index.js";

describe("shared input schemas", () => {
  it("normalizes pagination input and applies a safe default", () => {
    expect(paginationSchema.parse({})).toEqual({ limit: 20 });
    expect(paginationSchema.parse({ limit: "50" })).toEqual({ limit: 50 });
  });

  it("rejects unsafe or ambiguous slugs", () => {
    expect(slugSchema.safeParse("valid-post-1").success).toBe(true);
    expect(slugSchema.safeParse("../admin").success).toBe(false);
    expect(slugSchema.safeParse("Has Spaces").success).toBe(false);
  });
});
