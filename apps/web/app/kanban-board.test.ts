import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  boardDropAction,
  preferredPointerDropId,
  shouldShowBoardRecord,
} from "./board-drop";
import { BoardCard, type KanbanRecord } from "./kanban-board";

const card: KanbanRecord = {
  column: "stored",
  connectionId: "3c90c3cc-0d44-4b50-8888-8dd25736052a",
  hasNavigableChildren: false,
  isVisible: true,
  ownerGitHubUserId: "583231",
  pageRole: "document",
  pageRoleOverride: null,
  position: 0,
  publishActionsUrl:
    "https://github.com/octocat/octocat.github.io/actions/runs/123",
  publishedUrl: null,
  publishStartedAt: null,
  providerPageId: "9188c6a5-7381-452f-b3dc-d4865aa89bdf",
  sourceLastEditedAt: "2026-07-19T10:00:00.000Z",
  structureSourceLastEditedAt: "2026-07-19T10:00:00.000Z",
  title: "테스트 문서",
  updatedAt: "2026-07-19T10:30:00.000Z",
  visibilityOverride: "shown",
};

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

describe("BoardCard", () => {
  it("offers preview only for stored cards", () => {
    const stored = renderToStaticMarkup(
      createElement(BoardCard, {
        connectionName: "테스트 워크스페이스",
        onPreview: () => undefined,
        record: card,
      }),
    );
    const publishing = renderToStaticMarkup(
      createElement(BoardCard, {
        connectionName: "테스트 워크스페이스",
        onPreview: () => undefined,
        record: { ...card, column: "publishing" },
      }),
    );
    const published = renderToStaticMarkup(
      createElement(BoardCard, {
        connectionName: "테스트 워크스페이스",
        onPreview: () => undefined,
        record: { ...card, column: "published" },
      }),
    );

    expect(stored).toContain(">미리보기</button>");
    expect(publishing).not.toContain(">미리보기</button>");
    expect(published).not.toContain(">미리보기</button>");
  });

  it("shows an accessible Actions link with an actionable failure alert", () => {
    const html = renderToStaticMarkup(
      createElement(BoardCard, {
        connectionName: "테스트 워크스페이스",
        publishFailure: {
          actionsUrl: card.publishActionsUrl,
          message: "Actions 로그를 확인해 주세요.",
        },
        record: card,
      }),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Actions 로그를 확인해 주세요.");
    expect(html).toContain(`href="${card.publishActionsUrl}"`);
    expect(html).toContain("GitHub Actions 로그 보기");
  });

  it("shows both the Actions run and published page on a completed card", () => {
    const html = renderToStaticMarkup(
      createElement(BoardCard, {
        connectionName: "테스트 워크스페이스",
        record: {
          ...card,
          column: "published",
          publishedUrl: "https://octocat.github.io/posts/test/",
        },
      }),
    );

    expect(html).toContain("GitHub Actions 로그 보기");
    expect(html).toContain("게시된 글 보기");
  });
});
