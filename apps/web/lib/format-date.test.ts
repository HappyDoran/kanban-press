import { describe, expect, it } from "vitest";

import { formatEditedAt } from "./format-date";

describe("formatEditedAt", () => {
  const now = Date.parse("2026-08-08T12:00:00Z");

  it("formats recent edits relatively", () => {
    expect(formatEditedAt("2026-08-08T11:59:40Z", now)).toBe("방금 전");
    expect(formatEditedAt("2026-08-08T11:30:00Z", now)).toBe("30분 전");
    expect(formatEditedAt("2026-08-08T09:00:00Z", now)).toBe("3시간 전");
    expect(formatEditedAt("2026-08-05T12:00:00Z", now)).toBe("3일 전");
  });

  it("falls back to absolute dates for old or future values", () => {
    expect(formatEditedAt("2026-06-01T00:00:00Z", now)).toMatch(/2026/);
    expect(formatEditedAt("2027-01-01T00:00:00Z", now)).toMatch(/2027/);
  });

  it("returns the raw value when unparsable", () => {
    expect(formatEditedAt("not-a-date", now)).toBe("not-a-date");
  });
});
