// Notion API 응답 → provider 독립 모델(@notion-kanban-blog/notion) 순수 변환.
// 네트워크 호출은 없다. 형식이 맞지 않는 응답은 조용히 보정하지 않고 invalid_response로 거절한다.
import type {
  NotionContentBlock,
  NotionOutlineNode,
  NotionPageProperty,
  NotionRichText,
} from "@notion-kanban-blog/notion";
import { z } from "zod";

import { invalidResponse } from "./provider";

const MAX_PROPERTY_ITEMS = 100;
const MAX_PROPERTY_TEXT_LENGTH = 2_000;
const MAX_PUBLISHING_PROPERTIES_BYTES = 500_000;

// ── rich text ────────────────────────────────────────────────────────────────

const richTextSchema = z.object({
  annotations: z
    .object({
      bold: z.boolean().optional(),
      code: z.boolean().optional(),
      italic: z.boolean().optional(),
      strikethrough: z.boolean().optional(),
    })
    .optional(),
  href: z.string().max(4_096).nullable().optional(),
  plain_text: z.string(),
});

type RawRichText = z.infer<typeof richTextSchema>;

function toRichText(parts: readonly RawRichText[]): NotionRichText[] {
  return parts.map((part) => ({
    bold: part.annotations?.bold ?? false,
    code: part.annotations?.code ?? false,
    href: part.href ?? null,
    italic: part.annotations?.italic ?? false,
    strikethrough: part.annotations?.strikethrough ?? false,
    text: part.plain_text,
  }));
}

function plainText(parts: readonly { plain_text: string }[]): string {
  return parts.map((part) => part.plain_text).join("");
}

/** `value[key]`의 rich text. 배열이 아니면 빈 목록, 배열인데 형식이 틀리면 거절. */
function richTextAt(value: Record<string, unknown> | null, key = "rich_text"): NotionRichText[] {
  if (value === null || !Array.isArray(value[key])) {
    return [];
  }
  const parsed = z.array(richTextSchema).safeParse(value[key]);
  if (!parsed.success) {
    throw invalidResponse();
  }
  return toRichText(parsed.data);
}

// ── block ────────────────────────────────────────────────────────────────────

// 블록 본문은 `block[block.type]`에 들어 있어 알 수 없는 key를 남겨 두어야 한다(loose).
const blockSchema = z.looseObject({
  child_database: z.object({ title: z.string() }).optional(),
  child_page: z.object({ title: z.string() }).optional(),
  has_children: z.boolean(),
  id: z.string().min(1).max(255),
  link_to_page: z
    .object({
      database_id: z.string().min(1).max(255).optional(),
      page_id: z.string().min(1).max(255).optional(),
      type: z.string(),
    })
    .optional(),
  object: z.literal("block"),
  synced_block: z
    .object({
      synced_from: z
        .object({ block_id: z.string().min(1).max(255).optional(), type: z.string() })
        .nullable(),
    })
    .optional(),
  toggle: z.object({ rich_text: z.array(richTextSchema) }).optional(),
  type: z.string(),
});

export type NotionBlock = z.infer<typeof blockSchema>;

export function parseBlock(value: unknown): NotionBlock {
  const parsed = blockSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidResponse();
  }
  return parsed.data;
}

/**
 * 이 블록 아래에서 더 읽을 블록 ID.
 * child page·database는 별도 문서라 내려가지 않고, 원본을 참조하는 synced block은 원본을 읽는다.
 */
export function childSourceId(block: NotionBlock): string | null {
  if (block.type === "child_page" || block.type === "child_database") {
    return null;
  }
  if (block.has_children) {
    return block.id;
  }
  const from = block.synced_block?.synced_from;
  return block.type === "synced_block" && from?.type === "block_id"
    ? (from.block_id ?? null)
    : null;
}

function blockValue(block: NotionBlock): Record<string, unknown> | null {
  const value = block[block.type];
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * 게시 본문 블록으로 변환한다. 자식을 가질 수 있는 블록(목록·할 일·토글·callout)은 자식을 안에 품고,
 * 문단·제목처럼 품을 수 없는 블록의 자식과 지원하지 않는 블록의 자식은 뒤에 이어 붙인다.
 */
export function toContentBlocks(
  block: NotionBlock,
  children: readonly NotionContentBlock[],
): NotionContentBlock[] {
  const value = blockValue(block);
  switch (block.type) {
    case "paragraph":
      return [{ kind: "paragraph", richText: richTextAt(value) }, ...children];
    case "heading_1":
    case "heading_2":
    case "heading_3":
      return [
        {
          kind: "heading",
          level: Number(block.type.at(-1)) as 1 | 2 | 3,
          richText: richTextAt(value),
        },
        ...children,
      ];
    case "quote":
      return [{ kind: "quote", richText: richTextAt(value) }, ...children];
    case "code":
      return [
        {
          code: richTextAt(value).map((part) => part.text).join(""),
          kind: "code",
          language: typeof value?.language === "string" ? value.language : "text",
        },
      ];
    case "image": {
      const url = fileUrl(value, ["external", "file", "file_upload"]);
      if (url === null) {
        throw invalidResponse();
      }
      return [{ caption: richTextAt(value, "caption"), kind: "image", url }];
    }
    case "toggle":
      return [{ children: [...children], kind: "toggle", summary: richTextAt(value) }];
    case "divider":
      return [{ kind: "divider" }];
    case "equation":
      if (typeof value?.expression !== "string") {
        throw invalidResponse();
      }
      return [{ expression: value.expression, kind: "equation" }];
    case "bulleted_list_item":
    case "numbered_list_item":
      return [
        {
          children: [...children],
          kind: "listItem",
          richText: richTextAt(value),
          style: block.type === "bulleted_list_item" ? "bulleted" : "numbered",
        },
      ];
    case "to_do":
      return [
        {
          checked: value?.checked === true,
          children: [...children],
          kind: "toDo",
          richText: richTextAt(value),
        },
      ];
    case "callout":
      return [
        {
          children: [...children],
          icon: calloutEmoji(value),
          kind: "callout",
          richText: richTextAt(value),
        },
      ];
    case "table":
      return [
        {
          hasColumnHeader: value?.has_column_header === true,
          hasRowHeader: value?.has_row_header === true,
          kind: "table",
          rows: children.flatMap((child) => (child.kind === "tableRow" ? [child.cells] : [])),
        },
      ];
    case "table_row":
      return [{ cells: tableCells(value), kind: "tableRow" }];
    case "bookmark":
    case "embed":
    case "link_preview": {
      if (typeof value?.url !== "string") {
        return [...children];
      }
      const caption = richTextAt(value, "caption");
      return [
        {
          caption: caption.length > 0 ? caption : toRichText([{ href: value.url, plain_text: value.url }]),
          kind: "linkCard",
          url: value.url,
        },
        ...children,
      ];
    }
    case "audio":
    case "file":
    case "pdf":
    case "video":
      return [
        {
          caption: richTextAt(value, "caption"),
          kind: "media",
          mediaType: block.type,
          // Notion이 호스팅한 파일 URL은 곧 만료되므로 외부 URL만 남긴다.
          url: value?.type === "external" ? fileUrl(value, ["external"]) : null,
        },
        ...children,
      ];
    case "child_page":
    case "child_database":
      return [];
    default:
      return [...children];
  }
}

function tableCells(value: Record<string, unknown> | null): NotionRichText[][] {
  const cells = z
    .array(z.array(richTextSchema).max(1_000))
    .max(100)
    .safeParse(value?.cells);
  if (!cells.success) {
    throw invalidResponse();
  }
  return cells.data.map(toRichText);
}

function calloutEmoji(value: Record<string, unknown> | null): string | null {
  const icon = z.object({ emoji: z.string(), type: z.literal("emoji") }).safeParse(value?.icon);
  const emoji = icon.success ? icon.data.emoji.trim() : "";
  return emoji.length > 0 && emoji.length <= 16 ? emoji : null;
}

/** `value.external.url`, `value.file.url`처럼 keys 순서대로 처음 발견한 문자열 URL. */
function fileUrl(value: unknown, keys: readonly string[]): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  for (const key of keys) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "object" && candidate !== null) {
      const url = (candidate as Record<string, unknown>).url;
      if (typeof url === "string") {
        return url;
      }
    }
  }
  return null;
}

// ── outline ──────────────────────────────────────────────────────────────────

// 제목이 있으면 탐색 그룹이 될 수 있는 블록. 토글은 제목이 없어도 탐색 노드다.
const GROUP_BLOCK_TYPES = new Set([
  "bulleted_list_item",
  "callout",
  "numbered_list_item",
  "paragraph",
  "quote",
  "template",
  "to_do",
]);
const HEADING_BLOCK_TYPES = new Set(["heading_1", "heading_2", "heading_3", "heading_4"]);

/**
 * outline에 보일 노드. child page·database와 link-to-page는 끝 노드이고,
 * 토글·토글 제목·제목 있는 그룹 블록은 하위 노드를 묶는 노드다. 그 외 블록은 `null`.
 */
export function toOutlineNode(
  block: NotionBlock,
  parentNodeId: string | null,
): NotionOutlineNode | null {
  const node = (kind: NotionOutlineNode["kind"], providerId: string | null, title: string) => ({
    kind,
    nodeId: block.id,
    parentNodeId,
    providerId,
    title,
  });

  if (block.type === "child_page" && block.child_page !== undefined) {
    return node("page", block.id, block.child_page.title.trim() || "제목 없음");
  }
  if (block.type === "child_database" && block.child_database !== undefined) {
    return node("database", block.id, block.child_database.title.trim() || "제목 없음");
  }
  if (block.type === "link_to_page") {
    const link = block.link_to_page;
    if (link?.type === "page_id" && link.page_id !== undefined) {
      return node("page", link.page_id, "연결된 페이지");
    }
    if (link?.type === "database_id" && link.database_id !== undefined) {
      return node("database", link.database_id, "연결된 데이터베이스");
    }
    throw invalidResponse();
  }
  if (block.type === "toggle" && block.toggle !== undefined) {
    return node("toggle", null, plainText(block.toggle.rich_text).trim() || "제목 없는 토글");
  }
  const value = blockValue(block);
  if (HEADING_BLOCK_TYPES.has(block.type) && value?.is_toggleable === true) {
    return node("toggle", null, titleOf(value) ?? "제목 없는 토글");
  }
  const title = GROUP_BLOCK_TYPES.has(block.type) ? titleOf(value) : null;
  return title === null ? null : node("group", null, title);
}

export function isOutlineLeaf(block: NotionBlock): boolean {
  return ["child_page", "child_database", "link_to_page"].includes(block.type);
}

function titleOf(value: Record<string, unknown> | null): string | null {
  return richTextAt(value).map((part) => part.text).join("").trim() || null;
}

/** page·database에 이르는 경로 위의 노드만 남긴다. 설명용 토글·그룹만 있는 가지는 버린다. */
export function navigationBearingNodes(nodes: readonly NotionOutlineNode[]): NotionOutlineNode[] {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const retained = new Set<string>();
  for (const node of nodes) {
    if (node.kind !== "database" && node.kind !== "page") {
      continue;
    }
    let current: NotionOutlineNode | undefined = node;
    while (current !== undefined && !retained.has(current.nodeId)) {
      retained.add(current.nodeId);
      current = current.parentNodeId === null ? undefined : byId.get(current.parentNodeId);
    }
  }
  return nodes.filter((node) => retained.has(node.nodeId));
}

// ── page ─────────────────────────────────────────────────────────────────────

export function pageTitle(properties: Record<string, unknown>): string {
  const titleSchema = z.object({ title: z.array(richTextSchema), type: z.literal("title") });
  for (const property of Object.values(properties)) {
    const title = titleSchema.safeParse(property);
    if (title.success) {
      return plainText(title.data.title).trim() || "제목 없음";
    }
  }
  return "제목 없음";
}

/** page icon 중 http(s) 이미지 URL만 쓴다. emoji icon은 `null`. */
export function pageIconUrl(icon: unknown): string | null {
  for (const key of ["external", "file", "file_upload", "custom_emoji"]) {
    const url = fileUrl(icon, [key]);
    if (url !== null && URL.canParse(url) && /^https?:$/.test(new URL(url).protocol)) {
      return url;
    }
  }
  return null;
}

// ── 예약 게시 속성 ───────────────────────────────────────────────────────────

// 블로그 metadata는 이 이름·형식의 Notion 속성에서만 읽는다(제품 명세 §5 게시).
const PUBLISHING_PROPERTY_TYPES = {
  "Blog Category": "select",
  "Blog Description": "rich_text",
  "Blog Order": "number",
  "Blog Pinned": "checkbox",
  "Blog Published At": "date",
  "Blog Series": "select",
  "Blog Slug": "rich_text",
  "Blog Tags": "multi_select",
} as const;

const propertyEnvelopeSchema = z.looseObject({
  id: z.string().min(1).max(255),
  type: z.string().min(1).max(255),
});
const nameSchema = z.object({ name: z.string().max(MAX_PROPERTY_TEXT_LENGTH) });

// Notion 속성 형식별 파서. 알려진 형식인데 값이 틀리면 거절한다.
const PROPERTY_PARSERS: Record<string, (value: unknown) => NotionPageProperty | null> = {
  checkbox: (value) => {
    const parsed = z.object({ checkbox: z.boolean() }).safeParse(value);
    return parsed.success ? { kind: "checkbox", checked: parsed.data.checkbox } : null;
  },
  date: (value) => {
    const parsed = z
      .object({ date: z.object({ start: z.string().min(1).max(MAX_PROPERTY_TEXT_LENGTH) }).nullable() })
      .safeParse(value);
    return parsed.success ? { kind: "date", start: parsed.data.date?.start ?? null } : null;
  },
  multi_select: (value) => {
    const parsed = z
      .object({ multi_select: z.array(nameSchema).max(MAX_PROPERTY_ITEMS) })
      .safeParse(value);
    return parsed.success
      ? { kind: "multi_select", names: parsed.data.multi_select.map((option) => option.name) }
      : null;
  },
  number: (value) => {
    const parsed = z.object({ number: z.number().finite().nullable() }).safeParse(value);
    return parsed.success ? { kind: "number", value: parsed.data.number } : null;
  },
  rich_text: (value) => {
    const parsed = z
      .object({
        rich_text: z
          .array(richTextSchema.extend({ plain_text: z.string().max(MAX_PROPERTY_TEXT_LENGTH) }))
          .max(MAX_PROPERTY_ITEMS),
      })
      .safeParse(value);
    return parsed.success ? { kind: "rich_text", plainText: plainText(parsed.data.rich_text) } : null;
  },
  select: (value) => {
    const parsed = z.object({ select: nameSchema.nullable() }).safeParse(value);
    return parsed.success ? { kind: "select", name: parsed.data.select?.name ?? null } : null;
  },
};

/**
 * 예약 속성만 골라 정규화한다. 형식이 다르면 값을 버리고 `unsupported`로 낮춰
 * 게시 단계가 사용자에게 안내하게 한다. 전체 크기가 상한을 넘으면 거절한다.
 */
export function publishingProperties(
  properties: Record<string, unknown>,
): Readonly<Record<string, NotionPageProperty>> {
  const names = Object.keys(PUBLISHING_PROPERTY_TYPES) as (keyof typeof PUBLISHING_PROPERTY_TYPES)[];
  const reserved = names.filter((name) => Object.hasOwn(properties, name));
  const raw = Object.fromEntries(reserved.map((name) => [name, properties[name]]));
  if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > MAX_PUBLISHING_PROPERTIES_BYTES) {
    throw invalidResponse();
  }
  return Object.fromEntries(
    reserved.map((name) => [name, normalizeProperty(raw[name], PUBLISHING_PROPERTY_TYPES[name])]),
  );
}

function normalizeProperty(value: unknown, expectedType: string): NotionPageProperty {
  const envelope = propertyEnvelopeSchema.safeParse(value);
  if (!envelope.success) {
    throw invalidResponse();
  }
  const { type } = envelope.data;
  const parse = Object.hasOwn(PROPERTY_PARSERS, type) ? PROPERTY_PARSERS[type] : undefined;
  if (parse === undefined) {
    if (!Object.hasOwn(envelope.data, type)) {
      throw invalidResponse();
    }
    return { kind: "unsupported", providerType: type };
  }
  const normalized = parse(value);
  if (normalized === null) {
    throw invalidResponse();
  }
  return normalized.kind === expectedType ? normalized : { kind: "unsupported", providerType: type };
}
