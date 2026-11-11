import { describe, expect, it } from "vitest";

import type { PageSummary } from "../lib/client/api";

import { applyBoardChanges, boardErrorMessage, pageKey, toKanbanRecords } from "./use-board";

const CONNECTION = "connection";
const id = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const suffix = (digit: string) => id(digit).replaceAll("-", "");

function page(digit: string, overrides: Partial<PageSummary> = {}): PageSummary {
  return {
    hasChildren: false,
    iconUrl: null,
    lastEditedAt: "2026-07-19T10:00:00.000Z",
    parentContainerId: null,
    parentPageId: null,
    providerPageId: id(digit),
    title: `문서 ${digit}`,
    ...overrides,
  };
}

describe("toKanbanRecords", () => {
  it("shows only documents on the board list, most recently added first, and never containers", () => {
    const cards = toKanbanRecords(
      CONNECTION,
      [page("a"), page("b", { parentPageId: id("c") }), page("c", { hasChildren: true }), page("d")],
      [suffix("b"), suffix("c"), suffix("a")],
      {},
      {},
    );

    expect(cards.map((card) => [card.title, card.column])).toEqual([
      ["문서 a", "stored"],
      ["문서 b", "stored"],
    ]);
  });

  it("is empty until a connection is selected", () => {
    expect(toKanbanRecords(null, [page("a")], [suffix("a")], {}, {})).toEqual([]);
  });

  it("shows pages on the blog as published even when they are not on the board list", () => {
    const blog = new Map([[suffix("a"), "https://octocat.github.io/posts/a/"]]);

    expect(toKanbanRecords(CONNECTION, [page("a")], [], {}, {}, blog)).toEqual([
      expect.objectContaining({ column: "published", publishedUrl: "https://octocat.github.io/posts/a/" }),
    ]);
    const [publishing] = toKanbanRecords(
      CONNECTION,
      [page("a")],
      [],
      { [pageKey({ connectionId: CONNECTION, providerPageId: id("a") })]: { actionsUrl: null, column: "publishing", publishedUrl: null, startedAt: 1 } },
      {},
      blog,
    );
    expect(publishing?.column).toBe("publishing");
  });

  it("carries the Actions link of a failed publish on the stored card", () => {
    const key = pageKey({ connectionId: CONNECTION, providerPageId: id("a") });
    const [card] = toKanbanRecords(CONNECTION, [page("a")], [suffix("a")], {}, {
      [key]: { actionsUrl: "https://github.com/a/a.github.io/actions/runs/1", message: "실패", retryAt: null },
    });

    expect(card).toMatchObject({ column: "stored", publishActionsUrl: "https://github.com/a/a.github.io/actions/runs/1" });
  });
});

describe("boardErrorMessage", () => {
  it("explains a change made elsewhere", () => {
    expect(boardErrorMessage("github_conflict")).toContain("다른 곳에서");
  });
});

describe("applyBoardChanges", () => {
  it("keeps changes still waiting in this tab on top of an earlier server response", () => {
    const a = "a".repeat(32);
    const b = "b".repeat(32);
    const c = "c".repeat(32);
    expect(applyBoardChanges([a], new Map([[b, true], [c, true]]))).toEqual([a, b, c]);
    expect(applyBoardChanges([a, b], new Map([[a, false], [b, true]]))).toEqual([b]);
  });
});
