import { describe, expect, it } from "vitest";

import type { BoardRecord } from "../lib/board/repository";

import { isVisibleByDefault, pageKey, toKanbanRecords } from "./use-board";

function record(overrides: Partial<BoardRecord> = {}): BoardRecord {
  return {
    column: "stored",
    connectionId: "connection",
    hasNavigableChildren: false,
    isVisible: true,
    ownerGitHubUserId: "583231",
    pageRole: "document",
    pageRoleOverride: null,
    position: 0,
    providerPageId: "page",
    sourceLastEditedAt: "2026-07-19T10:00:00.000Z",
    structureSourceLastEditedAt: null,
    title: "문서",
    updatedAt: "2026-07-19T10:00:00.000Z",
    visibilityOverride: null,
    ...overrides,
  };
}

describe("toKanbanRecords", () => {
  it("shows visible documents in stored and hides containers and hidden pages", () => {
    const cards = toKanbanRecords(
      [
        record(),
        record({ pageRole: "container", providerPageId: "container" }),
        record({ isVisible: false, providerPageId: "hidden" }),
      ],
      {},
      {},
    );

    expect(cards).toEqual([
      expect.objectContaining({ column: "stored", providerPageId: "page", publishedUrl: null }),
    ]);
  });

  it("keeps a hidden card on screen while it is being published or just published", () => {
    const hidden = record({ isVisible: false });
    const cards = toKanbanRecords(
      [hidden],
      {
        [pageKey(hidden)]: {
          actionsUrl: null,
          column: "published",
          publishedUrl: "https://octocat.github.io/posts/a/",
          startedAt: null,
        },
      },
      {},
    );

    expect(cards).toEqual([
      expect.objectContaining({ column: "published", publishedUrl: "https://octocat.github.io/posts/a/" }),
    ]);
  });

  it("carries the Actions link of a failed publish on the stored card", () => {
    const failed = record();
    const [card] = toKanbanRecords([failed], {}, {
      [pageKey(failed)]: { actionsUrl: "https://github.com/a/a.github.io/actions/runs/1", message: "실패", retryAt: null },
    });

    expect(card).toMatchObject({ column: "stored", publishActionsUrl: "https://github.com/a/a.github.io/actions/runs/1" });
  });
});

describe("isVisibleByDefault", () => {
  it("shows only top-level pages by default", () => {
    expect(isVisibleByDefault({ parentContainerId: null, parentPageId: null })).toBe(true);
    expect(isVisibleByDefault({ parentContainerId: null, parentPageId: "parent" })).toBe(false);
    expect(isVisibleByDefault({ parentContainerId: "database", parentPageId: null })).toBe(false);
  });
});
