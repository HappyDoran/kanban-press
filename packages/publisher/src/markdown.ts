import { z } from "zod";

import type { PublishArtifact } from "./index.js";
import { countManuscriptPages } from "./manuscript.js";

const MAX_BLOCK_DEPTH = 20;
const encoder = new TextEncoder();
const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const isoDateSchema = z.iso.datetime({ offset: true });
const tagSchema = z.string().trim().min(1).max(40);
const tagsSchema = z
  .array(tagSchema)
  .max(10)
  .superRefine((tags, context) => {
    const seen = new Set<string>();
    for (const [index, tag] of tags.entries()) {
      const normalizedTag = normalizeTag(tag);
      if (seen.has(normalizedTag)) {
        context.addIssue({
          code: "custom",
          message: "Tags must be unique after normalization",
          path: [index],
        });
      }
      seen.add(normalizedTag);
    }
  });
const richTextSchema = z
  .object({
    bold: z.boolean().optional(),
    code: z.boolean().optional(),
    href: z.string().max(2_048).nullable().optional(),
    italic: z.boolean().optional(),
    strikethrough: z.boolean().optional(),
    text: z.string().max(100_000),
  })
  .strict();

export type PublishRichText = z.infer<typeof richTextSchema>;

/** 게시 문서 블록. 단계마다 image 블록 모양만 다르다(Notion 원본 URL → 저장소 자산 경로). */
export type PublishBlockWith<Image> =
  | { children: PublishBlockWith<Image>[]; icon: string | null; kind: "callout"; richText: PublishRichText[] }
  | { kind: "code"; code: string; language: string }
  | { kind: "divider" }
  | { expression: string; kind: "equation" }
  | { kind: "heading"; level: 2 | 3 | 4 | 5; richText: PublishRichText[] }
  | Image
  | {
      children: PublishBlockWith<Image>[];
      kind: "listItem";
      richText: PublishRichText[];
      style: "bulleted" | "numbered";
    }
  | { caption: PublishRichText[]; kind: "linkCard"; url: string }
  | { caption: PublishRichText[]; kind: "media"; mediaType: "audio" | "file" | "pdf" | "video"; url: string | null }
  | { kind: "paragraph"; richText: PublishRichText[] }
  | { kind: "quote"; richText: PublishRichText[] }
  | { hasColumnHeader: boolean; hasRowHeader: boolean; kind: "table"; rows: PublishRichText[][][] }
  | { checked: boolean; children: PublishBlockWith<Image>[]; kind: "toDo"; richText: PublishRichText[] }
  | { children: PublishBlockWith<Image>[]; kind: "toggle"; summary: PublishRichText[] };

export type PublishBlock = PublishBlockWith<{ assetPath: string; caption: PublishRichText[]; kind: "image" }>;

const blockSchema: z.ZodType<PublishBlock> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z
      .object({
        children: z.array(blockSchema).max(5_000),
        icon: z.string().trim().min(1).max(16).nullable(),
        kind: z.literal("callout"),
        richText: z.array(richTextSchema).max(1_000),
      })
      .strict(),
    z
      .object({
        code: z.string().max(1_000_000),
        kind: z.literal("code"),
        language: z.string().max(64),
      })
      .strict(),
    z
      .object({
        children: z.array(blockSchema).max(5_000),
        kind: z.literal("listItem"),
        richText: z.array(richTextSchema).max(1_000),
        style: z.enum(["bulleted", "numbered"]),
      })
      .strict(),
    z.object({ kind: z.literal("divider") }).strict(),
    z
      .object({
        expression: z.string().max(100_000),
        kind: z.literal("equation"),
      })
      .strict(),
    z
      .object({
        kind: z.literal("heading"),
        level: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
        richText: z.array(richTextSchema).max(1_000),
      })
      .strict(),
    z
      .object({
        caption: z.array(richTextSchema).max(1_000),
        kind: z.literal("linkCard"),
        url: z.string().max(2_048),
      })
      .strict(),
    z
      .object({
        caption: z.array(richTextSchema).max(1_000),
        kind: z.literal("media"),
        mediaType: z.enum(["audio", "file", "pdf", "video"]),
        url: z.string().max(2_048).nullable(),
      })
      .strict(),
    z
      .object({
        assetPath: z
          .string()
          .max(240)
          .regex(
            /^\.\.\/\.\.\/assets\/blog\/[a-z0-9]+(?:-[a-z0-9]+)*\/image-\d{3}\.(?:gif|jpg|png|webp)$/,
          ),
        caption: z.array(richTextSchema).max(1_000),
        kind: z.literal("image"),
      })
      .strict(),
    z
      .object({
        kind: z.literal("paragraph"),
        richText: z.array(richTextSchema).max(1_000),
      })
      .strict(),
    z
      .object({
        kind: z.literal("quote"),
        richText: z.array(richTextSchema).max(1_000),
      })
      .strict(),
    z
      .object({
        hasColumnHeader: z.boolean(),
        hasRowHeader: z.boolean(),
        kind: z.literal("table"),
        rows: z
          .array(z.array(z.array(richTextSchema).max(1_000)).max(100))
          .max(1_000),
      })
      .strict(),
    z
      .object({
        checked: z.boolean(),
        children: z.array(blockSchema).max(5_000),
        kind: z.literal("toDo"),
        richText: z.array(richTextSchema).max(1_000),
      })
      .strict(),
    z
      .object({
        children: z.array(blockSchema).max(5_000),
        kind: z.literal("toggle"),
        summary: z.array(richTextSchema).max(1_000),
      })
      .strict(),
  ]),
);

const publishDocumentSchema = z
  .object({
    blocks: z.array(blockSchema).max(5_000),
    description: z.string().max(1_000),
    pinned: z.literal(true).optional(),
    publishedAt: isoDateSchema,
    schemaVersion: z.literal(2),
    slug: slugSchema,
    tags: tagsSchema,
    title: z.string().trim().min(1).max(2_000),
    updatedAt: isoDateSchema,
  })
  .strict();

export interface PublishDocument {
  blocks: PublishBlock[];
  description: string;
  /** 홈 상단 고정(R10). 고정할 때만 둔다. */
  pinned?: true;
  publishedAt: string;
  schemaVersion: 2;
  slug: string;
  tags: string[];
  title: string;
  updatedAt: string;
}

export function createMarkdownArtifact(
  input: PublishDocument,
): PublishArtifact {
  const document = publishDocumentSchema.parse(input) as PublishDocument;
  const body = renderBlocks(document.blocks, 0, document.slug);
  const manuscriptPages = countManuscriptPages(document.blocks);
  const frontmatter = [
    "---",
    `schemaVersion: ${document.schemaVersion}`,
    `title: ${frontmatterString(document.title)}`,
    `description: ${frontmatterString(document.description)}`,
    `tags: [${document.tags.map(frontmatterString).join(", ")}]`,
    `publishedAt: ${frontmatterString(document.publishedAt)}`,
    `updatedAt: ${frontmatterString(document.updatedAt)}`,
    // 판권의 분량(디자인 기획 2.4). 본문 글자가 없으면 쓰지 않는다.
    ...(manuscriptPages > 0 ? [`manuscriptPages: ${manuscriptPages}`] : []),
    // R10 필드는 값이 있을 때만 쓴다. 없으면 이전과 같은 Markdown이 나온다.
    ...(document.pinned === true ? ["pinned: true"] : []),
    "---",
  ].join("\n");
  const markdown = `${frontmatter}\n\n${body}`.trimEnd() + "\n";
  return {
    bytes: encoder.encode(markdown),
    path: `src/content/blog/${document.slug}.md`,
  };
}

function renderBlocks(
  blocks: readonly PublishBlock[],
  depth: number,
  documentSlug: string,
): string {
  if (depth > MAX_BLOCK_DEPTH) {
    throw new Error("Document block depth exceeds the safe limit");
  }
  const rendered: string[] = [];
  for (let index = 0; index < blocks.length; ) {
    const block = blocks[index];
    if (block === undefined) break;
    if (block.kind === "listItem" || block.kind === "toDo") {
      const list: string[] = [];
      while (index < blocks.length) {
        const item = blocks[index];
        if (item?.kind !== "listItem" && item?.kind !== "toDo") break;
        list.push(renderListItem(item, depth, documentSlug));
        index += 1;
      }
      rendered.push(list.join("\n"));
      continue;
    }
    const value = renderBlock(block, depth, documentSlug);
    if (value) rendered.push(value);
    index += 1;
  }
  return rendered.join("\n\n");
}

function renderBlock(
  block: PublishBlock,
  depth: number,
  documentSlug: string,
): string {
  switch (block.kind) {
    case "callout": {
      const icon = block.icon === null ? "💡" : escapeMarkdown(block.icon);
      const content = [
        `${icon} ${renderRichText(block.richText)}`.trim(),
        renderBlocks(block.children, depth + 1, documentSlug),
      ]
        .filter(Boolean)
        .join("\n\n");
      return content
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    }
    case "paragraph":
      return renderRichText(block.richText);
    case "heading":
      return `${"#".repeat(block.level)} ${renderRichText(block.richText)}`;
    case "quote":
      return renderRichText(block.richText)
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "code": {
      const fence = codeFence(block.code);
      const language = /^[A-Za-z0-9_+-]{1,32}$/.test(block.language)
        ? block.language
        : "text";
      return `${fence}${language}\n${normalizeNewlines(block.code)}\n${fence}`;
    }
    case "image": {
      const expectedPrefix = `../../assets/blog/${documentSlug}/`;
      if (!block.assetPath.startsWith(expectedPrefix)) {
        throw new Error("Image asset path must belong to the document");
      }
      const caption = escapeMarkdown(plainText(block.caption));
      return `![${caption}](<${block.assetPath}>)`;
    }
    case "listItem":
    case "toDo":
      return renderListItem(block, depth, documentSlug);
    case "table":
      return renderTable(block);
    case "toggle": {
      const summary = escapeHtml(plainText(block.summary));
      const children = renderBlocks(
        block.children,
        depth + 1,
        documentSlug,
      );
      return [
        "<details>",
        `<summary>${summary || "자세히 보기"}</summary>`,
        children ? `\n${children}\n` : "",
        "</details>",
      ]
        .filter((line) => line !== "")
        .join("\n");
    }
    case "divider":
      return "---";
    case "equation":
      return `<div class="notion-equation" role="math"><code>${escapeHtml(block.expression)}</code></div>`;
    case "linkCard":
      return renderResourceCard("링크", block.caption, block.url);
    case "media":
      return renderResourceCard(
        { audio: "오디오", file: "첨부 파일", pdf: "PDF", video: "동영상" }[
          block.mediaType
        ],
        block.caption,
        block.url,
      );
  }
}

function renderResourceCard(
  label: string,
  caption: readonly PublishRichText[],
  url: string | null,
): string {
  const content = renderRichTextHtml(caption, false) || escapeHtml(label);
  const safeHref = url === null
    ? null
    : safeUrl(url, new Set(["http:", "https:"]));
  const inner = `<span class="notion-resource-label">${escapeHtml(label)}</span><span>${content}</span>`;
  return safeHref === null
    ? `<div class="notion-resource-card">${inner}</div>`
    : `<a class="notion-resource-card" href="${escapeHtml(safeHref)}">${inner}</a>`;
}

function renderListItem(
  block: Extract<PublishBlock, { kind: "listItem" | "toDo" }>,
  depth: number,
  documentSlug: string,
): string {
  const marker =
    block.kind === "toDo"
      ? `- [${block.checked ? "x" : " "}]`
      : block.style === "numbered"
        ? "1."
        : "-";
  const children = renderBlocks(block.children, depth + 1, documentSlug);
  return [
    `${marker} ${renderRichText(block.richText)}`.trimEnd(),
    children
      ? children
          .split("\n")
          .map((line) => `   ${line}`)
          .join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderTable(
  block: Extract<PublishBlock, { kind: "table" }>,
): string {
  if (block.rows.length === 0) return "";
  const renderRow = (row: PublishRichText[][], rowIndex: number): string => {
    const cells = row.map((cell, columnIndex) => {
      const header =
        (block.hasColumnHeader && rowIndex === 0) ||
        (block.hasRowHeader && columnIndex === 0);
      const tag = header ? "th" : "td";
      const scope = header
        ? rowIndex === 0
          ? ' scope="col"'
          : ' scope="row"'
        : "";
      return `<${tag}${scope}>${renderRichTextHtml(cell)}</${tag}>`;
    });
    return `<tr>${cells.join("")}</tr>`;
  };
  const headerRows = block.hasColumnHeader ? block.rows.slice(0, 1) : [];
  const bodyRows = block.hasColumnHeader ? block.rows.slice(1) : block.rows;
  return [
    '<div class="notion-table-wrap">',
    "<table>",
    headerRows.length > 0
      ? `<thead>${headerRows.map((row, index) => renderRow(row, index)).join("")}</thead>`
      : "",
    `<tbody>${bodyRows
      .map((row, index) =>
        renderRow(row, index + (block.hasColumnHeader ? 1 : 0)),
      )
      .join("")}</tbody>`,
    "</table>",
    "</div>",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderRichText(parts: readonly PublishRichText[]): string {
  return typedBold(parts
    .map((part) => {
      let content = part.code
        ? inlineCode(part.text)
        : escapeMarkdown(part.text);
      // 강조는 `**` 대신 HTML 태그로 쓴다. `**임시(URL)**을`처럼 닫는 `**` 앞이 문장부호이고 뒤가 글자면
      // Markdown이 강조로 보지 않아 별표가 그대로 보인다. content는 이미 escape되어 있다.
      if (!part.code && part.bold) {
        content = emphasize("strong", content);
      }
      if (!part.code && part.italic) {
        content = emphasize("em", content);
      }
      if (!part.code && part.strikethrough) {
        content = emphasize("s", content);
      }
      const href =
        part.href === undefined || part.href === null
          ? null
          : safeUrl(part.href, new Set(["http:", "https:", "mailto:"]));
      return href === null
        ? content
        : `[${content}](<${escapeLinkDestination(href)}>)`;
    })
    .join(""));
}

function renderRichTextHtml(
  parts: readonly PublishRichText[],
  allowLinks = true,
): string {
  return parts
    .map((part) => {
      let content = escapeHtml(normalizeNewlines(part.text)).replaceAll(
        "\n",
        "<br>",
      );
      if (part.code) content = `<code>${content}</code>`;
      if (part.bold) content = `<strong>${content}</strong>`;
      if (part.italic) content = `<em>${content}</em>`;
      if (part.strikethrough) content = `<s>${content}</s>`;
      const href = allowLinks
        ? safeUrl(part.href ?? "", new Set(["http:", "https:", "mailto:"]))
        : null;
      return href === null
        ? content
        : `<a href="${escapeHtml(href)}">${content}</a>`;
    })
    .join("");
}

/**
 * Notion 글자에 Markdown처럼 직접 입력한 `**굵게**`를 굵게로 보인다(붙여 넣은 Markdown이 별표째 남는다).
 * 글자 조각을 이은 뒤 escape된 `\*\*…\*\*`를 한 줄 안에서만 짝짓는다. 사이에 인라인 코드가 있어도 되지만,
 * 인라인 코드 안의 글자는 바꾸지 않는다.
 */
function typedBold(content: string): string {
  const spans: string[] = [];
  const masked = content.replace(/(`+) [\s\S]*? \1(?!`)/g, (span) => {
    spans.push(span);
    return `\uE000${spans.length - 1}\uE000`;
  });
  return masked
    .replace(/\\\*\\\*((?:(?!\\\*\\\*)[^\n])+?)\\\*\\\*/g, "<strong>$1</strong>")
    .replace(/\uE000(\d+)\uE000/g, (_, index: string) => spans[Number(index)] ?? "");
}

/** 줄마다 따로 감싼다. 강조가 빈 줄을 넘어 여러 문단에 걸쳐도 태그가 문단 경계에서 끊기지 않는다. */
function emphasize(tag: "em" | "s" | "strong", content: string): string {
  return content
    .split("\n")
    .map((line) => (line.trim() === "" ? line : `<${tag}>${line}</${tag}>`))
    .join("\n");
}

/**
 * Markdown code span. 안의 글자는 Markdown 렌더러가 그대로 보여 주고 HTML escape도 렌더러가 한다.
 * 여기서 escape하면 `<`가 `&amp;lt;`로 두 번 escape되어 화면에 `&lt;`가 그대로 보인다.
 */
function inlineCode(value: string): string {
  const content = normalizeNewlines(value);
  const longestRun = Math.max(
    0,
    ...([...content.matchAll(/`+/g)].map((match) => match[0].length)),
  );
  const fence = "`".repeat(Math.max(1, longestRun + 1));
  return `${fence} ${content} ${fence}`;
}

function codeFence(value: string): string {
  const longestRun = Math.max(
    0,
    ...([...value.matchAll(/`+/g)].map((match) => match[0].length)),
  );
  return "`".repeat(Math.max(3, longestRun + 1));
}

function plainText(parts: readonly PublishRichText[]): string {
  return parts.map((part) => part.text).join("");
}

function escapeMarkdown(value: string): string {
  return escapeHtml(normalizeNewlines(value)).replace(
    /([\\`*_[\]{}()#+\-.!|>])/g,
    "\\$1",
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function frontmatterString(value: string): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function normalizeTag(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function safeUrl(
  value: string,
  protocols: ReadonlySet<string>,
): string | null {
  try {
    const url = new URL(value);
    return protocols.has(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function escapeLinkDestination(value: string): string {
  return value.replaceAll(">", "%3E").replaceAll("<", "%3C");
}
