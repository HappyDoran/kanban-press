import { z } from "zod";

import type {
  PublishRichText,
} from "@notion-kanban-blog/publisher";

import type {
  PublishSourceBlock,
  PublishSourceDocument,
} from "./document";

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
  | { code: string; kind: "code"; language: string }
  | { kind: "divider" }
  | { kind: "heading"; level: 2 | 3 | 4; richText: PreviewRichText[] }
  | { caption: PreviewRichText[]; kind: "image" }
  | { kind: "paragraph"; richText: PreviewRichText[] }
  | { kind: "quote"; richText: PreviewRichText[] }
  | {
      children: PreviewBlock[];
      kind: "toggle";
      summary: PreviewRichText[];
    };

const previewBlockSchema: z.ZodType<PreviewBlock> = z.lazy(() =>
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
        richText: z.array(previewRichTextSchema).max(1_000),
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
    category: z
      .object({
        name: z.string().trim().min(1).max(80),
        slug: slugSchema,
      })
      .strict(),
    description: z.string().max(1_000),
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

export function createPublishPreviewResponse(
  document: PublishSourceDocument,
  sourceLastEditedAt: string,
): PublishPreviewResponse {
  const projection = projectBlocks(document.blocks, 0);
  const preview = publishPreviewResponseSchema.parse({
    document: {
      blocks: projection.blocks,
      category: document.category,
      description: document.description,
      publishedAt: document.publishedAt,
      slug: document.slug,
      tags: document.tags,
      title: document.title,
      updatedAt: document.updatedAt,
    },
    previewSchemaVersion: 1,
    sourceLastEditedAt,
    templateVersion: 2,
    warnings: projection.hasImage
      ? [
          {
            code: "image_placeholder",
            message:
              "이미지 주소는 안전을 위해 프리뷰에 포함하지 않으며 자리표시자로 보여줍니다.",
          },
        ]
      : [],
  });
  if (
    new TextEncoder().encode(JSON.stringify(preview)).byteLength >
    MAX_PREVIEW_RESPONSE_BYTES
  ) {
    throw new Error("Preview response exceeds the safe size limit");
  }
  return preview;
}

export function parsePublishPreviewResponse(
  value: unknown,
): PublishPreviewResponse | null {
  const result = publishPreviewResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}

function projectBlocks(
  blocks: readonly PublishSourceBlock[],
  depth: number,
): { blocks: PreviewBlock[]; hasImage: boolean } {
  if (depth > MAX_BLOCK_DEPTH) {
    throw new Error("Preview block depth exceeds the safe limit");
  }
  let hasImage = false;
  const projected = blocks.map((block): PreviewBlock => {
    switch (block.kind) {
      case "code":
        return { code: block.code, kind: "code", language: block.language };
      case "divider":
        return { kind: "divider" };
      case "heading":
        return {
          kind: "heading",
          level: block.level,
          richText: projectRichText(block.richText),
        };
      case "image":
        hasImage = true;
        return {
          caption: projectRichText(block.caption),
          kind: "image",
        };
      case "paragraph":
      case "quote":
        return {
          kind: block.kind,
          richText: projectRichText(block.richText),
        };
      case "toggle": {
        const children = projectBlocks(block.children, depth + 1);
        hasImage ||= children.hasImage;
        return {
          children: children.blocks,
          kind: "toggle",
          summary: projectRichText(block.summary),
        };
      }
    }
  });
  return { blocks: projected, hasImage };
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
