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

describe("toKanbanRecords with blog posts", () => {
  it("puts visible cards whose page is on the blog in published with the blog URL, unless a publish is in flight", () => {
    const onBlog = record({ providerPageId: "9188c6a5-7381-452f-b3dc-d4865aa89bdf" });
    const blog = new Map([["9188c6a57381452fb3dcd4865aa89bdf", "https://octocat.github.io/posts/notion-9188c6a57381452fb3dcd4865aa89bdf/"]]);

    expect(toKanbanRecords([onBlog, record({ isVisible: false, providerPageId: "9188c6a5-7381-452f-b3dc-000000000000" })], {}, {}, blog)).toEqual([
      expect.objectContaining({
        column: "published",
        publishedUrl: "https://octocat.github.io/posts/notion-9188c6a57381452fb3dcd4865aa89bdf/",
      }),
    ]);
    const [publishing] = toKanbanRecords(
      [onBlog],
      { [pageKey(onBlog)]: { actionsUrl: null, column: "publishing", publishedUrl: null, startedAt: 1 } },
      {},
      blog,
    );
    expect(publishing?.column).toBe("publishing");
  });
});

describe("isVisibleByDefault", () => {
  it("shows only top-level pages by default", () => {
    expect(isVisibleByDefault({ parentContainerId: null, parentPageId: null })).toBe(true);
    expect(isVisibleByDefault({ parentContainerId: null, parentPageId: "parent" })).toBe(false);
    expect(isVisibleByDefault({ parentContainerId: "database", parentPageId: null })).toBe(false);
  });
});
