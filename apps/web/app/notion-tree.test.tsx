import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PageSummary } from "../lib/client/api";

import { normalizeForSearch, NotionTree } from "./notion-tree";

function page(id: string, title: string, parentPageId: string | null = null): PageSummary {
  return {
    hasChildren: false,
    iconUrl: null,
    lastEditedAt: "2026-11-01T00:00:00.000Z",
    parentContainerId: null,
    parentPageId,
    providerPageId: id,
    title,
  };
}

const pages = [
  { ...page("a", "회고"), hasChildren: true },
  page("b", "2026년 10월 회고", "a"),
  page("c", "Astro 블로그 만들기"),
  page("d", "TypeScript strict 모드"),
];

function render(query: string): string {
  return renderToStaticMarkup(
    createElement(NotionTree, {
      connectionId: "connection",
      pages,
      query,
    }),
  );
}

describe("NotionTree search", () => {
  it("normalizes width, spacing and case", () => {
    expect(normalizeForSearch("  ＡＳＴＲＯ   블로그 ")).toBe("astro 블로그");
  });

  it("shows the hierarchy without a query and a flat list of matches (including child pages) with one", () => {
    const tree = render("");
    expect(tree).toContain("회고");
    expect(tree).not.toContain("2026년 10월 회고"); // 접힌 하위 page
    expect(tree).not.toContain("treeSearchStatus");

    const results = render(" 회고 ");
    expect(results).toContain("2026년 10월 회고");
    expect(results).toContain("문서 2개");
    expect(results).not.toContain("Astro 블로그 만들기");

    expect(render("astro")).toContain("Astro 블로그 만들기");
    expect(render("없는 제목")).toContain("일치하는 문서가 없습니다.");
  });
});
