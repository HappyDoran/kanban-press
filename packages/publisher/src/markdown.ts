import { z } from "zod";

import type { PublishArtifact } from "./index.js";

const MAX_BLOCK_DEPTH = 20;
const encoder = new TextEncoder();
const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const isoDateSchema = z.iso.datetime({ offset: true });
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

export type PublishBlock =
  | { kind: "code"; code: string; language: string }
  | { kind: "divider" }
  | { kind: "heading"; level: 2 | 3 | 4; richText: PublishRichText[] }
  | { kind: "image"; caption: PublishRichText[]; url: string }
  | { kind: "paragraph"; richText: PublishRichText[] }
  | { kind: "quote"; richText: PublishRichText[] }
  | {
      kind: "toggle";
      children: PublishBlock[];
      summary: PublishRichText[];
    };

const blockSchema: z.ZodType<PublishBlock> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z
      .object({
        code: z.string().max(1_000_000),
        kind: z.literal("code"),
        language: z.string().max(64),
      })
      .strict(),
    z.object({ kind: z.literal("divider") }).strict(),
    z
      .object({
        kind: z.literal("heading"),
        level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
        richText: z.array(richTextSchema).max(1_000),
      })
      .strict(),
    z
      .object({
        caption: z.array(richTextSchema).max(1_000),
        kind: z.literal("image"),
        url: z.string().max(4_096),
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
    publishedAt: isoDateSchema,
    slug: slugSchema,
    title: z.string().trim().min(1).max(2_000),
    updatedAt: isoDateSchema,
  })
  .strict();

export interface PublishDocument {
  blocks: PublishBlock[];
  description: string;
  publishedAt: string;
  slug: string;
  title: string;
  updatedAt: string;
}

export function createMarkdownArtifact(
  input: PublishDocument,
): PublishArtifact {
  const document = publishDocumentSchema.parse(input) as PublishDocument;
  const body = renderBlocks(document.blocks, 0);
  const frontmatter = [
    "---",
    `title: ${frontmatterString(document.title)}`,
    `description: ${frontmatterString(document.description)}`,
    `publishedAt: ${frontmatterString(document.publishedAt)}`,
    `updatedAt: ${frontmatterString(document.updatedAt)}`,
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
): string {
  if (depth > MAX_BLOCK_DEPTH) {
    throw new Error("Document block depth exceeds the safe limit");
  }
  return blocks
    .map((block) => renderBlock(block, depth))
    .filter(Boolean)
    .join("\n\n");
}

function renderBlock(block: PublishBlock, depth: number): string {
  switch (block.kind) {
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
      const url = safeUrl(block.url, new Set(["https:"]));
      if (url === null) {
        throw new Error("Image URL must use HTTPS");
      }
      const caption = escapeMarkdown(plainText(block.caption));
      return `![${caption}](<${escapeLinkDestination(url)}>)`;
    }
    case "toggle": {
      const summary = escapeHtml(plainText(block.summary));
      const children = renderBlocks(block.children, depth + 1);
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
  }
}

function renderRichText(parts: readonly PublishRichText[]): string {
  return parts
    .map((part) => {
      let content = part.code
        ? inlineCode(part.text)
        : escapeMarkdown(part.text);
      if (!part.code && part.bold) {
        content = `**${content}**`;
      }
      if (!part.code && part.italic) {
        content = `*${content}*`;
      }
      if (!part.code && part.strikethrough) {
        content = `~~${content}~~`;
      }
      const href =
        part.href === undefined || part.href === null
          ? null
          : safeUrl(part.href, new Set(["http:", "https:", "mailto:"]));
      return href === null
        ? content
        : `[${content}](<${escapeLinkDestination(href)}>)`;
    })
    .join("");
}

function inlineCode(value: string): string {
  const content = escapeHtml(normalizeNewlines(value));
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
