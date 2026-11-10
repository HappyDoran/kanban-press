import type {
  NotionPageContent,
  NotionRichText,
} from "@kanban-press/notion";
import { describe, expect, it } from "vitest";

import {
  buildPublishDocument,
  categorySlug,
  deriveBlogMetadata,
  InvalidBlogMetadataError,
} from "./document";
import { publishingProperties } from "../notion/convert";

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
      pinned: false,
      publishedAt: "2026-07-18T09:00:00.000Z",
      series: null,
      seriesOrder: null,
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

describe("pinned and series metadata (R10)", () => {
  it("reads checkbox, select and number properties from Notion", () => {
    expect(
      publishingProperties({
        "Blog Order": { id: "o", number: 2, type: "number" },
        "Blog Pinned": { checkbox: true, id: "p", type: "checkbox" },
        "Blog Series": { id: "s", select: { color: "blue", id: "x", name: "Astro 입문" }, type: "select" },
      }),
    ).toEqual({
      "Blog Order": { kind: "number", value: 2 },
      "Blog Pinned": { checked: true, kind: "checkbox" },
      "Blog Series": { kind: "select", name: "Astro 입문" },
    });
  });

  it("adds pinned, series and order to the document only when set", () => {
    const document = buildPublishDocument(
      page({
        "Blog Order": { kind: "number", value: 2 },
        "Blog Pinned": { checked: true, kind: "checkbox" },
        "Blog Series": { kind: "select", name: " Astro 입문 " },
      }),
    );
    expect(document).toMatchObject({
      pinned: true,
      series: { name: "Astro 입문", slug: categorySlug("Astro 입문") },
      seriesOrder: 2,
    });

    const plain = buildPublishDocument(
      page({
        "Blog Order": { kind: "number", value: 3 },
        "Blog Pinned": { checked: false, kind: "checkbox" },
        "Blog Series": { kind: "select", name: null },
      }),
    );
    expect(plain).not.toHaveProperty("pinned");
    expect(plain).not.toHaveProperty("series");
    expect(plain).not.toHaveProperty("seriesOrder");
  });

  it.each([
    ["Blog Pinned", { kind: "unsupported", providerType: "rich_text" }],
    ["Blog Series", { kind: "multi_select", names: ["A"] }],
    ["Blog Series", { kind: "select", name: "가".repeat(81) }],
    ["Blog Order", { kind: "unsupported", providerType: "formula" }],
    ["Blog Order", { kind: "number", value: 2_000_000 }],
  ])("rejects an invalid %s value", (property, value) => {
    expect(() => deriveBlogMetadata(page({ [property]: value }))).toThrowError(
      new InvalidBlogMetadataError(property as "Blog Order"),
    );
  });
});

describe("custom post address (R11 Blog Slug)", () => {
  it("uses Blog Slug before the page ID suffix and falls back to the title when empty", () => {
    expect(buildPublishDocument(page({ "Blog Slug": { kind: "rich_text", plainText: " astro-notes " } })).slug).toBe(
      "astro-notes-9188c6a57381",
    );
    expect(buildPublishDocument(page({ "Blog Slug": { kind: "rich_text", plainText: "" } })).slug).toBe(
      "notion-9188c6a57381",
    );
  });

  it.each(["Astro Notes", "한글", "a--b", "-a", "a".repeat(81)])("rejects Blog Slug %j", (plainText) => {
    expect(() => buildPublishDocument(page({ "Blog Slug": { kind: "rich_text", plainText } }))).toThrowError(
      new InvalidBlogMetadataError("Blog Slug"),
    );
  });
});
