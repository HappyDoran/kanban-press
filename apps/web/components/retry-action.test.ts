import { describe, expect, it } from "vitest";

import { retryAtFromResponse } from "@/lib/client/api";

import { retrySecondsRemaining } from "./retry-action";

describe("provider retry timing", () => {
  it("accepts only bounded delta-seconds Retry-After values", () => {
    expect(
      retryAtFromResponse(
        new Response(null, { headers: { "retry-after": "12" } }),
        1_000,
      ),
    ).toBe(13_000);
    expect(
      retryAtFromResponse(
        new Response(null, { headers: { "retry-after": "7200" } }),
      ),
    ).toBeNull();
    expect(
      retryAtFromResponse(
        new Response(null, { headers: { "retry-after": "tomorrow" } }),
      ),
    ).toBeNull();
  });

  it("rounds up the visible wait and reaches zero", () => {
    expect(retrySecondsRemaining(2_001, 1_000)).toBe(2);
    expect(retrySecondsRemaining(2_001, 2_001)).toBe(0);
    expect(retrySecondsRemaining(null, 1_000)).toBe(0);
  });
});
