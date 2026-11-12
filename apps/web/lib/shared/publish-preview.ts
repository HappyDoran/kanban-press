import { z } from "zod";

import type {
  PublishRichText,
} from "@kanban-press/publisher";

import type {
  PublishSourceBlock,
  PublishSourceDocument,
} from "@/lib/server/publish/document";

const MAX_BLOCK_DEPTH = 20;
const MAX_PREVIEW_RESPONSE_BYTES = 2_000_000;
const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const isoDateSchema = z.iso.datetime({ offset: true });
const previewHrefSchema = z
  .string()
  .max(2_048)
  .refine((value) => safePreviewHref(value) !== null)
  .nullable();
const previewRichTextSchema = z
  .object({
    bold: z.boolean(),
    code: z.boolean(),
    href: previewHrefSchema,
    italic: z.boolean(),
    strikethrough: z.boolean(),
    text: z.string().max(100_000),
  })
  .strict();

export type PreviewRichText = z.infer<typeof previewRichTextSchema>;

export type PreviewBlock =
  | {
      children: PreviewBlock[];
      icon: string | null;
      kind: "callout";
      richText: PreviewRichText[];
    }
  | { code: string; kind: "code"; language: string }
  | { kind: "divider" }
  | { expression: string; kind: "equation" }
  | { kind: "heading"; level: 2 | 3 | 4 | 5; richText: PreviewRichText[] }
  | { caption: PreviewRichText[]; kind: "image" }
  | {
      children: PreviewBlock[];
      kind: "listItem";
      richText: PreviewRichText[];
      style: "bulleted" | "numbered";
    }
  | { caption: PreviewRichText[]; href: string | null; kind: "linkCard" }
  | {
      caption: PreviewRichText[];
      href: string | null;
      kind: "media";
      mediaType: "audio" | "file" | "pdf" | "video";
    }
  | { kind: "paragraph"; richText: PreviewRichText[] }
  | { kind: "quote"; richText: PreviewRichText[] }
  | {
      hasColumnHeader: boolean;
      hasRowHeader: boolean;
      kind: "table";
      rows: PreviewRichText[][][];
    }
  | {
      checked: boolean;
      children: PreviewBlock[];
      kind: "toDo";
      richText: PreviewRichText[];
    }
  | {
      children: PreviewBlock[];
      kind: "toggle";
      summary: PreviewRichText[];
    };

const previewBlockSchema: z.ZodType<PreviewBlock> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z
      .object({
        children: z.array(previewBlockSchema).max(5_000),
        icon: z.string().trim().min(1).max(16).nullable(),
        kind: z.literal("callout"),
        richText: z.array(previewRichTextSchema).max(1_000),
      })
      .strict(),
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
        expression: z.string().max(100_000),
        kind: z.literal("equation"),
      })
      .strict(),
    z
      .object({
        kind: z.literal("heading"),
        level: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
        richText: z.array(previewRichTextSchema).max(1_000),
      })
      .strict(),
    z
      .object({
        caption: z.array(previewRichTextSchema).max(1_000),
        href: previewHrefSchema,
        kind: z.literal("linkCard"),
      })
      .strict(),
    z
      .object({
        caption: z.array(previewRichTextSchema).max(1_000),
        href: previewHrefSchema,
        kind: z.literal("media"),
        mediaType: z.enum(["audio", "file", "pdf", "video"]),
      })
      .strict(),
    z
      .object({
        caption: z.array(previewRichTextSchema).max(1_000),
        kind: z.literal("image"),
      })
      .strict(),
    z
      .object({
        children: z.array(previewBlockSchema).max(5_000),
        kind: z.literal("listItem"),
        richText: z.array(previewRichTextSchema).max(1_000),
        style: z.enum(["bulleted", "numbered"]),
      })
      .strict(),
    z
      .object({
        kind: z.literal("paragraph"),
        richText: z.array(previewRichTextSchema).max(1_000),
      })
      .strict(),
    z
      .object({
        kind: z.literal("quote"),
        richText: z.array(previewRichTextSchema).max(1_000),
      })
      .strict(),
    z
      .object({
        hasColumnHeader: z.boolean(),
        hasRowHeader: z.boolean(),
        kind: z.literal("table"),
        rows: z
          .array(z.array(z.array(previewRichTextSchema).max(1_000)).max(100))
          .max(1_000),
      })
      .strict(),
    z
      .object({
        checked: z.boolean(),
        children: z.array(previewBlockSchema).max(5_000),
        kind: z.literal("toDo"),
        richText: z.array(previewRichTextSchema).max(1_000),
      })
      .strict(),
    z
      .object({
        children: z.array(previewBlockSchema).max(5_000),
        kind: z.literal("toggle"),
        summary: z.array(previewRichTextSchema).max(1_000),
      })
      .strict(),
  ]),
);

const previewDocumentSchema = z
  .object({
    blocks: z.array(previewBlockSchema).max(5_000),
    description: z.string().max(1_000),
    // R10. 값이 있을 때만 온다.
    pinned: z.literal(true).optional(),
    publishedAt: isoDateSchema,
    slug: slugSchema,
    tags: z.array(z.string().trim().min(1).max(40)).max(10),
    title: z.string().trim().min(1).max(2_000),
    updatedAt: isoDateSchema,
  })
  .strict();

const previewWarningSchema = z
  .object({
    code: z.literal("image_placeholder"),
    message: z.string().min(1).max(300),
  })
  .strict();

export const publishPreviewResponseSchema = z
  .object({
    document: previewDocumentSchema,
    previewSchemaVersion: z.literal(1),
    sourceLastEditedAt: isoDateSchema,
    templateVersion: z.literal(2),
    warnings: z.array(previewWarningSchema).max(20),
  })
  .strict();

export type PublishPreviewResponse = z.infer<
  typeof publishPreviewResponseSchema
>;

/** 게시 문서를 프리뷰 응답으로 바꾼다. 이미지 원본 URL(Notion 서명 URL)은 넣지 않고 자리표시자로 둔다. */
export function createPublishPreviewResponse(
  document: PublishSourceDocument,
  sourceLastEditedAt: string,
): PublishPreviewResponse {
  const seen = { image: false };
  const preview = publishPreviewResponseSchema.parse({
    document: {
      blocks: projectBlocks(document.blocks, 0, seen),
      description: document.description,
      publishedAt: document.publishedAt,
      slug: document.slug,
      tags: document.tags,
      title: document.title,
      updatedAt: document.updatedAt,
      ...(document.pinned === true ? { pinned: true } : {}),
    },
    previewSchemaVersion: 1,
    sourceLastEditedAt,
    templateVersion: 2,
    warnings: seen.image
      ? [
          {
            code: "image_placeholder",
            message: "이미지 주소는 안전을 위해 프리뷰에 포함하지 않으며 자리표시자로 보여줍니다.",
          },
        ]
      : [],
  });
  if (new TextEncoder().encode(JSON.stringify(preview)).byteLength > MAX_PREVIEW_RESPONSE_BYTES) {
    throw new Error("Preview response exceeds the safe size limit");
  }
  return preview;
}

export function parsePublishPreviewResponse(value: unknown): PublishPreviewResponse | null {
  const result = publishPreviewResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}

function projectBlocks(
  blocks: readonly PublishSourceBlock[],
  depth: number,
  seen: { image: boolean },
): PreviewBlock[] {
  if (depth > MAX_BLOCK_DEPTH) {
    throw new Error("Preview block depth exceeds the safe limit");
  }
  const children = (items: readonly PublishSourceBlock[]) => projectBlocks(items, depth + 1, seen);
  return blocks.map((block): PreviewBlock => {
    switch (block.kind) {
      case "code":
      case "divider":
      case "equation":
        return block;
      case "heading":
      case "paragraph":
      case "quote":
        return { ...block, richText: projectRichText(block.richText) };
      case "callout":
      case "listItem":
      case "toDo":
        return { ...block, children: children(block.children), richText: projectRichText(block.richText) };
      case "toggle":
        return { children: children(block.children), kind: "toggle", summary: projectRichText(block.summary) };
      case "image":
        seen.image = true;
        return { caption: projectRichText(block.caption), kind: "image" };
      case "linkCard":
        return { caption: projectRichText(block.caption), href: safePreviewHref(block.url), kind: "linkCard" };
      case "media":
        return {
          caption: projectRichText(block.caption),
          href: safePreviewHref(block.url),
          kind: "media",
          mediaType: block.mediaType,
        };
      case "table":
        return { ...block, rows: block.rows.map((row) => row.map(projectRichText)) };
    }
  });
}

function projectRichText(parts: readonly PublishRichText[]): PreviewRichText[] {
  return parts.map((part) => ({
    bold: part.bold === true,
    code: part.code === true,
    href: safePreviewHref(part.href),
    italic: part.italic === true,
    strikethrough: part.strikethrough === true,
    text: part.text,
  }));
}

function safePreviewHref(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      !["http:", "https:", "mailto:"].includes(url.protocol) ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
