import { describe, expect, it } from "vitest";

import type { PageSummary } from "../lib/client/api";

import { pageKey, toKanbanRecords } from "./use-board";

const CONNECTION = "connection";

function page(overrides: Partial<PageSummary> = {}): PageSummary {
  return {
    hasChildren: false,
    iconUrl: null,
    lastEditedAt: "2026-07-19T10:00:00.000Z",
    parentContainerId: null,
    parentPageId: null,
    providerPageId: "page",
    title: "문서",
    ...overrides,
  };
}

describe("toKanbanRecords", () => {
  it("shows every document page (child and database rows too) newest first and leaves out containers", () => {
    const cards = toKanbanRecords(
      CONNECTION,
      [
        page({ lastEditedAt: "2026-07-01T00:00:00.000Z", providerPageId: "old" }),
        page({ hasChildren: true, providerPageId: "container" }),
        page({ lastEditedAt: "2026-07-20T00:00:00.000Z", parentPageId: "container", providerPageId: "child" }),
        page({ parentContainerId: "database", providerPageId: "row" }),
      ],
      {},
      {},
    );

    expect(cards.map((card) => [card.providerPageId, card.column])).toEqual([
      ["child", "stored"],
      ["row", "stored"],
      ["old", "stored"],
    ]);
  });

  it("is empty until a connection is selected", () => {
    expect(toKanbanRecords(null, [page()], {}, {})).toEqual([]);
  });

  it("carries the Actions link of a failed publish on the stored card", () => {
    const key = pageKey({ connectionId: CONNECTION, providerPageId: "page" });
    const [card] = toKanbanRecords(CONNECTION, [page()], {}, {
      [key]: { actionsUrl: "https://github.com/a/a.github.io/actions/runs/1", message: "실패", retryAt: null },
    });

    expect(card).toMatchObject({ column: "stored", publishActionsUrl: "https://github.com/a/a.github.io/actions/runs/1" });
  });

  it("puts pages that are on the blog in published with the blog URL, unless a publish is in flight", () => {
    const onBlog = page({ providerPageId: "9188c6a5-7381-452f-b3dc-d4865aa89bdf" });
    const blog = new Map([["9188c6a57381452fb3dcd4865aa89bdf", "https://octocat.github.io/posts/notion-9188c6a57381452fb3dcd4865aa89bdf/"]]);

    expect(toKanbanRecords(CONNECTION, [onBlog], {}, {}, blog)).toEqual([
      expect.objectContaining({
        column: "published",
        publishedUrl: "https://octocat.github.io/posts/notion-9188c6a57381452fb3dcd4865aa89bdf/",
      }),
    ]);
    const [publishing] = toKanbanRecords(
      CONNECTION,
      [onBlog],
      { [pageKey({ connectionId: CONNECTION, providerPageId: onBlog.providerPageId })]: { actionsUrl: null, column: "publishing", publishedUrl: null, startedAt: 1 } },
      {},
      blog,
    );
    expect(publishing?.column).toBe("publishing");
  });
});
