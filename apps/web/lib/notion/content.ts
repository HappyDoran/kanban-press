import type {
  NotionContentBlock,
  NotionContentAdapter,
  NotionOutlineNode,
  NotionPageContent,
  NotionPageProperty,
  NotionPageSummary,
  NotionRichText,
} from "@notion-kanban-blog/notion";
import { z } from "zod";

const NOTION_SEARCH_URL = "https://api.notion.com/v1/search";
const NOTION_BLOCKS_URL = "https://api.notion.com/v1/blocks";
const NOTION_PAGES_URL = "https://api.notion.com/v1/pages";
const PAGE_SIZE = 100;
const MAX_PAGES = 10_000;
const MAX_OUTLINE_BLOCKS = 5_000;
const MAX_OUTLINE_DEPTH = 20;
const MAX_NOTION_ARRAY_ITEMS = 100;
const MAX_NOTION_TEXT_LENGTH = 2_000;
const MAX_PUBLISHING_PROPERTIES_BYTES = 500_000;

const publishingPropertyTypes = {
  "Blog Category": "select",
  "Blog Description": "rich_text",
  "Blog Published At": "date",
  "Blog Tags": "multi_select",
} as const;
type PublishingPropertyName = keyof typeof publishingPropertyTypes;
const publishingPropertyNames = Object.keys(
  publishingPropertyTypes,
) as PublishingPropertyName[];
const textEncoder = new TextEncoder();

const richTextSchema = z
  .object({
    annotations: z
      .object({
        bold: z.boolean().optional(),
        code: z.boolean().optional(),
        italic: z.boolean().optional(),
        strikethrough: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    href: z.string().max(4_096).nullable().optional(),
    plain_text: z.string(),
  })
  .passthrough();

const propertyRichTextSchema = richTextSchema.extend({
  plain_text: z.string().max(MAX_NOTION_TEXT_LENGTH),
});

const propertyEnvelopeSchema = z
  .object({
    id: z.string().min(1).max(255),
    type: z.string().min(1).max(255),
  })
  .passthrough();
const selectPropertySchema = propertyEnvelopeSchema.extend({
  select: z
    .object({ name: z.string().max(MAX_NOTION_TEXT_LENGTH) })
    .passthrough()
    .nullable(),
  type: z.literal("select"),
});
const multiSelectPropertySchema = propertyEnvelopeSchema.extend({
  multi_select: z
    .array(
      z
        .object({ name: z.string().max(MAX_NOTION_TEXT_LENGTH) })
        .passthrough(),
    )
    .max(MAX_NOTION_ARRAY_ITEMS),
  type: z.literal("multi_select"),
});
const richTextPropertySchema = propertyEnvelopeSchema.extend({
  rich_text: z.array(propertyRichTextSchema).max(MAX_NOTION_ARRAY_ITEMS),
  type: z.literal("rich_text"),
});
const datePropertySchema = propertyEnvelopeSchema.extend({
  date: z
    .object({ start: z.string().min(1).max(MAX_NOTION_TEXT_LENGTH) })
    .passthrough()
    .nullable(),
  type: z.literal("date"),
});

const titlePropertySchema = z
  .object({
    title: z.array(richTextSchema),
    type: z.literal("title"),
  })
  .passthrough();

const pageSchema = z
  .object({
    icon: z.unknown().nullable().optional(),
    id: z.string().min(1).max(255),
    in_trash: z.boolean().optional(),
    last_edited_time: z.iso.datetime({ offset: true }),
    object: z.literal("page"),
    parent: z
      .object({
        block_id: z.string().min(1).max(255).optional(),
        data_source_id: z.string().min(1).max(255).optional(),
        database_id: z.string().min(1).max(255).optional(),
        page_id: z.string().min(1).max(255).optional(),
        type: z.string(),
      })
      .passthrough(),
    properties: z.record(z.string(), z.unknown()),
  })
  .passthrough();
const dataSourceSchema = z
  .object({
    database_parent: z
      .object({
        page_id: z.string().min(1).max(255).optional(),
        type: z.string(),
      })
      .passthrough(),
    id: z.string().min(1).max(255),
    object: z.literal("data_source"),
  })
  .passthrough();
const retrievedPageSchema = pageSchema.extend({
  created_time: z.iso.datetime({ offset: true }),
});

const searchResponseSchema = z
  .object({
    has_more: z.boolean(),
    next_cursor: z.string().min(1).nullable(),
    results: z.array(z.unknown()),
  })
  .passthrough();
const blockSchema = z
  .object({
    child_database: z
      .object({ title: z.string() })
      .passthrough()
      .optional(),
    child_page: z
      .object({ title: z.string() })
      .passthrough()
      .optional(),
    has_children: z.boolean(),
    id: z.string().min(1).max(255),
    link_to_page: z
      .object({
        database_id: z.string().min(1).max(255).optional(),
        page_id: z.string().min(1).max(255).optional(),
        type: z.string(),
      })
      .passthrough()
      .optional(),
    object: z.literal("block"),
    synced_block: z
      .object({
        synced_from: z
          .object({
            block_id: z.string().min(1).max(255).optional(),
            type: z.string(),
          })
          .passthrough()
          .nullable(),
      })
      .passthrough()
      .optional(),
    toggle: z
      .object({ rich_text: z.array(richTextSchema) })
      .passthrough()
      .optional(),
    type: z.string(),
  })
  .passthrough();

interface NotionRestContentAdapterOptions {
  accessToken: string;
  apiVersion: string;
  fetch?: typeof fetch;
}

interface DiscoveredPage extends NotionPageSummary {
  parentDataSourceId: string | null;
}

type NotionProviderErrorCode =
  | "access_denied"
  | "invalid_response"
  | "rate_limited"
  | "unavailable";

export class NotionProviderError extends Error {
  override readonly name = "NotionProviderError";

  constructor(
    readonly code: NotionProviderErrorCode,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`Notion provider request failed: ${code}`);
  }
}

export class NotionRestContentAdapter implements NotionContentAdapter {
  readonly #accessToken: string;
  readonly #apiVersion: string;
  readonly #fetch: typeof fetch;

  constructor(options: NotionRestContentAdapterOptions) {
    this.#accessToken = options.accessToken;
    this.#apiVersion = options.apiVersion;
    this.#fetch = options.fetch ?? fetch;
  }

  async listPageTree(): Promise<readonly NotionPageSummary[]> {
    const pages = await this.#listAllPages();
    const parentDataSourceIds = new Set(
      pages.flatMap((page) =>
        page.parentDataSourceId === null
          ? []
          : [page.parentDataSourceId],
      ),
    );
    const dataSourceParents =
      parentDataSourceIds.size === 0
        ? new Map<string, string>()
        : await this.#listDataSourceParents();
    const resolvedPages = pages.map((page) => ({
      ...page,
      parentPageId:
        page.parentPageId ??
        (page.parentDataSourceId === null
          ? null
          : (dataSourceParents.get(page.parentDataSourceId) ?? null)),
    }));
    const visibleIds = new Set(pages.map((page) => page.providerPageId));
    const parentIds = new Set(
      resolvedPages.flatMap((page) =>
        page.parentPageId === null ? [] : [page.parentPageId],
      ),
    );

    return resolvedPages.map((page) => {
      const parentPageId =
        page.parentPageId !== null &&
        visibleIds.has(page.parentPageId)
          ? page.parentPageId
          : null;
      return {
        hasChildren: parentIds.has(page.providerPageId),
        iconUrl: page.iconUrl,
        lastEditedAt: page.lastEditedAt,
        parentContainerId: page.parentContainerId,
        parentPageId,
        providerPageId: page.providerPageId,
        title: page.title,
      };
    });
  }

  async listPageOutline(
    pageId: string,
  ): Promise<readonly NotionOutlineNode[]> {
    const nodes: NotionOutlineNode[] = [];
    const visitedBlocks = new Set<string>();
    let traversedBlockCount = 0;

    const visit = async (
      blockId: string,
      parentNodeId: string | null,
      depth: number,
    ): Promise<void> => {
      if (depth > MAX_OUTLINE_DEPTH) {
        throw new NotionProviderError("invalid_response");
      }
      if (visitedBlocks.has(blockId)) {
        return;
      }
      visitedBlocks.add(blockId);
      for (const result of await this.#listBlockChildren(blockId)) {
        traversedBlockCount += 1;
        if (traversedBlockCount > MAX_OUTLINE_BLOCKS) {
          throw new NotionProviderError("invalid_response");
        }
        const parsed = blockSchema.safeParse(result);
        if (!parsed.success) {
          throw new NotionProviderError("invalid_response");
        }
        const block = parsed.data;
        if (block.type === "child_page" && block.child_page !== undefined) {
          nodes.push({
            kind: "page",
            nodeId: block.id,
            parentNodeId,
            providerId: block.id,
            title: block.child_page.title.trim() || "제목 없음",
          });
          continue;
        }
        if (
          block.type === "child_database" &&
          block.child_database !== undefined
        ) {
          nodes.push({
            kind: "database",
            nodeId: block.id,
            parentNodeId,
            providerId: block.id,
            title: block.child_database.title.trim() || "제목 없음",
          });
          continue;
        }
        if (block.type === "link_to_page") {
          const link = block.link_to_page;
          if (link === undefined) {
            throw new NotionProviderError("invalid_response");
          }
          if (link.type === "page_id" && link.page_id !== undefined) {
            nodes.push({
              kind: "page",
              nodeId: block.id,
              parentNodeId,
              providerId: link.page_id,
              title: "연결된 페이지",
            });
            continue;
          }
          if (
            link.type === "database_id" &&
            link.database_id !== undefined
          ) {
            nodes.push({
              kind: "database",
              nodeId: block.id,
              parentNodeId,
              providerId: link.database_id,
              title: "연결된 데이터베이스",
            });
            continue;
          }
          throw new NotionProviderError("invalid_response");
        }
        const navigationKind = blockNavigationKind(block);
        const navigationTitle = blockNavigationTitle(block);
        const hasNavigationNode =
          navigationKind !== null && navigationTitle !== null;
        const nextParentNodeId = hasNavigationNode
          ? block.id
          : parentNodeId;
        if (hasNavigationNode) {
          nodes.push({
            kind: navigationKind,
            nodeId: block.id,
            parentNodeId,
            providerId: null,
            title: navigationTitle,
          });
        }
        if (block.has_children) {
          await visit(block.id, nextParentNodeId, depth + 1);
          continue;
        }
        if (
          block.type === "synced_block" &&
          block.synced_block?.synced_from?.type === "block_id" &&
          block.synced_block.synced_from.block_id !== undefined
        ) {
          await visit(
            block.synced_block.synced_from.block_id,
            nextParentNodeId,
            depth + 1,
          );
        }
      }
    };

    await visit(pageId, null, 0);
    return navigationBearingNodes(nodes);
  }

  async getPageContent(pageId: string): Promise<NotionPageContent> {
    const response = await this.#fetch(
      `${NOTION_PAGES_URL}/${encodeURIComponent(pageId)}`,
      {
        headers: this.#headers(),
        method: "GET",
      },
    );
    if (!response.ok) {
      throw providerError(response);
    }
    const page = retrievedPageSchema.safeParse(await safeJson(response));
    if (!page.success || page.data.in_trash === true) {
      throw new NotionProviderError("invalid_response");
    }
    const publishingProperties = normalizePublishingProperties(
      page.data.properties,
    );

    const blocks: NotionContentBlock[] = [];
    const visited = new Set<string>();
    let traversed = 0;
    const visit = async (
      blockId: string,
      depth: number,
    ): Promise<NotionContentBlock[]> => {
      if (depth > MAX_OUTLINE_DEPTH || visited.has(blockId)) {
        if (depth > MAX_OUTLINE_DEPTH) {
          throw new NotionProviderError("invalid_response");
        }
        return [];
      }
      visited.add(blockId);
      const converted: NotionContentBlock[] = [];
      for (const raw of await this.#listBlockChildren(blockId)) {
        traversed += 1;
        if (traversed > MAX_OUTLINE_BLOCKS) {
          throw new NotionProviderError("invalid_response");
        }
        const parsed = blockSchema.safeParse(raw);
        if (!parsed.success) {
          throw new NotionProviderError("invalid_response");
        }
        const block = parsed.data;
        let children: NotionContentBlock[] = [];
        if (
          block.has_children &&
          block.type !== "child_page" &&
          block.type !== "child_database"
        ) {
          children = await visit(block.id, depth + 1);
        } else if (
          block.type === "synced_block" &&
          block.synced_block?.synced_from?.type === "block_id" &&
          block.synced_block.synced_from.block_id !== undefined
        ) {
          children = await visit(
            block.synced_block.synced_from.block_id,
            depth + 1,
          );
        }
        converted.push(...publishableBlocks(block, children));
      }
      return converted;
    };
    blocks.push(...(await visit(page.data.id, 0)));

    return {
      blocks,
      createdAt: new Date(page.data.created_time),
      lastEditedAt: new Date(page.data.last_edited_time),
      providerPageId: page.data.id,
      publishingProperties,
      title: pageTitle(page.data.properties),
    };
  }

  async #listAllPages(): Promise<DiscoveredPage[]> {
    const pages = new Map<string, DiscoveredPage>();
    for (const result of await this.#searchAll("page")) {
      if (isNonPageResult(result)) {
        continue;
      }
      const page = pageSchema.safeParse(result);
      if (!page.success) {
        throw new NotionProviderError("invalid_response");
      }
      if (page.data.in_trash === true) {
        continue;
      }
      pages.set(page.data.id, toDiscoveredPage(page.data));
    }

    return [...pages.values()];
  }

  async #listDataSourceParents(): Promise<Map<string, string>> {
    const parents = new Map<string, string>();
    for (const result of await this.#searchAll("data_source")) {
      const dataSource = dataSourceSchema.safeParse(result);
      if (!dataSource.success) {
        throw new NotionProviderError("invalid_response");
      }
      if (
        dataSource.data.database_parent.type === "page_id" &&
        dataSource.data.database_parent.page_id !== undefined
      ) {
        parents.set(
          dataSource.data.id,
          dataSource.data.database_parent.page_id,
        );
      }
    }
    return parents;
  }

  async #searchAll(
    object: "data_source" | "page",
  ): Promise<unknown[]> {
    const results: unknown[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    do {
      if (cursor !== null && seenCursors.has(cursor)) {
        throw new NotionProviderError("invalid_response");
      }
      if (cursor !== null) {
        seenCursors.add(cursor);
      }
      const body: Record<string, unknown> = {
        filter: { property: "object", value: object },
        page_size: PAGE_SIZE,
        sort: { direction: "descending", timestamp: "last_edited_time" },
      };
      if (cursor !== null) {
        body.start_cursor = cursor;
      }
      const response = await this.#fetch(NOTION_SEARCH_URL, {
        body: JSON.stringify(body),
        headers: {
          ...this.#headers(),
          "content-type": "application/json",
        },
        method: "POST",
      });
      if (!response.ok) {
        throw providerError(response);
      }
      const parsed = searchResponseSchema.safeParse(await safeJson(response));
      if (!parsed.success) {
        throw new NotionProviderError("invalid_response");
      }
      results.push(...parsed.data.results);
      if (results.length > MAX_PAGES) {
        throw new NotionProviderError("invalid_response");
      }
      if (parsed.data.has_more && parsed.data.next_cursor === null) {
        throw new NotionProviderError("invalid_response");
      }
      cursor = parsed.data.has_more ? parsed.data.next_cursor : null;
    } while (cursor !== null);
    return results;
  }

  async #listBlockChildren(blockId: string): Promise<unknown[]> {
    const results: unknown[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    do {
      if (cursor !== null && seenCursors.has(cursor)) {
        throw new NotionProviderError("invalid_response");
      }
      if (cursor !== null) {
        seenCursors.add(cursor);
      }
      const url = new URL(
        `${NOTION_BLOCKS_URL}/${encodeURIComponent(blockId)}/children`,
      );
      url.searchParams.set("page_size", String(PAGE_SIZE));
      if (cursor !== null) {
        url.searchParams.set("start_cursor", cursor);
      }
      const response = await this.#fetch(url, {
        headers: this.#headers(),
        method: "GET",
      });
      if (!response.ok) {
        throw providerError(response);
      }
      const parsed = searchResponseSchema.safeParse(await safeJson(response));
      if (!parsed.success) {
        throw new NotionProviderError("invalid_response");
      }
      results.push(...parsed.data.results);
      if (results.length > MAX_OUTLINE_BLOCKS) {
        throw new NotionProviderError("invalid_response");
      }
      if (parsed.data.has_more && parsed.data.next_cursor === null) {
        throw new NotionProviderError("invalid_response");
      }
      cursor = parsed.data.has_more ? parsed.data.next_cursor : null;
    } while (cursor !== null);
    return results;
  }

  #headers(): Record<string, string> {
    return {
      accept: "application/json",
      authorization: `Bearer ${this.#accessToken}`,
      "notion-version": this.#apiVersion,
    };
  }
}

type ParsedBlock = z.infer<typeof blockSchema>;

function normalizePublishingProperties(
  properties: Record<string, unknown>,
): Readonly<Record<string, NotionPageProperty>> {
  const reservedEntries = publishingPropertyNames.flatMap((name) =>
    Object.hasOwn(properties, name) ? [[name, properties[name]] as const] : [],
  );
  if (
    textEncoder.encode(JSON.stringify(Object.fromEntries(reservedEntries)))
      .byteLength > MAX_PUBLISHING_PROPERTIES_BYTES
  ) {
    throw new NotionProviderError("invalid_response");
  }

  return Object.fromEntries(
    reservedEntries.map(([name, value]) => [
      name,
      normalizePublishingProperty(value, publishingPropertyTypes[name]),
    ]),
  );
}

function normalizePublishingProperty(
  value: unknown,
  expectedType: (typeof publishingPropertyTypes)[PublishingPropertyName],
): NotionPageProperty {
  const envelope = propertyEnvelopeSchema.safeParse(value);
  if (!envelope.success) {
    throw new NotionProviderError("invalid_response");
  }

  let normalized: Exclude<
    NotionPageProperty,
    { kind: "unsupported" }
  >;
  switch (envelope.data.type) {
    case "select": {
      const property = selectPropertySchema.safeParse(value);
      if (!property.success) {
        throw new NotionProviderError("invalid_response");
      }
      normalized = {
        kind: "select",
        name: property.data.select?.name ?? null,
      };
      break;
    }
    case "multi_select": {
      const property = multiSelectPropertySchema.safeParse(value);
      if (!property.success) {
        throw new NotionProviderError("invalid_response");
      }
      normalized = {
        kind: "multi_select",
        names: property.data.multi_select.map((option) => option.name),
      };
      break;
    }
    case "rich_text": {
      const property = richTextPropertySchema.safeParse(value);
      if (!property.success) {
        throw new NotionProviderError("invalid_response");
      }
      normalized = {
        kind: "rich_text",
        plainText: property.data.rich_text
          .map((part) => part.plain_text)
          .join(""),
      };
      break;
    }
    case "date": {
      const property = datePropertySchema.safeParse(value);
      if (!property.success) {
        throw new NotionProviderError("invalid_response");
      }
      normalized = {
        kind: "date",
        start: property.data.date?.start ?? null,
      };
      break;
    }
    default:
      if (!Object.hasOwn(envelope.data, envelope.data.type)) {
        throw new NotionProviderError("invalid_response");
      }
      return {
        kind: "unsupported",
        providerType: envelope.data.type,
      };
  }

  return normalized.kind === expectedType
    ? normalized
    : {
        kind: "unsupported",
        providerType: envelope.data.type,
      };
}

function publishableBlocks(
  block: ParsedBlock,
  children: readonly NotionContentBlock[],
): NotionContentBlock[] {
  const value = blockTypeValue(block);
  switch (block.type) {
    case "paragraph":
      return withChildren(
        { kind: "paragraph", richText: blockRichText(value) },
        children,
      );
    case "heading_1":
    case "heading_2":
    case "heading_3":
      return withChildren(
        {
          kind: "heading",
          level: Number(block.type.at(-1)) as 1 | 2 | 3,
          richText: blockRichText(value),
        },
        children,
      );
    case "quote":
      return withChildren(
        { kind: "quote", richText: blockRichText(value) },
        children,
      );
    case "code":
      return [
        {
          code: blockRichText(value).map((part) => part.text).join(""),
          kind: "code",
          language:
            typeof value?.language === "string" ? value.language : "text",
        },
      ];
    case "image": {
      const url = providerFileUrl(value);
      if (url === null) {
        throw new NotionProviderError("invalid_response");
      }
      return [
        {
          caption: blockRichText(value, "caption"),
          kind: "image",
          url,
        },
      ];
    }
    case "toggle":
      return [
        {
          children: [...children],
          kind: "toggle",
          summary: blockRichText(value),
        },
      ];
    case "divider":
      return [{ kind: "divider" }];
    case "bookmark":
    case "embed":
    case "link_preview": {
      const url = typeof value?.url === "string" ? value.url : null;
      if (url === null) {
        return [...children];
      }
      const caption = blockRichText(value, "caption");
      return withChildren(
        {
          kind: "paragraph",
          richText:
            caption.length > 0
              ? caption.map((part) => ({ ...part, href: part.href ?? url }))
              : [defaultRichText(url, url)],
        },
        children,
      );
    }
    case "bulleted_list_item":
    case "numbered_list_item":
    case "to_do":
    case "callout":
      return withChildren(
        { kind: "paragraph", richText: blockRichText(value) },
        children,
      );
    case "child_page":
    case "child_database":
      return [];
    default:
      return [...children];
  }
}

function withChildren(
  block: NotionContentBlock,
  children: readonly NotionContentBlock[],
): NotionContentBlock[] {
  return [block, ...children];
}

function blockRichText(
  value: Record<string, unknown> | null,
  key = "rich_text",
): NotionRichText[] {
  if (value === null || !Array.isArray(value[key])) {
    return [];
  }
  const parsed = z.array(richTextSchema).safeParse(value[key]);
  if (!parsed.success) {
    throw new NotionProviderError("invalid_response");
  }
  return parsed.data.map((part) => ({
    bold: part.annotations?.bold ?? false,
    code: part.annotations?.code ?? false,
    href: part.href ?? null,
    italic: part.annotations?.italic ?? false,
    strikethrough: part.annotations?.strikethrough ?? false,
    text: part.plain_text,
  }));
}

function defaultRichText(text: string, href: string | null): NotionRichText {
  return {
    bold: false,
    code: false,
    href,
    italic: false,
    strikethrough: false,
    text,
  };
}

function providerFileUrl(value: Record<string, unknown> | null): string | null {
  if (value === null) {
    return null;
  }
  for (const key of ["external", "file", "file_upload"]) {
    const candidate = value[key];
    if (typeof candidate !== "object" || candidate === null) {
      continue;
    }
    const url = (candidate as Record<string, unknown>).url;
    if (typeof url === "string") {
      return url;
    }
  }
  return null;
}

const GROUP_BLOCK_TYPES = new Set([
  "bulleted_list_item",
  "callout",
  "numbered_list_item",
  "paragraph",
  "quote",
  "template",
  "to_do",
]);
const HEADING_BLOCK_TYPES = new Set([
  "heading_1",
  "heading_2",
  "heading_3",
  "heading_4",
]);

function blockNavigationKind(
  block: ParsedBlock,
): "group" | "toggle" | null {
  if (block.type === "toggle" && block.toggle !== undefined) {
    return "toggle";
  }
  const value = blockTypeValue(block);
  if (
    HEADING_BLOCK_TYPES.has(block.type) &&
    value?.is_toggleable === true
  ) {
    return "toggle";
  }
  if (
    GROUP_BLOCK_TYPES.has(block.type) &&
    richTextTitle(value) !== null
  ) {
    return "group";
  }
  return null;
}

function blockNavigationTitle(block: ParsedBlock): string | null {
  if (block.type === "toggle" && block.toggle !== undefined) {
    return (
      block.toggle.rich_text
        .map((part) => part.plain_text)
        .join("")
        .trim() || "제목 없는 토글"
    );
  }
  const title = richTextTitle(blockTypeValue(block));
  if (HEADING_BLOCK_TYPES.has(block.type)) {
    return title ?? "제목 없는 토글";
  }
  return title;
}

function blockTypeValue(
  block: ParsedBlock,
): Record<string, unknown> | null {
  const value = (block as Record<string, unknown>)[block.type];
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function richTextTitle(value: Record<string, unknown> | null): string | null {
  if (value === null || !Array.isArray(value.rich_text)) {
    return null;
  }
  const parsed = z.array(richTextSchema).safeParse(value.rich_text);
  if (!parsed.success) {
    throw new NotionProviderError("invalid_response");
  }
  const title = parsed.data
    .map((part) => part.plain_text)
    .join("")
    .trim();
  return title || null;
}

function navigationBearingNodes(
  nodes: readonly NotionOutlineNode[],
): NotionOutlineNode[] {
  const nodesById = new Map(nodes.map((node) => [node.nodeId, node]));
  const retained = new Set<string>();
  for (const node of nodes) {
    if (node.kind !== "database" && node.kind !== "page") {
      continue;
    }
    let current: NotionOutlineNode | undefined = node;
    while (current !== undefined && !retained.has(current.nodeId)) {
      retained.add(current.nodeId);
      current =
        current.parentNodeId === null
          ? undefined
          : nodesById.get(current.parentNodeId);
    }
  }
  return nodes.filter((node) => retained.has(node.nodeId));
}

function toDiscoveredPage(
  page: z.infer<typeof pageSchema>,
): DiscoveredPage {
  const parentPageId =
    page.parent.type === "page_id" ? (page.parent.page_id ?? null) : null;
  const parentDataSourceId =
    page.parent.type === "data_source_id"
      ? (page.parent.data_source_id ?? null)
      : null;
  return {
    hasChildren: false,
    iconUrl: iconUrl(page.icon),
    lastEditedAt: new Date(page.last_edited_time),
    parentContainerId:
      page.parent.type === "data_source_id"
        ? (page.parent.database_id ?? null)
        : page.parent.type === "block_id"
          ? (page.parent.block_id ?? null)
          : null,
    parentDataSourceId,
    parentPageId,
    providerPageId: page.id,
    title: pageTitle(page.properties),
  };
}

function pageTitle(properties: Record<string, unknown>): string {
  for (const property of Object.values(properties)) {
    const title = titlePropertySchema.safeParse(property);
    if (title.success) {
      return (
        title.data.title.map((part) => part.plain_text).join("").trim() ||
        "제목 없음"
      );
    }
  }
  return "제목 없음";
}

function iconUrl(icon: unknown): string | null {
  if (typeof icon !== "object" || icon === null) {
    return null;
  }
  const value = icon as Record<string, unknown>;
  for (const key of ["external", "file", "file_upload", "custom_emoji"]) {
    const candidate = value[key];
    if (typeof candidate !== "object" || candidate === null) {
      continue;
    }
    const url = (candidate as Record<string, unknown>).url;
    if (typeof url === "string" && isHttpUrl(url)) {
      return url;
    }
  }
  return null;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isNonPageResult(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "object" in value &&
    (value as { object?: unknown }).object !== "page"
  );
}

function providerError(response: Response): NotionProviderError {
  if (response.status === 401 || response.status === 403) {
    return new NotionProviderError("access_denied");
  }
  if (response.status === 429) {
    const retryAfter = Number.parseInt(
      response.headers.get("retry-after") ?? "",
      10,
    );
    return new NotionProviderError(
      "rate_limited",
      Number.isSafeInteger(retryAfter) && retryAfter >= 0
        ? Math.min(retryAfter, 3_600)
        : null,
    );
  }
  return new NotionProviderError("unavailable");
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
