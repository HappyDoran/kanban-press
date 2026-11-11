import { describe, expect, it, vi } from "vitest";

import {
  NotionProviderError,
  NotionRestContentAdapter,
} from "./content";

const ROOT_ID = "3c90c3cc-0d44-4b50-8888-8dd25736052a";
const CHILD_ID = "9188c6a5-7381-452f-b3dc-d4865aa89bdf";
const UNKNOWN_PARENT_ID = "019c75c2-3ce6-7988-a2bc-0a56ba576bc3";
const DATA_SOURCE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function page(
  id: string,
  title: string,
  parent: Record<string, string>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> & { properties: Record<string, unknown> } {
  return {
    icon: null,
    id,
    in_trash: false,
    last_edited_time: "2026-07-19T10:00:00.000Z",
    object: "page",
    parent,
    properties: {
      title: {
        id: "title",
        title: [{ plain_text: title, type: "text" }],
        type: "title",
      },
    },
    ...overrides,
  };
}

describe("NotionRestContentAdapter", () => {
  it("retrieves the latest publishable page content recursively", async () => {
    const toggleId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          page(
            ROOT_ID,
            "게시할 글",
            { type: "workspace", workspace: "true" },
            { created_time: "2026-07-18T09:00:00.000Z" },
          ),
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          next_cursor: null,
          results: [
            {
              has_children: false,
              id: "11111111-1111-4111-8111-111111111111",
              object: "block",
              paragraph: {
                rich_text: [
                  {
                    annotations: { bold: true },
                    href: "https://example.com",
                    plain_text: "본문 링크",
                  },
                ],
              },
              type: "paragraph",
            },
            {
              has_children: true,
              id: toggleId,
              object: "block",
              toggle: { rich_text: [{ plain_text: "접힌 내용" }] },
              type: "toggle",
            },
            {
              code: {
                language: "typescript",
                rich_text: [{ plain_text: "const ok = true;" }],
              },
              has_children: false,
              id: "22222222-2222-4222-8222-222222222222",
              object: "block",
              type: "code",
            },
            {
              has_children: false,
              id: "33333333-3333-4333-8333-333333333333",
              image: {
                caption: [{ plain_text: "대표 이미지" }],
                external: { url: "https://example.com/cover.png" },
                type: "external",
              },
              object: "block",
              type: "image",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          next_cursor: null,
          results: [
            {
              has_children: false,
              id: "44444444-4444-4444-8444-444444444444",
              object: "block",
              quote: { rich_text: [{ plain_text: "인용문" }] },
              type: "quote",
            },
          ],
        }),
      );
    const adapter = new NotionRestContentAdapter({
      accessToken: "secret-notion-token",
      apiVersion: "2026-03-11",
      fetch: fetchMock,
    });

    const content = await adapter.getPageContent(ROOT_ID);
    expect(content).toMatchObject({
      blocks: [
        {
          kind: "paragraph",
          richText: [
            {
              bold: true,
              href: "https://example.com",
              text: "본문 링크",
            },
          ],
        },
        {
          children: [
            {
              kind: "quote",
              richText: [{ text: "인용문" }],
            },
          ],
          kind: "toggle",
          summary: [{ text: "접힌 내용" }],
        },
        {
          code: "const ok = true;",
          kind: "code",
          language: "typescript",
        },
        {
          caption: [{ text: "대표 이미지" }],
          kind: "image",
          url: "https://example.com/cover.png",
        },
      ],
      createdAt: new Date("2026-07-18T09:00:00.000Z"),
      lastEditedAt: new Date("2026-07-19T10:00:00.000Z"),
      providerPageId: ROOT_ID,
      title: "게시할 글",
    });
    expect(content.publishingProperties).toEqual({});
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `https://api.notion.com/v1/pages/${ROOT_ID}`,
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer secret-notion-token",
        }),
      }),
    );
  });

  it("preserves lists, tasks, callouts, and tables instead of flattening them", async () => {
    const listId = "55555555-5555-4555-8555-555555555555";
    const calloutId = "66666666-6666-4666-8666-666666666666";
    const tableId = "77777777-7777-4777-8777-777777777777";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          page(
            ROOT_ID,
            "구조화된 글",
            { type: "workspace", workspace: "true" },
            { created_time: "2026-07-18T09:00:00.000Z" },
          ),
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          next_cursor: null,
          results: [
            {
              bulleted_list_item: { rich_text: [{ plain_text: "목록" }] },
              has_children: true,
              id: listId,
              object: "block",
              type: "bulleted_list_item",
            },
            {
              has_children: false,
              id: "88888888-8888-4888-8888-888888888888",
              object: "block",
              to_do: { checked: true, rich_text: [{ plain_text: "완료" }] },
              type: "to_do",
            },
            {
              callout: {
                icon: { emoji: "📌", type: "emoji" },
                rich_text: [{ plain_text: "안내" }],
              },
              has_children: true,
              id: calloutId,
              object: "block",
              type: "callout",
            },
            {
              has_children: true,
              id: tableId,
              object: "block",
              table: { has_column_header: true, has_row_header: true },
              type: "table",
            },
            {
              equation: { expression: "E = mc^2" },
              has_children: false,
              id: "dddddddd-1111-4111-8111-dddddddddddd",
              object: "block",
              type: "equation",
            },
            {
              bookmark: {
                caption: [{ plain_text: "공식 문서" }],
                url: "https://example.com/docs",
              },
              has_children: false,
              id: "eeeeeeee-1111-4111-8111-eeeeeeeeeeee",
              object: "block",
              type: "bookmark",
            },
            {
              has_children: false,
              id: "ffffffff-1111-4111-8111-ffffffffffff",
              object: "block",
              type: "video",
              video: {
                caption: [{ plain_text: "외부 영상" }],
                external: { url: "https://example.com/video" },
                type: "external",
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          next_cursor: null,
          results: [
            {
              has_children: false,
              id: "99999999-9999-4999-8999-999999999999",
              numbered_list_item: { rich_text: [{ plain_text: "중첩" }] },
              object: "block",
              type: "numbered_list_item",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          next_cursor: null,
          results: [
            {
              has_children: false,
              id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
              object: "block",
              paragraph: { rich_text: [{ plain_text: "추가 설명" }] },
              type: "paragraph",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          next_cursor: null,
          results: [
            {
              has_children: false,
              id: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb",
              object: "block",
              table_row: {
                cells: [[{ plain_text: "항목" }], [{ plain_text: "값" }]],
              },
              type: "table_row",
            },
            {
              has_children: false,
              id: "cccccccc-1111-4111-8111-cccccccccccc",
              object: "block",
              table_row: {
                cells: [[{ plain_text: "첫째" }], [{ plain_text: "둘째" }]],
              },
              type: "table_row",
            },
          ],
        }),
      );
    const adapter = new NotionRestContentAdapter({
      accessToken: "secret",
      apiVersion: "2026-03-11",
      fetch: fetchMock,
    });

    const content = await adapter.getPageContent(ROOT_ID);

    expect(content.blocks).toMatchObject([
      {
        children: [{ kind: "listItem", style: "numbered" }],
        kind: "listItem",
        style: "bulleted",
      },
      { checked: true, kind: "toDo" },
      {
        children: [{ kind: "paragraph" }],
        icon: "📌",
        kind: "callout",
      },
      {
        hasColumnHeader: true,
        hasRowHeader: true,
        kind: "table",
        rows: [
          [[{ text: "항목" }], [{ text: "값" }]],
          [[{ text: "첫째" }], [{ text: "둘째" }]],
        ],
      },
      { expression: "E = mc^2", kind: "equation" },
      {
        caption: [{ text: "공식 문서" }],
        kind: "linkCard",
        url: "https://example.com/docs",
      },
      {
        caption: [{ text: "외부 영상" }],
        kind: "media",
        mediaType: "video",
        url: "https://example.com/video",
      },
    ]);
  });

  it("normalizes only exact reserved publishing properties", async () => {
    const sourcePage = page(
      ROOT_ID,
      "게시할 글",
      { type: "workspace", workspace: "true" },
      { created_time: "2026-07-18T09:00:00.000Z" },
    );
    sourcePage.properties = {
      ...sourcePage.properties,
      "Blog Category": {
        id: "category",
        select: {
          color: "blue",
          id: "category-option",
          name: "Engineering",
        },
        type: "select",
      },
      "Blog Description": {
        id: "description",
        rich_text: [
          {
            annotations: { bold: true },
            href: "https://example.com/private-provider-shape",
            plain_text: "설명 ",
          },
          { plain_text: "본문" },
        ],
        type: "rich_text",
      },
      "Blog Published At": {
        date: {
          end: "2026-08-10",
          start: "2026-08-09",
          time_zone: null,
        },
        id: "published-at",
        type: "date",
      },
      "Blog Tags": {
        id: "tags",
        multi_select: [
          { color: "green", id: "tag-1", name: "TypeScript" },
          { color: "orange", id: "tag-2", name: "Astro" },
        ],
        type: "multi_select",
      },
      "blog category": {
        id: "lowercase-alias",
        select: { name: "Must not leak" },
        type: "select",
      },
      Secret: {
        files: [{ external: { url: "https://example.com/private" } }],
        id: "secret",
        type: "files",
      },
    };
    const adapter = new NotionRestContentAdapter({
      accessToken: "secret",
      apiVersion: "2026-03-11",
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(sourcePage))
        .mockResolvedValueOnce(
          Response.json({
            has_more: false,
            next_cursor: null,
            results: [],
          }),
        ),
    });

    const content = await adapter.getPageContent(ROOT_ID);

    // 제거한 Blog Category·Blog Description은 읽지 않는다.
    expect(content.publishingProperties).toEqual({
      "Blog Published At": { kind: "date", start: "2026-08-09" },
      "Blog Tags": {
        kind: "multi_select",
        names: ["TypeScript", "Astro"],
      },
    });
    expect(JSON.stringify(content)).not.toContain("category-option");
    expect(JSON.stringify(content)).not.toContain("private-provider-shape");
    expect(JSON.stringify(content)).not.toContain("Must not leak");
    expect(JSON.stringify(content)).not.toContain("Secret");
  });

  it("lowers well-formed wrong property types without raw values", async () => {
    const sourcePage = page(
      ROOT_ID,
      "게시할 글",
      { type: "workspace", workspace: "true" },
      { created_time: "2026-07-18T09:00:00.000Z" },
    );
    sourcePage.properties = {
      ...sourcePage.properties,
      "Blog Slug": {
        date: null,
        id: "slug",
        type: "date",
      },
      "Blog Published At": {
        formula: { string: "must not leak", type: "string" },
        id: "published-at",
        type: "formula",
      },
      "Blog Tags": {
        id: "tags",
        select: null,
        type: "select",
      },
    };
    const adapter = new NotionRestContentAdapter({
      accessToken: "secret",
      apiVersion: "2026-03-11",
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(sourcePage))
        .mockResolvedValueOnce(
          Response.json({
            has_more: false,
            next_cursor: null,
            results: [],
          }),
        ),
    });

    const content = await adapter.getPageContent(ROOT_ID);
    expect(content).toMatchObject({
      publishingProperties: {
        "Blog Slug": {
          kind: "unsupported",
          providerType: "date",
        },
        "Blog Published At": {
          kind: "unsupported",
          providerType: "formula",
        },
        "Blog Tags": {
          kind: "unsupported",
          providerType: "select",
        },
      },
    });
    expect(JSON.stringify(content)).not.toContain("must not leak");
  });

  it("rejects malformed reserved property envelopes", async () => {
    const malformedProperties: unknown[] = [
      "not-an-envelope",
      { id: "category", select: null },
      { id: "category", type: "select" },
      { id: "category", multi_select: [{ name: 42 }], type: "multi_select" },
      {
        id: "category",
        rich_text: [{ href: null }],
        type: "rich_text",
      },
      { id: "category", multi_select: {}, type: "multi_select" },
      { date: {}, id: "category", type: "date" },
      { id: "category", type: "formula" },
    ];

    for (const malformedProperty of malformedProperties) {
      const sourcePage = page(
        ROOT_ID,
        "게시할 글",
        { type: "workspace", workspace: "true" },
        { created_time: "2026-07-18T09:00:00.000Z" },
      );
      sourcePage.properties = {
        ...sourcePage.properties,
        "Blog Tags": malformedProperty,
      };
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(sourcePage));
      const adapter = new NotionRestContentAdapter({
        accessToken: "secret",
        apiVersion: "2026-03-11",
        fetch: fetchMock,
      });

      await expect(adapter.getPageContent(ROOT_ID)).rejects.toMatchObject({
        code: "invalid_response",
      } satisfies Partial<NotionProviderError>);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("enforces provider count, text length, and byte caps", async () => {
    const overLimitProperties: unknown[] = [
      {
        id: "description",
        rich_text: Array.from({ length: 101 }, () => ({ plain_text: "x" })),
        type: "rich_text",
      },
      {
        id: "description",
        rich_text: [{ plain_text: "x".repeat(2_001) }],
        type: "rich_text",
      },
      {
        id: "description",
        multi_select: Array.from({ length: 101 }, (_, index) => ({
          name: `tag-${index}`,
        })),
        type: "multi_select",
      },
      {
        formula: { string: "🔥".repeat(125_000), type: "string" },
        id: "description",
        type: "formula",
      },
    ];

    for (const overLimitProperty of overLimitProperties) {
      const sourcePage = page(
        ROOT_ID,
        "게시할 글",
        { type: "workspace", workspace: "true" },
        { created_time: "2026-07-18T09:00:00.000Z" },
      );
      sourcePage.properties = {
        ...sourcePage.properties,
        "Blog Slug": overLimitProperty,
      };
      const adapter = new NotionRestContentAdapter({
        accessToken: "secret",
        apiVersion: "2026-03-11",
        fetch: vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(Response.json(sourcePage)),
      });

      await expect(adapter.getPageContent(ROOT_ID)).rejects.toMatchObject({
        code: "invalid_response",
      } satisfies Partial<NotionProviderError>);
    }
  });

  it("paginates every visible page and builds a safe parent tree", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          has_more: true,
          next_cursor: "cursor-2",
          object: "list",
          results: [
            page(ROOT_ID, "루트", { type: "workspace", workspace: "true" }, {
              icon: {
                external: { url: "https://example.com/icon.png" },
                type: "external",
              },
            }),
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          next_cursor: null,
          object: "list",
          results: [
            page(CHILD_ID, "하위 문서", {
              page_id: ROOT_ID,
              type: "page_id",
            }),
            page(UNKNOWN_PARENT_ID, "직접 공유된 문서", {
              page_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              type: "page_id",
            }),
          ],
        }),
      );
    const adapter = new NotionRestContentAdapter({
      accessToken: "secret-notion-token",
      apiVersion: "2026-03-11",
      fetch: fetchMock,
    });

    await expect(adapter.listPageTree()).resolves.toEqual([
      {
        hasChildren: true,
        iconUrl: "https://example.com/icon.png",
        lastEditedAt: new Date("2026-07-19T10:00:00.000Z"),
        parentContainerId: null,
        parentPageId: null,
        providerPageId: ROOT_ID,
        title: "루트",
      },
      {
        hasChildren: false,
        iconUrl: null,
        lastEditedAt: new Date("2026-07-19T10:00:00.000Z"),
        parentContainerId: null,
        parentPageId: ROOT_ID,
        providerPageId: CHILD_ID,
        title: "하위 문서",
      },
      {
        hasChildren: false,
        iconUrl: null,
        lastEditedAt: new Date("2026-07-19T10:00:00.000Z"),
        parentContainerId: null,
        parentPageId: null,
        providerPageId: UNKNOWN_PARENT_ID,
        title: "직접 공유된 문서",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({
        authorization: "Bearer secret-notion-token",
        "notion-version": "2026-03-11",
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual(
      expect.objectContaining({ start_cursor: "cursor-2" }),
    );
  });

  it("surfaces provider rate limits with a bounded retry delay", async () => {
    const adapter = new NotionRestContentAdapter({
      accessToken: "secret",
      apiVersion: "2026-03-11",
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(null, {
            headers: { "retry-after": "7200" },
            status: 429,
          }),
        ),
    });

    await expect(adapter.listPageTree()).rejects.toMatchObject({
      code: "rate_limited",
      retryAfterSeconds: 3_600,
    } satisfies Partial<NotionProviderError>);
  });

  it("nests data source row pages under the database parent page", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          next_cursor: null,
          results: [
            page(ROOT_ID, "자기소개서", {
              type: "workspace",
              workspace: "true",
            }),
            page(CHILD_ID, "스테이터스 보드 항목", {
              database_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              data_source_id: DATA_SOURCE_ID,
              type: "data_source_id",
            }),
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          next_cursor: null,
          results: [
            {
              database_parent: {
                page_id: ROOT_ID,
                type: "page_id",
              },
              id: DATA_SOURCE_ID,
              object: "data_source",
              properties: {},
            },
          ],
        }),
      );
    const adapter = new NotionRestContentAdapter({
      accessToken: "secret",
      apiVersion: "2026-03-11",
      fetch: fetchMock,
    });

    await expect(adapter.listPageTree()).resolves.toMatchObject([
      {
        hasChildren: true,
        parentPageId: null,
        providerPageId: ROOT_ID,
      },
      {
        hasChildren: false,
        parentContainerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        parentPageId: ROOT_ID,
        providerPageId: CHILD_ID,
      },
    ]);
    expect(
      JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)),
    ).toMatchObject({
      filter: { property: "object", value: "data_source" },
    });
  });

  it("nests a toggle-owned page under the page that holds the toggle", async () => {
    const toggleId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const outerToggleId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          next_cursor: null,
          results: [
            page(ROOT_ID, "Legacy", { type: "workspace", workspace: "true" }),
            page(CHILD_ID, "토글 내부 페이지", { block_id: toggleId, type: "block_id" }),
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ id: toggleId, object: "block", parent: { block_id: outerToggleId, type: "block_id" } }),
      )
      .mockResolvedValueOnce(
        Response.json({ id: outerToggleId, object: "block", parent: { page_id: ROOT_ID, type: "page_id" } }),
      );
    const adapter = new NotionRestContentAdapter({ accessToken: "secret", apiVersion: "2026-03-11", fetch: fetchMock });

    await expect(adapter.listPageTree()).resolves.toEqual([
      expect.objectContaining({ hasChildren: true, parentPageId: null, providerPageId: ROOT_ID }),
      expect.objectContaining({
        hasChildren: false,
        parentContainerId: toggleId,
        parentPageId: ROOT_ID,
        providerPageId: CHILD_ID,
      }),
    ]);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(`https://api.notion.com/v1/blocks/${toggleId}`);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("leaves a toggle-owned page without a parent when its block cannot be read", async () => {
    const toggleId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const adapter = new NotionRestContentAdapter({
      accessToken: "secret",
      apiVersion: "2026-03-11",
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({
            has_more: false,
            next_cursor: null,
            results: [
              page(ROOT_ID, "자기소개서", { type: "workspace", workspace: "true" }),
              page(CHILD_ID, "토글 내부 페이지", { block_id: toggleId, type: "block_id" }),
            ],
          }),
        )
        .mockResolvedValueOnce(new Response(null, { status: 404 })),
    });

    await expect(adapter.listPageTree()).resolves.toEqual([
      expect.objectContaining({ hasChildren: false, parentPageId: null, providerPageId: ROOT_ID }),
      expect.objectContaining({ parentContainerId: toggleId, parentPageId: null, providerPageId: CHILD_ID }),
    ]);
  });

  it("preserves a legacy toggle title around its child page outline", async () => {
    const toggleId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          next_cursor: null,
          results: [
            {
              has_children: true,
              id: toggleId,
              object: "block",
              toggle: {
                color: "default",
                rich_text: [{ plain_text: "스테이터스 보드" }],
              },
              type: "toggle",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          next_cursor: null,
          results: [
            {
              child_page: { title: "지원서 초안" },
              has_children: false,
              id: CHILD_ID,
              object: "block",
              type: "child_page",
            },
          ],
        }),
      );
    const adapter = new NotionRestContentAdapter({
      accessToken: "secret",
      apiVersion: "2026-03-11",
      fetch: fetchMock,
    });

    await expect(adapter.listPageOutline(ROOT_ID)).resolves.toEqual([
      {
        kind: "toggle",
        nodeId: toggleId,
        parentNodeId: null,
        providerId: null,
        title: "스테이터스 보드",
      },
      {
        kind: "page",
        nodeId: CHILD_ID,
        parentNodeId: toggleId,
        providerId: CHILD_ID,
        title: "지원서 초안",
      },
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `/blocks/${ROOT_ID}/children`,
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      `/blocks/${toggleId}/children`,
    );
  });

  it("does not classify a prose-only toggle as navigation", async () => {
    const toggleId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const adapter = new NotionRestContentAdapter({
      accessToken: "secret",
      apiVersion: "2026-03-11",
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({
            has_more: false,
            next_cursor: null,
            results: [
              {
                has_children: true,
                id: toggleId,
                object: "block",
                toggle: {
                  rich_text: [{ plain_text: "설명 더 보기" }],
                },
                type: "toggle",
              },
            ],
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            has_more: false,
            next_cursor: null,
            results: [
              {
                has_children: false,
                id: CHILD_ID,
                object: "block",
                paragraph: {
                  rich_text: [{ plain_text: "설명 본문" }],
                },
                type: "paragraph",
              },
            ],
          }),
        ),
    });

    await expect(adapter.listPageOutline(ROOT_ID)).resolves.toEqual([]);
  });

  it("preserves toggle headings and titled structural groups", async () => {
    const headingId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const columnListId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const columnId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const calloutId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          next_cursor: null,
          results: [
            {
              has_children: true,
              heading_2: {
                is_toggleable: true,
                rich_text: [{ plain_text: "토글 헤딩" }],
              },
              id: headingId,
              object: "block",
              type: "heading_2",
            },
            {
              column_list: {},
              has_children: true,
              id: columnListId,
              object: "block",
              type: "column_list",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          next_cursor: null,
          results: [
            {
              child_page: { title: "헤딩 내부 문서" },
              has_children: false,
              id: CHILD_ID,
              object: "block",
              type: "child_page",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          next_cursor: null,
          results: [
            {
              column: {},
              has_children: true,
              id: columnId,
              object: "block",
              type: "column",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          next_cursor: null,
          results: [
            {
              callout: {
                rich_text: [{ plain_text: "자료 모음" }],
              },
              has_children: true,
              id: calloutId,
              object: "block",
              type: "callout",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          next_cursor: null,
          results: [
            {
              child_page: { title: "콜아웃 내부 문서" },
              has_children: false,
              id: UNKNOWN_PARENT_ID,
              object: "block",
              type: "child_page",
            },
          ],
        }),
      );
    const adapter = new NotionRestContentAdapter({
      accessToken: "secret",
      apiVersion: "2026-03-11",
      fetch: fetchMock,
    });

    await expect(adapter.listPageOutline(ROOT_ID)).resolves.toEqual([
      {
        kind: "toggle",
        nodeId: headingId,
        parentNodeId: null,
        providerId: null,
        title: "토글 헤딩",
      },
      {
        kind: "page",
        nodeId: CHILD_ID,
        parentNodeId: headingId,
        providerId: CHILD_ID,
        title: "헤딩 내부 문서",
      },
      {
        kind: "group",
        nodeId: calloutId,
        parentNodeId: null,
        providerId: null,
        title: "자료 모음",
      },
      {
        kind: "page",
        nodeId: UNKNOWN_PARENT_ID,
        parentNodeId: calloutId,
        providerId: UNKNOWN_PARENT_ID,
        title: "콜아웃 내부 문서",
      },
    ]);
  });

  it("follows synced blocks and resolves link-to-page provider IDs", async () => {
    const syncedId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const sourceBlockId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const linkBlockId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const adapter = new NotionRestContentAdapter({
      accessToken: "secret",
      apiVersion: "2026-03-11",
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({
            has_more: false,
            next_cursor: null,
            results: [
              {
                has_children: false,
                id: syncedId,
                object: "block",
                synced_block: {
                  synced_from: {
                    block_id: sourceBlockId,
                    type: "block_id",
                  },
                },
                type: "synced_block",
              },
            ],
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            has_more: false,
            next_cursor: null,
            results: [
              {
                has_children: false,
                id: linkBlockId,
                link_to_page: {
                  page_id: CHILD_ID,
                  type: "page_id",
                },
                object: "block",
                type: "link_to_page",
              },
            ],
          }),
        ),
    });

    await expect(adapter.listPageOutline(ROOT_ID)).resolves.toEqual([
      {
        kind: "page",
        nodeId: linkBlockId,
        parentNodeId: null,
        providerId: CHILD_ID,
        title: "연결된 페이지",
      },
    ]);
  });

  it("uses tab labels as groups and stops synced-block cycles", async () => {
    const tabId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const labelId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const syncedId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const sourceBlockId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          next_cursor: null,
          results: [
            {
              has_children: true,
              id: tabId,
              object: "block",
              tab: {},
              type: "tab",
            },
            {
              has_children: false,
              id: syncedId,
              object: "block",
              synced_block: {
                synced_from: {
                  block_id: sourceBlockId,
                  type: "block_id",
                },
              },
              type: "synced_block",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          next_cursor: null,
          results: [
            {
              has_children: true,
              id: labelId,
              object: "block",
              paragraph: {
                rich_text: [{ plain_text: "첫 번째 탭" }],
              },
              type: "paragraph",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          next_cursor: null,
          results: [
            {
              child_page: { title: "탭 내부 문서" },
              has_children: false,
              id: CHILD_ID,
              object: "block",
              type: "child_page",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          next_cursor: null,
          results: [
            {
              has_children: false,
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              object: "block",
              synced_block: {
                synced_from: {
                  block_id: sourceBlockId,
                  type: "block_id",
                },
              },
              type: "synced_block",
            },
          ],
        }),
      );
    const adapter = new NotionRestContentAdapter({
      accessToken: "secret",
      apiVersion: "2026-03-11",
      fetch: fetchMock,
    });

    await expect(adapter.listPageOutline(ROOT_ID)).resolves.toEqual([
      {
        kind: "group",
        nodeId: labelId,
        parentNodeId: null,
        providerId: null,
        title: "첫 번째 탭",
      },
      {
        kind: "page",
        nodeId: CHILD_ID,
        parentNodeId: labelId,
        providerId: CHILD_ID,
        title: "탭 내부 문서",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("rejects a malformed link-to-page provider response", async () => {
    const adapter = new NotionRestContentAdapter({
      accessToken: "secret",
      apiVersion: "2026-03-11",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          has_more: false,
          next_cursor: null,
          results: [
            {
              has_children: false,
              id: CHILD_ID,
              link_to_page: { type: "page_id" },
              object: "block",
              type: "link_to_page",
            },
          ],
        }),
      ),
    });

    await expect(adapter.listPageOutline(ROOT_ID)).rejects.toMatchObject({
      code: "invalid_response",
    } satisfies Partial<NotionProviderError>);
  });

  it("rejects malformed pagination instead of looping", async () => {
    const adapter = new NotionRestContentAdapter({
      accessToken: "secret",
      apiVersion: "2026-03-11",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          has_more: true,
          next_cursor: null,
          results: [],
        }),
      ),
    });

    await expect(adapter.listPageTree()).rejects.toMatchObject({
      code: "invalid_response",
    } satisfies Partial<NotionProviderError>);
  });
});

describe("Notion provider timeout", () => {
  it("maps a stalled content request to a stable timeout error", async () => {
    const adapter = new NotionRestContentAdapter({
      accessToken: "secret",
      apiVersion: "2026-03-11",
      fetch: vi.fn(() => new Promise<Response>(() => undefined)),
      log: () => undefined,
      timeoutMs: 5,
    });

    await expect(adapter.listPageTree()).rejects.toMatchObject({
      code: "timeout",
    } satisfies Partial<NotionProviderError>);
  });
});
