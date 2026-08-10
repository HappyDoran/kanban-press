import { describe, expect, it } from "vitest";

import type { PublishSourceDocument } from "./document";
import {
  createPublishPreviewResponse,
  parsePublishPreviewResponse,
} from "./preview";

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
  ],
  category: { name: "개발", slug: "category-a1b2c3d4" },
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
