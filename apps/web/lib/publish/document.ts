import { createHash } from "node:crypto";

import type {
  NotionContentBlock,
  NotionPageContent,
  NotionPageProperty,
} from "@notion-kanban-blog/notion";
import type {
  PublishBlockWith,
  PublishDocument,
  PublishRichText,
} from "@notion-kanban-blog/publisher";
import { z } from "zod";

import { pageIdSuffix } from "./blog-files";

const UNCATEGORIZED_NAME = "미분류";
const MAX_CATEGORY_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 1_000;
const MAX_TAG_COUNT = 10;
const MAX_TAG_LENGTH = 40;

const publishingDateSchema = z.iso.datetime({ offset: true });

type PublishingPropertyName =
  | "Blog Category"
  | "Blog Description"
  | "Blog Order"
  | "Blog Pinned"
  | "Blog Published At"
  | "Blog Series"
  | "Blog Slug"
  | "Blog Tags";
type BlogMetadataField =
  | PublishingPropertyName
  | "last_edited_time"
  | "title";

export interface BlogMetadata {
  category: { name: string; slug: string };
  description: string;
  pinned: boolean;
  publishedAt: string;
  series: { name: string; slug: string } | null;
  seriesOrder: number | null;
  tags: string[];
}

/** Notion에서 막 읽은 게시 블록. image는 아직 원본 URL을 들고 있고 image-assets.ts가 자산 경로로 바꾼다. */
export type PublishSourceBlock = PublishBlockWith<{ caption: PublishRichText[]; kind: "image"; sourceUrl: string }>;

export interface PublishSourceDocument
  extends Omit<PublishDocument, "blocks"> {
  blocks: PublishSourceBlock[];
}

export class InvalidBlogMetadataError extends Error {
  readonly code = "invalid_blog_metadata";
  override readonly name = "InvalidBlogMetadataError";

  constructor(readonly property: BlogMetadataField) {
    super(`Invalid blog metadata: ${property}`);
  }
}

export function deriveBlogMetadata(page: NotionPageContent): BlogMetadata {
  const properties = page.publishingProperties;
  const categoryName = category(properties?.["Blog Category"]);

  return {
    category: {
      name: categoryName,
      slug: categorySlug(categoryName),
    },
    description: description(
      properties?.["Blog Description"],
      page,
    ),
    publishedAt: publishedAt(
      properties?.["Blog Published At"],
      page.createdAt,
    ),
    tags: tags(properties?.["Blog Tags"]),
    ...seriesAndOrder(properties?.["Blog Series"], properties?.["Blog Order"]),
    pinned: pinned(properties?.["Blog Pinned"]),
  };
}

/** `Blog Slug` rich text. 비어 있으면 제목을 쓴다. 영문 소문자·숫자·하이픈 1~80자만 허용한다. */
function customSlug(property: NotionPageProperty | undefined): string | null {
  if (property === undefined) {
    return null;
  }
  if (property.kind !== "rich_text") {
    throw new InvalidBlogMetadataError("Blog Slug");
  }
  const value = property.plainText.trim();
  if (value === "") {
    return null;
  }
  if (value.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new InvalidBlogMetadataError("Blog Slug");
  }
  return value;
}

/** `Blog Pinned` checkbox. 없으면 고정하지 않는다. */
function pinned(property: NotionPageProperty | undefined): boolean {
  if (property === undefined) {
    return false;
  }
  if (property.kind !== "checkbox") {
    throw new InvalidBlogMetadataError("Blog Pinned");
  }
  return property.checked;
}

/** `Blog Series` select(비어 있으면 시리즈 없음)와 `Blog Order` number. 순서는 시리즈가 있을 때만 쓴다. */
function seriesAndOrder(
  seriesProperty: NotionPageProperty | undefined,
  orderProperty: NotionPageProperty | undefined,
): Pick<BlogMetadata, "series" | "seriesOrder"> {
  if (seriesProperty !== undefined && seriesProperty.kind !== "select") {
    throw new InvalidBlogMetadataError("Blog Series");
  }
  if (orderProperty !== undefined && orderProperty.kind !== "number") {
    throw new InvalidBlogMetadataError("Blog Order");
  }
  const name = seriesProperty?.name?.trim() ?? "";
  if (name.length > MAX_CATEGORY_LENGTH) {
    throw new InvalidBlogMetadataError("Blog Series");
  }
  const order = orderProperty?.value ?? null;
  if (order !== null && Math.abs(order) > 1_000_000) {
    throw new InvalidBlogMetadataError("Blog Order");
  }
  return name === ""
    ? { series: null, seriesOrder: null }
    : { series: { name, slug: categorySlug(name) }, seriesOrder: order };
}

export function buildPublishDocument(
  page: NotionPageContent,
): PublishSourceDocument {
  const metadata = deriveBlogMetadata(page);
  const title = page.title.trim();
  if (!title || title === "제목 없음") {
    throw new InvalidBlogMetadataError("title");
  }

  return {
    blocks: page.blocks.flatMap(toPublishBlock),
    category: metadata.category,
    description: metadata.description,
    publishedAt: metadata.publishedAt,
    schemaVersion: 2,
    slug: pageSlug(title, page.providerPageId, customSlug(page.publishingProperties?.["Blog Slug"])),
    tags: metadata.tags,
    title,
    updatedAt: validDate(page.lastEditedAt, "last_edited_time"),
    ...(metadata.pinned ? { pinned: true as const } : {}),
    ...(metadata.series === null ? {} : { series: metadata.series }),
    ...(metadata.seriesOrder === null ? {} : { seriesOrder: metadata.seriesOrder }),
  };
}

export function categorySlug(name: string): string {
  if (name === UNCATEGORIZED_NAME) {
    return "uncategorized";
  }

  const normalized = name
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
  const hash = createHash("sha256")
    .update(normalized, "utf8")
    .digest("hex")
    .slice(0, 8);
  const base = normalized
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");

  return base ? `${base}-${hash}` : `category-${hash}`;
}

/**
 * 글 주소 `<앞부분>-<page ID 앞 12자>`. 앞부분은 `Blog Slug`가 있으면 그 값, 없으면 제목에서 영문·숫자만 남긴 값이다.
 * 접미사는 늘 page ID라 주소를 바꿔도 같은 글로 찾고 옛 주소 안내 page를 남긴다(R8·R11).
 */
export function pageSlug(title: string, providerPageId: string, custom: string | null = null): string {
  const suffix = pageIdSuffix(providerPageId);
  const base =
    custom ??
    (title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/g, "") || "notion");
  return `${base}-${suffix}`;
}

function category(property: NotionPageProperty | undefined): string {
  if (property === undefined) {
    return UNCATEGORIZED_NAME;
  }
  if (
    !isObject(property) ||
    property.kind !== "select" ||
    typeof property.name !== "string"
  ) {
    throw new InvalidBlogMetadataError("Blog Category");
  }
  const name = property.name.trim();
  if (name.length < 1 || name.length > MAX_CATEGORY_LENGTH) {
    throw new InvalidBlogMetadataError("Blog Category");
  }
  return name;
}

function tags(property: NotionPageProperty | undefined): string[] {
  if (property === undefined) {
    return [];
  }
  if (
    !isObject(property) ||
    property.kind !== "multi_select" ||
    !Array.isArray(property.names)
  ) {
    throw new InvalidBlogMetadataError("Blog Tags");
  }

  const unique = new Map<string, string>();
  for (const value of property.names) {
    if (typeof value !== "string") {
      throw new InvalidBlogMetadataError("Blog Tags");
    }
    const tag = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
    if (tag.length < 1 || tag.length > MAX_TAG_LENGTH) {
      throw new InvalidBlogMetadataError("Blog Tags");
    }
    const key = tag.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, tag);
    }
  }
  if (unique.size > MAX_TAG_COUNT) {
    throw new InvalidBlogMetadataError("Blog Tags");
  }
  return [...unique.values()];
}

function description(
  property: NotionPageProperty | undefined,
  page: NotionPageContent,
): string {
  if (property === undefined) {
    return fallbackDescription(page);
  }
  if (
    !isObject(property) ||
    property.kind !== "rich_text" ||
    typeof property.plainText !== "string"
  ) {
    throw new InvalidBlogMetadataError("Blog Description");
  }
  const text = property.plainText;
  if (text.length > MAX_DESCRIPTION_LENGTH) {
    throw new InvalidBlogMetadataError("Blog Description");
  }
  return text;
}

function fallbackDescription(page: NotionPageContent): string {
  for (const block of page.blocks) {
    if (
      block.kind === "paragraph" ||
      block.kind === "quote" ||
      block.kind === "heading"
    ) {
      const text = block.richText.map((part) => part.text).join("").trim();
      if (text) {
        return text.slice(0, MAX_DESCRIPTION_LENGTH);
      }
    }
  }
  return page.title.slice(0, MAX_DESCRIPTION_LENGTH);
}

function publishedAt(
  property: NotionPageProperty | undefined,
  createdAt: Date,
): string {
  if (property === undefined) {
    return validDate(createdAt, "Blog Published At");
  }
  if (
    !isObject(property) ||
    property.kind !== "date" ||
    typeof property.start !== "string" ||
    !publishingDateSchema.safeParse(property.start).success
  ) {
    throw new InvalidBlogMetadataError("Blog Published At");
  }
  const parsed = new Date(property.start);
  return validDate(parsed, "Blog Published At");
}

function validDate(date: Date, property: BlogMetadataField): string {
  if (!Number.isFinite(date.getTime())) {
    throw new InvalidBlogMetadataError(property);
  }
  return date.toISOString();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toPublishBlock(block: NotionContentBlock): PublishSourceBlock[] {
  switch (block.kind) {
    case "heading":
      return [
        {
          kind: "heading",
          level: (block.level + 1) as 2 | 3 | 4,
          richText: block.richText,
        },
      ];
    case "toggle":
      return [
        {
          children: block.children.flatMap(toPublishBlock),
          kind: "toggle",
          summary: block.summary,
        },
      ];
    case "listItem":
      return [
        {
          ...block,
          children: block.children.flatMap(toPublishBlock),
        },
      ];
    case "toDo":
      return [
        {
          ...block,
          children: block.children.flatMap(toPublishBlock),
        },
      ];
    case "callout":
      return [
        {
          ...block,
          children: block.children.flatMap(toPublishBlock),
        },
      ];
    case "image":
      return [
        {
          caption: block.caption,
          kind: "image",
          sourceUrl: block.url,
        },
      ];
    case "tableRow":
      return [];
    default:
      return [block];
  }
}
