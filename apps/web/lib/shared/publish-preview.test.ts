import { describe, expect, it } from "vitest";

import type { PublishSourceDocument } from "@/lib/server/publish/document";
import {
  createPublishPreviewResponse,
  parsePublishPreviewResponse,
} from "./publish-preview";

const document: PublishSourceDocument = {
  blocks: [
    {
      kind: "paragraph",
      richText: [
        {
          bold: true,
          href: "javascript:alert(1)",
          text: "<script>본문</script>",
        },
      ],
    },
    {
      caption: [{ text: "비공개 이미지" }],
      kind: "image",
      sourceUrl: "https://files.notion.example/image.png?signature=secret",
    },
    {
      children: [
        {
          caption: [],
          kind: "image",
          sourceUrl:
            "https://files.notion.example/nested.png?token=nested-secret",
        },
      ],
      kind: "toggle",
      summary: [{ href: "https://example.com/guide", text: "자세히" }],
    },
    {
      children: [],
      kind: "listItem",
      richText: [{ text: "목록" }],
      style: "bulleted",
    },
    {
      checked: true,
      children: [],
      kind: "toDo",
      richText: [{ text: "완료" }],
    },
    {
      children: [],
      icon: "💡",
      kind: "callout",
      richText: [{ text: "안내" }],
    },
    {
      hasColumnHeader: true,
      hasRowHeader: false,
      kind: "table",
      rows: [[[{ text: "제목" }]], [[{ text: "값" }]]],
    },
    { expression: "x^2", kind: "equation" },
    {
      caption: [{ text: "문서" }],
      kind: "linkCard",
      url: "https://example.com/docs",
    },
    {
      caption: [],
      kind: "media",
      mediaType: "video",
      url: null,
    },
  ],
  description: "설명",
  publishedAt: "2026-08-09T00:00:00.000Z",
  schemaVersion: 2,
  slug: "preview-post-a1b2c3d4",
  tags: ["Notion"],
  title: "프리뷰 글",
  updatedAt: "2026-08-10T00:00:00.000Z",
};

describe("publish preview DTO", () => {
  it("projects a strict typed response without image capability URLs", () => {
    const preview = createPublishPreviewResponse(
      document,
      "2026-08-10T00:00:00.000Z",
    );

    expect(preview).toMatchObject({
      document: {
        blocks: [
          {
            kind: "paragraph",
            richText: [
              {
                bold: true,
                href: null,
                text: "<script>본문</script>",
              },
            ],
          },
          { caption: expect.any(Array), kind: "image" },
          { children: [{ kind: "image" }], kind: "toggle" },
          { kind: "listItem", style: "bulleted" },
          { checked: true, kind: "toDo" },
          { icon: "💡", kind: "callout" },
          { hasColumnHeader: true, kind: "table" },
          { expression: "x^2", kind: "equation" },
          { href: "https://example.com/docs", kind: "linkCard" },
          { href: null, kind: "media", mediaType: "video" },
        ],
        slug: "preview-post-a1b2c3d4",
      },
      previewSchemaVersion: 1,
      templateVersion: 2,
      warnings: [{ code: "image_placeholder" }],
    });
    const serialized = JSON.stringify(preview);
    expect(serialized).not.toContain("files.notion.example");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain('"url"');
    expect(serialized).not.toContain("markdown");
  });

  it("strictly rejects unknown response and block fields", () => {
    const preview = createPublishPreviewResponse(
      document,
      "2026-08-10T00:00:00.000Z",
    );
    expect(parsePublishPreviewResponse(preview)).toEqual(preview);
    expect(
      parsePublishPreviewResponse({ ...preview, markdown: "# leaked" }),
    ).toBeNull();
    expect(
      parsePublishPreviewResponse({
        ...preview,
        document: {
          ...preview.document,
          blocks: [{ kind: "image", url: "https://example.com/private" }],
        },
      }),
    ).toBeNull();
    expect(
      parsePublishPreviewResponse({
        ...preview,
        document: {
          ...preview.document,
          blocks: [
            {
              kind: "paragraph",
              richText: [
                {
                  bold: false,
                  code: false,
                  href: "javascript:alert(1)",
                  italic: false,
                  strikethrough: false,
                  text: "unsafe",
                },
              ],
            },
          ],
        },
      }),
    ).toBeNull();
  });

  it("rejects a projected response above the total byte limit", () => {
    expect(() =>
      createPublishPreviewResponse(
        {
          ...document,
          blocks: Array.from({ length: 3 }, () => ({
            code: "x".repeat(900_000),
            kind: "code" as const,
            language: "text",
          })),
        },
        "2026-08-10T00:00:00.000Z",
      ),
    ).toThrow("safe size limit");
  });
});
