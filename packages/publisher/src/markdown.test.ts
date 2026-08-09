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

  it("renders exact deterministic v2 frontmatter and preserves the post path", () => {
    const artifact = createMarkdownArtifact({
      ...baseDocument,
      blocks: [{ kind: "paragraph", richText: [{ text: "안전한 본문" }] }],
    });
    const markdown = decoder.decode(artifact.bytes);

    expect(artifact.path).toBe("src/content/blog/hello-notion.md");
    expect(markdown).toBe(
      [
        "---",
        "schemaVersion: 2",
        'title: "Notion에서 온 글"',
        'description: "안전한 게시 fixture"',
        'category: "Engineering"',
        'categorySlug: "engineering-a1b2c3d4"',
        'tags: ["Notion", "Publishing"]',
        'publishedAt: "2026-07-19T01:00:00.000Z"',
        'updatedAt: "2026-07-19T02:00:00.000Z"',
        "---",
        "",
        "안전한 본문",
        "",
      ].join("\n"),
    );
  });

  it("JSON-escapes frontmatter and escapes dangerous body content", () => {
    const artifact = createMarkdownArtifact({
      ...baseDocument,
      category: {
        name: 'Docs: "safe" & <typed>',
        slug: "docs-safe-a1b2c3d4",
      },
      description: '"><script>\nalert(1)</script>',
      tags: ['YAML: "quoted"', "HTML & <safe>"],
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
    expect(markdown).toContain(
      'title: "\\u003c/title\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e"',
    );
    expect(markdown).toContain(
      'description: "\\"\\u003e\\u003cscript\\u003e\\nalert(1)\\u003c/script\\u003e"',
    );
    expect(markdown).toContain(
      'category: "Docs: \\"safe\\" \\u0026 \\u003ctyped\\u003e"',
    );
    expect(markdown).toContain(
      'tags: ["YAML: \\"quoted\\"", "HTML \\u0026 \\u003csafe\\u003e"]',
    );
    expect(markdown).not.toContain("[&lt;script&gt;");
    expect(markdown).not.toContain("](<javascript:");
    expect(markdown).toContain(
      "&lt;script&gt;\\[click\\]\\(javascript:alert\\(1\\)\\)&lt;/script&gt;",
    );
  });

  it("preserves tag display order and repeats byte-identically", () => {
    const tags = ["zeta", "가나다", "Alpha"];
    const first = createMarkdownArtifact({
      ...baseDocument,
      blocks: [],
      tags,
    });
    const second = createMarkdownArtifact({
      ...baseDocument,
      blocks: [],
      tags: [...tags],
    });
    const reordered = createMarkdownArtifact({
      ...baseDocument,
      blocks: [],
      tags: ["Alpha", "zeta", "가나다"],
    });

    expect(decoder.decode(first.bytes)).toBe(decoder.decode(second.bytes));
    expect(decoder.decode(first.bytes)).toContain(
      'tags: ["zeta", "가나다", "Alpha"]',
    );
    expect(decoder.decode(reordered.bytes)).not.toBe(decoder.decode(first.bytes));
    expect(tags).toEqual(["zeta", "가나다", "Alpha"]);
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

  it("strictly rejects unknown document and category metadata fields", () => {
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
