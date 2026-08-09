import type {
  NotionPageContent,
  NotionRichText,
} from "@notion-kanban-blog/notion";
import { describe, expect, it } from "vitest";

import {
  buildPublishDocument,
  categorySlug,
  deriveBlogMetadata,
  InvalidBlogMetadataError,
} from "./document";

const PAGE_ID = "9188c6a5-7381-452f-b3dc-d4865aa89bdf";

function richText(text: string): NotionRichText {
  return {
    bold: true,
    code: false,
    href: "https://example.com",
    italic: false,
    strikethrough: false,
    text,
  };
}

function page(
  publishingProperties: Record<string, unknown> = {},
): NotionPageContent {
  return {
    blocks: [
      { kind: "heading", level: 1, richText: [richText("첫 제목")] },
      { kind: "paragraph", richText: [richText("본문 설명")] },
    ],
    createdAt: new Date("2026-07-18T09:00:00.000Z"),
    lastEditedAt: new Date("2026-07-19T10:00:00.000Z"),
    providerPageId: PAGE_ID,
    publishingProperties,
    title: "한글 게시 글",
  } as unknown as NotionPageContent;
}

describe("shared publish document assembly", () => {
  it("builds deterministic v2 metadata and preserves the existing post slug", () => {
    const source = page({
      "Blog Category": { kind: "select", name: "  Ｄev   Ops 한글  " },
      "Blog Description": {
        kind: "rich_text",
        plainText: "설명 본문",
      },
      "Blog Published At": {
        kind: "date",
        start: "2026-07-01T09:30:00+09:00",
      },
      "Blog Tags": {
        kind: "multi_select",
        names: [
          " release ",
          "ＴypeScript  Guide",
          "RELEASE",
          " TypeScript   Guide ",
        ],
      },
    });

    const first = buildPublishDocument(source);
    const second = buildPublishDocument(source);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      category: {
        name: "Ｄev   Ops 한글",
        slug: categorySlug("Ｄev   Ops 한글"),
      },
      description: "설명 본문",
      publishedAt: "2026-07-01T00:30:00.000Z",
      schemaVersion: 2,
      slug: "notion-9188c6a57381",
      tags: ["release", "TypeScript Guide"],
      title: "한글 게시 글",
      updatedAt: "2026-07-19T10:00:00.000Z",
    });
    expect(first.category.slug).toBe("dev-ops-cdae5729");
    expect(first.blocks[0]).toMatchObject({ kind: "heading", level: 2 });
  });

  it("uses uncategorized, empty tags, body/title, and createdAt fallbacks", () => {
    expect(
      deriveBlogMetadata(
        page({
          "Blog Category ": { kind: "select", name: "alias" },
          "blog tags": { kind: "multi_select", names: ["alias"] },
        }),
      ),
    ).toEqual({
      category: { name: "미분류", slug: "uncategorized" },
      description: "첫 제목",
      publishedAt: "2026-07-18T09:00:00.000Z",
      tags: [],
    });

    const titleOnly = page();
    titleOnly.blocks = [{ kind: "divider" }];
    expect(deriveBlogMetadata(titleOnly).description).toBe("한글 게시 글");
  });

  it.each(["", "   ", "제목 없음"])(
    "rejects an unavailable page title %j",
    (title) => {
      const source = page();
      source.title = title;

      expect(() => buildPublishDocument(source)).toThrowError(
        InvalidBlogMetadataError,
      );
    },
  );

  it("creates a hashed category slug after NFKC and whitespace normalization", () => {
    expect(categorySlug("  ＡPI   Design  ")).toBe(
      "api-design-76f1e543",
    );
    expect(categorySlug("한글 분류")).toBe("category-90ced527");
    expect(categorySlug("미분류")).toBe("uncategorized");
    expect(categorySlug("Ａ".repeat(80))).toMatch(
      /^[a]{48}-[a-f0-9]{8}$/,
    );
  });

  it.each([
    ["null category", { "Blog Category": null }],
    [
      "wrong category type",
      { "Blog Category": { kind: "multi_select", names: [] } },
    ],
    ["empty category", { "Blog Category": { kind: "select", name: "  " } }],
    [
      "category over 80 characters",
      { "Blog Category": { kind: "select", name: "a".repeat(81) } },
    ],
    ["wrong tags type", { "Blog Tags": { kind: "select", name: "tag" } }],
    ["empty tag", { "Blog Tags": { kind: "multi_select", names: ["  "] } }],
    [
      "more than ten tags",
      {
        "Blog Tags": {
          kind: "multi_select",
          names: Array.from({ length: 11 }, (_, index) => `tag-${index}`),
        },
      },
    ],
    [
      "description over 1000 characters",
      {
        "Blog Description": {
          kind: "rich_text",
          plainText: "a".repeat(1_001),
        },
      },
    ],
    [
      "invalid date",
      { "Blog Published At": { kind: "date", start: "not-a-date" } },
    ],
    [
      "date-only published at",
      { "Blog Published At": { kind: "date", start: "2026-07-01" } },
    ],
    [
      "unsupported present property",
      {
        "Blog Description": {
          kind: "unsupported",
          providerType: "formula",
        },
      },
    ],
  ])("throws typed invalid_blog_metadata for %s", (_name, properties) => {
    expect(() => deriveBlogMetadata(page(properties))).toThrowError(
      InvalidBlogMetadataError,
    );
    try {
      deriveBlogMetadata(page(properties));
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid_blog_metadata" });
    }
  });
});
