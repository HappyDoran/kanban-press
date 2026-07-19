import type { Client } from '@notionhq/client';
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints.js';
import { NOTION_PROPERTIES, STATUS } from '../config.js';

export async function queryWorkflowPages(notion: Client): Promise<PageObjectResponse[]> {
  const id = process.env.NOTION_DATA_SOURCE_ID;
  if (!id) throw new Error('NOTION_DATA_SOURCE_ID가 없습니다.');
  const pages: PageObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    const result = await notion.dataSources.query({
      data_source_id: id,
      start_cursor: cursor,
      page_size: 100,
      filter: {
        or: [
          { property: NOTION_PROPERTIES.status, status: { equals: STATUS.review } },
          { property: NOTION_PROPERTIES.status, status: { equals: STATUS.ready } },
        ],
      },
    });
    for (const item of result.results) if ('properties' in item) pages.push(item as PageObjectResponse);
    cursor = result.has_more ? result.next_cursor ?? undefined : undefined;
  } while (cursor);
  return pages;
}
