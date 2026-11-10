// Notion 연결 token 하나로 page tree, page outline, 게시 본문을 읽는 adapter.
// HTTP는 provider.ts, 응답 변환은 convert.ts가 맡고 이 파일은 무엇을 어떤 순서로 읽을지만 정한다.
import type {
  NotionContentAdapter,
  NotionContentBlock,
  NotionOutlineNode,
  NotionPageContent,
  NotionPageSummary,
} from "@notion-kanban-blog/notion";
import { z } from "zod";

import {
  childSourceId,
  isOutlineLeaf,
  navigationBearingNodes,
  type NotionBlock,
  pageIconUrl,
  pageTitle,
  parseBlock,
  publishingProperties,
  toContentBlocks,
  toOutlineNode,
} from "./convert";
import {
  invalidResponse,
  listAll,
  notionJson,
  type NotionRequestOptions,
} from "./provider";

// 기존 import 경로(`../notion/content`)를 쓰는 route와 테스트를 위해 다시 내보낸다.
export { NotionProviderError } from "./provider";

// 한 번의 요청이 provider를 무한히 순회하지 않도록 하는 상한.
const MAX_PAGES = 10_000;
const MAX_BLOCKS = 5_000;
const MAX_DEPTH = 20;

const pageSchema = z.object({
  icon: z.unknown().nullable().optional(),
  id: z.string().min(1).max(255),
  in_trash: z.boolean().optional(),
  last_edited_time: z.iso.datetime({ offset: true }),
  object: z.literal("page"),
  parent: z.object({
    block_id: z.string().min(1).max(255).optional(),
    data_source_id: z.string().min(1).max(255).optional(),
    database_id: z.string().min(1).max(255).optional(),
    page_id: z.string().min(1).max(255).optional(),
    type: z.string(),
  }),
  properties: z.record(z.string(), z.unknown()),
});

const dataSourceSchema = z.object({
  database_parent: z.object({
    page_id: z.string().min(1).max(255).optional(),
    type: z.string(),
  }),
  id: z.string().min(1).max(255),
  object: z.literal("data_source"),
});

export class NotionRestContentAdapter implements NotionContentAdapter {
  readonly #options: NotionRequestOptions;

  constructor(options: NotionRequestOptions) {
    this.#options = options;
  }

  /**
   * 연결에 공유된 모든 page를 평평한 목록으로 돌려준다.
   * data source(database) 행 page는 database가 놓인 page 아래로 붙이고,
   * 부모가 보이지 않는 page는 root(`parentPageId: null`)로 올린다.
   */
  async listPageTree(): Promise<readonly NotionPageSummary[]> {
    const byId = new Map<string, z.infer<typeof pageSchema>>();
    for (const result of await this.#search("page")) {
      // search가 page가 아닌 object를 섞어 보내면 건너뛴다.
      if (typeof result === "object" && result !== null && "object" in result && result.object !== "page") {
        continue;
      }
      const page = pageSchema.safeParse(result);
      if (!page.success) {
        throw invalidResponse();
      }
      if (page.data.in_trash !== true) {
        byId.set(page.data.id, page.data);
      }
    }
    const pages = [...byId.values()];

    const dataSourceParents = pages.some(
      (page) => page.parent.type === "data_source_id" && page.parent.data_source_id !== undefined,
    )
      ? await this.#dataSourceParents()
      : new Map<string, string>();
    const parentOf = (page: (typeof pages)[number]): string | null =>
      page.parent.type === "page_id"
        ? (page.parent.page_id ?? null)
        : page.parent.type === "data_source_id"
          ? (dataSourceParents.get(page.parent.data_source_id ?? "") ?? null)
          : null;

    const visibleIds = new Set(pages.map((page) => page.id));
    const parentIds = new Set(pages.map(parentOf));
    return pages.map((page) => {
      const parentPageId = parentOf(page);
      return {
        hasChildren: parentIds.has(page.id),
        iconUrl: pageIconUrl(page.icon),
        lastEditedAt: new Date(page.last_edited_time),
        parentContainerId:
          page.parent.type === "data_source_id"
            ? (page.parent.database_id ?? null)
            : page.parent.type === "block_id"
              ? (page.parent.block_id ?? null)
              : null,
        parentPageId: parentPageId !== null && visibleIds.has(parentPageId) ? parentPageId : null,
        providerPageId: page.id,
        title: pageTitle(page.properties),
      };
    });
  }

  /** page 아래의 탐색용 구조(하위 page·database와 그것을 묶는 토글·그룹)만 돌려준다. */
  async listPageOutline(pageId: string): Promise<readonly NotionOutlineNode[]> {
    const nodes: NotionOutlineNode[] = [];
    const childrenOf = this.#blockWalker();
    const visit = async (blockId: string, parentNodeId: string | null, depth: number) => {
      for (const block of await childrenOf(blockId, depth)) {
        const node = toOutlineNode(block, parentNodeId);
        if (node !== null) {
          nodes.push(node);
        }
        const source = isOutlineLeaf(block) ? null : childSourceId(block);
        if (source !== null) {
          await visit(source, node?.nodeId ?? parentNodeId, depth + 1);
        }
      }
    };
    await visit(pageId, null, 0);
    return navigationBearingNodes(nodes);
  }

  /** 게시 직전에 최신 page metadata와 본문 블록 전체를 읽는다. 휴지통 page는 거절한다. */
  async getPageContent(pageId: string): Promise<NotionPageContent> {
    const page = pageSchema
      .extend({ created_time: z.iso.datetime({ offset: true }) })
      .safeParse(
        await notionJson(
          this.#options,
          `https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`,
          "content.page",
        ),
      );
    if (!page.success || page.data.in_trash === true) {
      throw invalidResponse();
    }
    const properties = publishingProperties(page.data.properties);

    const childrenOf = this.#blockWalker();
    const visit = async (blockId: string, depth: number): Promise<NotionContentBlock[]> => {
      const converted: NotionContentBlock[] = [];
      for (const block of await childrenOf(blockId, depth)) {
        const source = childSourceId(block);
        const children = source === null ? [] : await visit(source, depth + 1);
        converted.push(...toContentBlocks(block, children));
      }
      return converted;
    };

    return {
      blocks: await visit(page.data.id, 0),
      createdAt: new Date(page.data.created_time),
      lastEditedAt: new Date(page.data.last_edited_time),
      providerPageId: page.data.id,
      publishingProperties: properties,
      title: pageTitle(page.data.properties),
    };
  }

  /**
   * 한 번의 순회 안에서 블록 자식을 읽는 함수. 깊이·전체 블록 수 상한을 넘으면 거절하고,
   * 이미 읽은 블록(synced block 순환)은 빈 목록으로 끊는다.
   */
  #blockWalker(): (blockId: string, depth: number) => Promise<NotionBlock[]> {
    const visited = new Set<string>();
    let total = 0;
    return async (blockId, depth) => {
      if (depth > MAX_DEPTH) {
        throw invalidResponse();
      }
      if (visited.has(blockId)) {
        return [];
      }
      visited.add(blockId);
      const children = await listAll((cursor) => {
        const url = new URL(
          `https://api.notion.com/v1/blocks/${encodeURIComponent(blockId)}/children`,
        );
        url.searchParams.set("page_size", "100");
        if (cursor !== null) {
          url.searchParams.set("start_cursor", cursor);
        }
        return notionJson(this.#options, url, "content.blocks");
      }, MAX_BLOCKS);
      total += children.length;
      if (total > MAX_BLOCKS) {
        throw invalidResponse();
      }
      return children.map(parseBlock);
    };
  }

  /** data source ID → 그 database가 놓인 page ID. */
  async #dataSourceParents(): Promise<Map<string, string>> {
    const parents = new Map<string, string>();
    for (const result of await this.#search("data_source")) {
      const dataSource = dataSourceSchema.safeParse(result);
      if (!dataSource.success) {
        throw invalidResponse();
      }
      const parent = dataSource.data.database_parent;
      if (parent.type === "page_id" && parent.page_id !== undefined) {
        parents.set(dataSource.data.id, parent.page_id);
      }
    }
    return parents;
  }

  #search(object: "data_source" | "page"): Promise<unknown[]> {
    return listAll(
      (cursor) =>
        notionJson(this.#options, "https://api.notion.com/v1/search", "content.search", {
          filter: { property: "object", value: object },
          page_size: 100,
          sort: { direction: "descending", timestamp: "last_edited_time" },
          ...(cursor === null ? {} : { start_cursor: cursor }),
        }),
      MAX_PAGES,
    );
  }
}
