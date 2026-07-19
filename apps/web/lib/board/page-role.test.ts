import { describe, expect, it } from "vitest";

import {
  hasConfirmedNavigableChildren,
  pageActionAvailability,
  pagePrimaryAction,
} from "./page-role";

describe("page role eligibility", () => {
  it("does not offer a container role before structure inspection", () => {
    expect(
      hasConfirmedNavigableChildren({
        discoveredChildCount: 0,
        outlineNodeCount: 0,
        outlineState: "idle",
      }),
    ).toBe(false);
  });

  it("keeps a page document-only when its inspected outline is empty", () => {
    expect(
      hasConfirmedNavigableChildren({
        discoveredChildCount: 0,
        outlineNodeCount: 0,
        outlineState: "ready",
      }),
    ).toBe(false);
  });

  it("allows a container role only for discovered or outlined children", () => {
    expect(
      hasConfirmedNavigableChildren({
        discoveredChildCount: 1,
        outlineNodeCount: 0,
        outlineState: "idle",
      }),
    ).toBe(true);
    expect(
      hasConfirmedNavigableChildren({
        discoveredChildCount: 0,
        outlineNodeCount: 1,
        outlineState: "ready",
      }),
    ).toBe(true);
  });
});

describe("pageActionAvailability", () => {
  it("shows one loading state until both record and structure are ready", () => {
    expect(
      pageActionAvailability({
        inspectionIsCurrent: false,
        inspectionState: "loading",
        recordIsAvailable: true,
      }),
    ).toBe("loading");
    expect(
      pageActionAvailability({
        inspectionIsCurrent: true,
        inspectionState: "ready",
        recordIsAvailable: true,
      }),
    ).toBe("ready");
  });

  it("waits for the persisted automatic role and reduces failures to one state", () => {
    expect(
      pageActionAvailability({
        inspectionIsCurrent: false,
        inspectionState: "idle",
        recordIsAvailable: true,
      }),
    ).toBe("loading");
    expect(
      pageActionAvailability({
        inspectionIsCurrent: false,
        inspectionState: "error",
        recordIsAvailable: true,
      }),
    ).toBe("error");
  });
});

describe("pagePrimaryAction", () => {
  it("shows visibility only for a classified document", () => {
    expect(
      pagePrimaryAction({
        actionAvailability: "ready",
        isContainer: false,
        pending: false,
      }),
    ).toBe("visibility");
    expect(
      pagePrimaryAction({
        actionAvailability: "ready",
        isContainer: true,
        pending: false,
      }),
    ).toBe("none");
  });

  it("keeps loading and retry as the only incomplete actions", () => {
    expect(
      pagePrimaryAction({
        actionAvailability: "loading",
        isContainer: false,
        pending: false,
      }),
    ).toBe("loading");
    expect(
      pagePrimaryAction({
        actionAvailability: "error",
        isContainer: false,
        pending: false,
      }),
    ).toBe("retry");
  });
});
