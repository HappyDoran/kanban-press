import { describe, expect, it } from "vitest";

import { filterRenderableOutline } from "./notion-outline";

describe("filterRenderableOutline", () => {
  it("keeps accessible targets and their structural ancestors", () => {
    expect(
      filterRenderableOutline(
        [
          {
            kind: "toggle",
            nodeId: "toggle",
            parentNodeId: null,
            providerId: null,
            title: "문서",
          },
          {
            kind: "page",
            nodeId: "link",
            parentNodeId: "toggle",
            providerId: "page-1",
            title: "연결된 페이지",
          },
        ],
        [{ parentContainerId: null, providerPageId: "page-1" }],
      ),
    ).toHaveLength(2);
  });

  it("removes inaccessible links and empty database groups", () => {
    expect(
      filterRenderableOutline(
        [
          {
            kind: "page",
            nodeId: "missing-page",
            parentNodeId: null,
            providerId: "page-2",
            title: "권한 없는 페이지",
          },
          {
            kind: "database",
            nodeId: "empty-database",
            parentNodeId: null,
            providerId: "database-1",
            title: "빈 데이터베이스",
          },
        ],
        [{ parentContainerId: null, providerPageId: "page-1" }],
      ),
    ).toEqual([]);
  });

  it("keeps a database that owns an accessible row page", () => {
    expect(
      filterRenderableOutline(
        [
          {
            kind: "database",
            nodeId: "database-block",
            parentNodeId: null,
            providerId: "database-1",
            title: "게시물",
          },
        ],
        [
          {
            parentContainerId: "database-1",
            providerPageId: "row-1",
          },
        ],
      ),
    ).toHaveLength(1);
  });
});
