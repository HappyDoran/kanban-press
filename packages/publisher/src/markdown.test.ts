import { describe, expect, it } from "vitest";

import {
  createMarkdownArtifact,
  type PublishBlock,
  type PublishDocument,
} from "./index.js";

const decoder = new TextDecoder();
const baseDocument = {
  category: { name: "Engineering", slug: "engineering-a1b2c3d4" },
  description: "안전한 게시 fixture",
  publishedAt: "2026-07-19T01:00:00.000Z",
  schemaVersion: 2,
  slug: "hello-notion",
  tags: ["Notion", "Publishing"],
  title: "Notion에서 온 글",
  updatedAt: "2026-07-19T02:00:00.000Z",
} satisfies Omit<PublishDocument, "blocks">;

describe("createMarkdownArtifact", () => {
  it("renders title, body, code, image, toggle, and link blocks", () => {
    const artifact = createMarkdownArtifact({
      ...baseDocument,
      blocks: [
        {
          kind: "heading",
          level: 2,
          richText: [{ text: "본문 제목" }],
        },
        {
          kind: "paragraph",
          richText: [
            { bold: true, text: "굵게" },
            { text: " 그리고 " },
            {
              href: "https://example.com/docs?q=notion",
              italic: true,
              text: "링크",
            },
          ],
        },
        {
          code: "const fence = ```;\nconsole.log(fence);",
          kind: "code",
          language: "typescript<script>",
        },
        {
          caption: [{ text: "대표 이미지" }],
          kind: "image",
          url: "https://images.example.com/cover.png",
        },
        {
          children: [
            {
              kind: "paragraph",
              richText: [{ code: true, text: "child()`" }],
            },
          ],
          kind: "toggle",
          summary: [{ text: "자세히 <보기>" }],
        },
      ],
    });
    const markdown = decoder.decode(artifact.bytes);

    expect(artifact.path).toBe("src/content/blog/hello-notion.md");
    expect(markdown).toContain('title: "Notion에서 온 글"');
    expect(markdown).toContain("## 본문 제목");
    expect(markdown).toContain(
      "**굵게** 그리고 [*링크*](<https://example.com/docs?q=notion>)",
    );
    expect(markdown).toContain(
      "````text\nconst fence = ```;\nconsole.log(fence);\n````",
    );
    expect(markdown).toContain(
      "![대표 이미지](<https://images.example.com/cover.png>)",
    );
    expect(markdown).toContain("<details>");
    expect(markdown).toContain("<summary>자세히 &lt;보기&gt;</summary>");
    expect(markdown).toContain("`` child()` ``");
  });

  it("projects a validated v2 document to legacy v1 frontmatter", () => {
    const artifact = createMarkdownArtifact({
      ...baseDocument,
      blocks: [],
    });
    const markdown = decoder.decode(artifact.bytes);
    const frontmatter = markdown.split("---")[1];

    expect(frontmatter).toBe(
      [
        "",
        'title: "Notion에서 온 글"',
        'description: "안전한 게시 fixture"',
        'publishedAt: "2026-07-19T01:00:00.000Z"',
        'updatedAt: "2026-07-19T02:00:00.000Z"',
        "",
      ].join("\n"),
    );
    expect(frontmatter).not.toContain("schemaVersion:");
    expect(frontmatter).not.toContain("category:");
    expect(frontmatter).not.toContain("categorySlug:");
    expect(frontmatter).not.toContain("tags:");
  });

  it("escapes dangerous HTML and Markdown and drops unsafe links", () => {
    const artifact = createMarkdownArtifact({
      ...baseDocument,
      description: '"><script>alert(1)</script>',
      title: "</title><script>alert(1)</script>",
      blocks: [
        {
          kind: "paragraph",
          richText: [
            {
              href: "javascript:alert(1)",
              text: "<script>[click](javascript:alert(1))</script>",
            },
          ],
        },
      ],
    });
    const markdown = decoder.decode(artifact.bytes);

    expect(markdown).not.toContain("<script>");
    expect(markdown).not.toContain("[&lt;script&gt;");
    expect(markdown).not.toContain("](<javascript:");
    expect(markdown).toContain(
      "&lt;script&gt;\\[click\\]\\(javascript:alert\\(1\\)\\)&lt;/script&gt;",
    );
  });

  it.each([
    "../escape",
    "nested/escape",
    "/absolute",
    "Uppercase",
    "two--dashes",
  ])("rejects unsafe slug %s", (slug) => {
    expect(() =>
      createMarkdownArtifact({
        ...baseDocument,
        blocks: [],
        slug,
      }),
    ).toThrow();
  });

  it.each([
    "../escape",
    "nested/escape",
    "/absolute",
    "Uppercase",
    "two--dashes",
  ])("rejects unsafe category slug %s", (slug) => {
    expect(() =>
      createMarkdownArtifact({
        ...baseDocument,
        blocks: [],
        category: { name: "Engineering", slug },
      }),
    ).toThrow();
  });

  it.each([
    { category: { name: "", slug: "engineering" } },
    { category: { name: "x".repeat(81), slug: "engineering" } },
    { publishedAt: "2026-07-19" },
    { schemaVersion: 1 },
    { updatedAt: "not-a-date" },
  ])("rejects invalid v2 metadata %#", (override) => {
    expect(() =>
      createMarkdownArtifact({
        ...baseDocument,
        ...override,
        blocks: [],
      } as PublishDocument),
    ).toThrow();
  });

  it.each([
    { tags: [""] },
    { tags: ["x".repeat(41)] },
    { tags: Array.from({ length: 11 }, (_, index) => `tag-${index}`) },
    { tags: ["React", " react "] },
    { tags: ["TypeScript", "ＴｙｐｅＳｃｒｉｐｔ"] },
  ])("rejects invalid or duplicate tags %#", ({ tags }) => {
    expect(() =>
      createMarkdownArtifact({
        ...baseDocument,
        blocks: [],
        tags,
      }),
    ).toThrow();
  });

  it("rejects unknown document and category fields", () => {
    expect(() =>
      createMarkdownArtifact({
        ...baseDocument,
        blocks: [],
        providerPageId: "secret-provider-id",
      } as PublishDocument),
    ).toThrow();
    expect(() =>
      createMarkdownArtifact({
        ...baseDocument,
        blocks: [],
        category: {
          ...baseDocument.category,
          providerCategoryId: "secret-category-id",
        },
      } as PublishDocument),
    ).toThrow();
  });

  it.each(["http://images.example.com/cover.png", "javascript:alert(1)"])(
    "rejects unsafe image URL %s",
    (url) => {
      expect(() =>
        createMarkdownArtifact({
          ...baseDocument,
          blocks: [{ caption: [], kind: "image", url }],
        }),
      ).toThrow("Image URL must use HTTPS");
    },
  );

  it("rejects documents deeper than the traversal limit", () => {
    let nested: PublishBlock = {
      kind: "paragraph",
      richText: [{ text: "끝" }],
    };
    for (let depth = 0; depth < 21; depth += 1) {
      nested = { children: [nested], kind: "toggle", summary: [] };
    }

    expect(() =>
      createMarkdownArtifact({
        ...baseDocument,
        blocks: [nested],
      }),
    ).toThrow("Document block depth exceeds the safe limit");
  });
});
