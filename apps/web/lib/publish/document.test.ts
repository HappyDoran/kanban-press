import type {
  NotionPageContent,
  NotionRichText,
} from "@kanban-press/notion";
import { describe, expect, it } from "vitest";

import {
  buildPublishDocument,
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
      // 제거한 속성이라 값이 있어도 설명은 본문 첫 문단이다.
      "Blog Description": {
        kind: "rich_text",
        plainText: "무시되는 설명",
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
      description: "본문 설명",
      publishedAt: "2026-07-01T00:30:00.000Z",
      schemaVersion: 2,
      slug: "notion-9188c6a57381452fb3dcd4865aa89bdf",
      tags: ["release", "TypeScript Guide"],
      title: "한글 게시 글",
      updatedAt: "2026-07-19T10:00:00.000Z",
    });
    expect(first.blocks[0]).toMatchObject({ kind: "heading", level: 2 });
  });

  it("uses empty tags, body/title, and createdAt fallbacks", () => {
    expect(
      deriveBlogMetadata(
        page({
          "Blog Tags ": { kind: "multi_select", names: ["alias"] },
          "blog tags": { kind: "multi_select", names: ["alias"] },
        }),
      ),
    ).toEqual({
      // 소제목은 건너뛰고 첫 문단을 쓴다.
      description: "본문 설명",
      pinned: false,
      publishedAt: "2026-07-18T09:00:00.000Z",
      tags: [],
    });

    const titleOnly = page();
    titleOnly.blocks = [
      { kind: "heading", level: 1, richText: [richText("한 줄 요약")] },
      { kind: "quote", richText: [richText("표기 안내")] },
    ] as NotionPageContent["blocks"];
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

  it.each([
    ["null tags", { "Blog Tags": null }],
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
        "Blog Published At": {
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

describe("pinned metadata (R10) and removed properties", () => {
  it("reads the checkbox property and ignores removed category, series and order properties", () => {
    expect(
      publishingProperties({
        "Blog Category": { id: "c", select: { color: "blue", id: "x", name: "개발" }, type: "select" },
        "Blog Order": { id: "o", number: 2, type: "number" },
        "Blog Pinned": { checkbox: true, id: "p", type: "checkbox" },
        "Blog Series": { id: "s", select: { color: "blue", id: "y", name: "Astro 입문" }, type: "select" },
      }),
    ).toEqual({ "Blog Pinned": { checked: true, kind: "checkbox" } });
  });

  it("adds pinned only when set and publishes pages that still have removed properties", () => {
    const document = buildPublishDocument(
      page({
        "Blog Category": { kind: "select", name: "개발" },
        "Blog Order": { kind: "number", value: 2 },
        "Blog Pinned": { checked: true, kind: "checkbox" },
        "Blog Series": { kind: "select", name: "Astro 입문" },
      }),
    );
    expect(document).toMatchObject({ pinned: true });
    for (const key of ["category", "series", "seriesOrder"]) {
      expect(document).not.toHaveProperty(key);
    }

    const plain = buildPublishDocument(page({ "Blog Pinned": { checked: false, kind: "checkbox" } }));
    expect(plain).not.toHaveProperty("pinned");
  });

  it("rejects an invalid Blog Pinned value", () => {
    expect(() =>
      deriveBlogMetadata(page({ "Blog Pinned": { kind: "unsupported", providerType: "rich_text" } })),
    ).toThrowError(new InvalidBlogMetadataError("Blog Pinned"));
  });
});

describe("custom post address (R11 Blog Slug)", () => {
  it("uses Blog Slug before the page ID suffix and falls back to the title when empty", () => {
    expect(buildPublishDocument(page({ "Blog Slug": { kind: "rich_text", plainText: " astro-notes " } })).slug).toBe(
      "astro-notes-9188c6a57381452fb3dcd4865aa89bdf",
    );
    expect(buildPublishDocument(page({ "Blog Slug": { kind: "rich_text", plainText: "" } })).slug).toBe(
      "notion-9188c6a57381452fb3dcd4865aa89bdf",
    );
  });

  it.each(["Astro Notes", "한글", "a--b", "-a", "a".repeat(81)])("rejects Blog Slug %j", (plainText) => {
    expect(() => buildPublishDocument(page({ "Blog Slug": { kind: "rich_text", plainText } }))).toThrowError(
      new InvalidBlogMetadataError("Blog Slug"),
    );
  });
});
