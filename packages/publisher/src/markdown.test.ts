import { describe, expect, it } from "vitest";

import {
  countManuscriptPages,
  createMarkdownArtifact,
  type PublishBlock,
  type PublishDocument,
} from "./index.js";

const decoder = new TextDecoder();
const baseDocument = {
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
          assetPath: "../../assets/blog/hello-notion/image-001.png",
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
      "![대표 이미지](<../../assets/blog/hello-notion/image-001.png>)",
    );
    expect(markdown).toContain("<details>");
    expect(markdown).toContain("<summary>자세히 &lt;보기&gt;</summary>");
    expect(markdown).toContain("`` child()` ``");
  });

  it("keeps inline code literal so the Markdown renderer escapes it exactly once", () => {
    const markdown = decoder.decode(
      createMarkdownArtifact({
        ...baseDocument,
        blocks: [{ kind: "paragraph", richText: [{ code: true, text: "<app> & co" }] }],
      }).bytes,
    );
    expect(markdown).toContain("` <app> & co `");
    expect(markdown).not.toContain("&lt;");
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
        'tags: ["Notion", "Publishing"]',
        'publishedAt: "2026-07-19T01:00:00.000Z"',
        'updatedAt: "2026-07-19T02:00:00.000Z"',
        "manuscriptPages: 1",
        "---",
        "",
        "안전한 본문",
        "",
      ].join("\n"),
    );
  });

  it("writes pinned only when present and no removed category or series fields (R10)", () => {
    const markdown = decoder.decode(createMarkdownArtifact({ ...baseDocument, blocks: [], pinned: true }).bytes);
    expect(markdown).toContain('updatedAt: "2026-07-19T02:00:00.000Z"\npinned: true\n---');
    const plain = decoder.decode(createMarkdownArtifact({ ...baseDocument, blocks: [] }).bytes);
    expect(plain).not.toMatch(/pinned|series|category/);
    expect(() =>
      createMarkdownArtifact({ ...baseDocument, blocks: [], category: { name: "옛 주제", slug: "old" } } as PublishDocument),
    ).toThrow();
  });

  it("JSON-escapes frontmatter and escapes dangerous body content", () => {
    const artifact = createMarkdownArtifact({
      ...baseDocument,
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
  });

  it.each([
    "https://images.example.com/cover.png",
    "../../assets/blog/other-post/image-001.png",
    "../../assets/blog/hello-notion/../secret.png",
  ])(
    "rejects unsafe or foreign image asset path %s",
    (assetPath) => {
      expect(() =>
        createMarkdownArtifact({
          ...baseDocument,
          blocks: [{ assetPath, caption: [], kind: "image" }],
        }),
      ).toThrow();
    },
  );

  it("preserves nested lists, tasks, callouts, and semantic tables", () => {
    const artifact = createMarkdownArtifact({
      ...baseDocument,
      blocks: [
        {
          children: [
            {
              children: [],
              kind: "listItem",
              richText: [{ text: "중첩 항목" }],
              style: "numbered",
            },
          ],
          kind: "listItem",
          richText: [{ bold: true, text: "첫 항목" }],
          style: "bulleted",
        },
        {
          checked: true,
          children: [],
          kind: "toDo",
          richText: [{ text: "완료한 일" }],
        },
        {
          children: [{ kind: "paragraph", richText: [{ text: "추가 설명" }] }],
          icon: "📌",
          kind: "callout",
          richText: [{ italic: true, text: "중요 안내" }],
        },
        {
          hasColumnHeader: true,
          hasRowHeader: true,
          kind: "table",
          rows: [
            [[{ text: "항목" }], [{ text: "값" }]],
            [
              [{ bold: true, text: "안전" }],
              [{ href: "javascript:alert(1)", text: "<script>" }],
            ],
          ],
        },
        { expression: "E = mc^2 <script>", kind: "equation" },
        {
          caption: [{ text: "공식 문서" }],
          kind: "linkCard",
          url: "https://example.com/docs",
        },
        {
          caption: [{ text: "내부 첨부" }],
          kind: "media",
          mediaType: "file",
          url: null,
        },
      ],
    });
    const markdown = decoder.decode(artifact.bytes);

    expect(markdown).toContain("- **첫 항목**\n   1. 중첩 항목");
    expect(markdown).toContain("- [x] 완료한 일");
    expect(markdown).toContain("> 📌 *중요 안내*\n> \n> 추가 설명");
    expect(markdown).toContain('<div class="notion-table-wrap">');
    expect(markdown).toContain('<th scope="col">항목</th>');
    expect(markdown).toContain('<th scope="row"><strong>안전</strong></th>');
    expect(markdown).toContain("&lt;script&gt;");
    expect(markdown).toContain('class="notion-equation"');
    expect(markdown).toContain('class="notion-resource-card"');
    expect(markdown).toContain('href="https://example.com/docs"');
    expect(markdown).toContain("내부 첨부");
    expect(markdown).not.toContain("javascript:");
    expect(markdown).not.toContain("<script>");
  });

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

describe("countManuscriptPages", () => {
  const paragraph = (text: string): PublishBlock => ({ kind: "paragraph", richText: [{ text }] });

  it("counts written characters as 200-cell manuscript pages, rounding the last page up", () => {
    expect(countManuscriptPages([])).toBe(0);
    expect(countManuscriptPages([paragraph("가")])).toBe(1);
    expect(countManuscriptPages([paragraph("가".repeat(200))])).toBe(1);
    expect(countManuscriptPages([paragraph("가".repeat(201))])).toBe(2);
    // 공백은 한 칸, 줄바꿈은 세지 않는다. 이모지는 한 칸이다.
    expect(countManuscriptPages([paragraph(`${"a b".repeat(66)}\n\n😀😀`)])).toBe(1);
    expect(countManuscriptPages([paragraph(`${"a b".repeat(66)}😀😀😀`)])).toBe(2);
  });

  it("includes nested, table, toggle, and caption text but skips code and equations", () => {
    const blocks: PublishBlock[] = [
      { kind: "code", code: "x".repeat(1_000), language: "ts" },
      { expression: "y".repeat(1_000), kind: "equation" },
      { children: [paragraph("가".repeat(50))], kind: "toggle", summary: [{ text: "가".repeat(50) }] },
      { hasColumnHeader: false, hasRowHeader: false, kind: "table", rows: [[[{ text: "가".repeat(50) }]]] },
      { caption: [{ text: "가".repeat(51) }], kind: "linkCard", url: "https://example.com" },
    ];
    expect(countManuscriptPages(blocks)).toBe(2);
    expect(countManuscriptPages(blocks.slice(0, 2))).toBe(0);
  });
});
