import { describe, expect, it } from "vitest";

import {
  boardDropAction,
  preferredPointerDropId,
  shouldShowBoardRecord,
} from "./board-drop";

describe("boardDropAction", () => {
  it("publishes stored and completed cards dropped into publishing", () => {
    expect(boardDropAction("stored", "publishing")).toBe("publish");
    expect(boardDropAction("published", "publishing")).toBe("publish");
  });

  it("reorders stored cards and dismisses completed cards in stored", () => {
    expect(boardDropAction("stored", "stored")).toBe("move");
    expect(boardDropAction("published", "stored")).toBe("move");
  });

  it("does not manually move active publishing cards or drop into completed", () => {
    expect(boardDropAction("publishing", "stored")).toBeNull();
    expect(boardDropAction("publishing", "published")).toBeNull();
    expect(boardDropAction("stored", "published")).toBeNull();
  });
});

describe("preferredPointerDropId", () => {
  it("prioritizes the publishing column over the active and adjacent cards", () => {
    expect(
      preferredPointerDropId(
        [
          { column: "stored", id: "active", kind: "record" },
          { column: "stored", id: "nearby", kind: "record" },
          {
            column: "publishing",
            id: "column:publishing",
            kind: "column",
          },
        ],
        "active",
      ),
    ).toBe("column:publishing");
  });

  it("keeps card-level targeting for reordering within stored", () => {
    expect(
      preferredPointerDropId(
        [
          { column: "stored", id: "column:stored", kind: "column" },
          { column: "stored", id: "target", kind: "record" },
        ],
        "active",
      ),
    ).toBe("target");
  });
});

describe("shouldShowBoardRecord", () => {
  it("keeps a hidden completion visible only while transient state exists", () => {
    expect(shouldShowBoardRecord(false, true)).toBe(true);
    expect(shouldShowBoardRecord(false, false)).toBe(false);
    expect(shouldShowBoardRecord(true, false)).toBe(true);
  });
});
