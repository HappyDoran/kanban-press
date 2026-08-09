import { createHash } from "node:crypto";

import type {
  NotionContentBlock,
  NotionPageContent,
} from "@notion-kanban-blog/notion";
import type {
  PublishBlock,
  PublishDocument,
} from "@notion-kanban-blog/publisher";
import { z } from "zod";

const UNCATEGORIZED_NAME = "미분류";
const MAX_CATEGORY_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 1_000;
const MAX_TAG_COUNT = 10;
const MAX_TAG_LENGTH = 40;

const publishingDateSchema = z.iso.datetime({ offset: true });

type PublishingPropertyName =
  | "Blog Category"
  | "Blog Description"
  | "Blog Published At"
  | "Blog Tags";

type PublishingProperty =
  | { readonly kind: "select"; readonly name: string | null }
  | { readonly kind: "multi_select"; readonly names: readonly string[] }
  | { readonly kind: "rich_text"; readonly plainText: string }
  | { readonly kind: "date"; readonly start: string | null }
  | { readonly kind: "unsupported"; readonly providerType: string };

type PageWithPublishingProperties = NotionPageContent & {
  readonly publishingProperties?: Readonly<
    Partial<Record<PublishingPropertyName, PublishingProperty>>
  >;
};

export interface BlogMetadata {
  category: { name: string; slug: string };
  description: string;
  publishedAt: string;
  tags: string[];
}

export type PublishDocumentV2 = PublishDocument & {
  category: BlogMetadata["category"];
  schemaVersion: 2;
  tags: string[];
};

export class InvalidBlogMetadataError extends Error {
  readonly code = "invalid_blog_metadata";
  override readonly name = "InvalidBlogMetadataError";

  constructor(readonly property: PublishingPropertyName) {
    super(`Invalid blog metadata: ${property}`);
  }
}

export function deriveBlogMetadata(page: NotionPageContent): BlogMetadata {
  const properties = (page as PageWithPublishingProperties)
    .publishingProperties;
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
  };
}

export function buildPublishDocument(
  page: NotionPageContent,
): PublishDocumentV2 {
  const metadata = deriveBlogMetadata(page);

  return {
    blocks: page.blocks.flatMap(toPublishBlock),
    category: metadata.category,
    description: metadata.description,
    publishedAt: metadata.publishedAt,
    schemaVersion: 2,
    slug: pageSlug(page.title, page.providerPageId),
    tags: metadata.tags,
    title: page.title,
    updatedAt: validDate(page.lastEditedAt, "Blog Published At"),
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

export function pageSlug(title: string, providerPageId: string): string {
  const suffix = providerPageId.replaceAll("-", "").slice(0, 12).toLowerCase();
  if (!/^[a-f0-9]{12}$/.test(suffix)) {
    throw new Error("Invalid Notion page ID");
  }
  const base =
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/g, "") || "notion";
  return `${base}-${suffix}`;
}

function category(property: PublishingProperty | undefined): string {
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

function tags(property: PublishingProperty | undefined): string[] {
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
  property: PublishingProperty | undefined,
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
  property: PublishingProperty | undefined,
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

function validDate(date: Date, property: PublishingPropertyName): string {
  if (!Number.isFinite(date.getTime())) {
    throw new InvalidBlogMetadataError(property);
  }
  return date.toISOString();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toPublishBlock(block: NotionContentBlock): PublishBlock[] {
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
    default:
      return [block];
  }
}
