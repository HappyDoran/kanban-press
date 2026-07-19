import type { Client } from '@notionhq/client';
import type { BlockObjectResponse } from '@notionhq/client/build/src/api-endpoints.js';

export async function getAllBlocks(notion: Client, blockId: string): Promise<BlockObjectResponse[]> {
  const blocks: BlockObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    const result = await notion.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 100 });
    for (const item of result.results) {
      if (!('type' in item)) continue;
      const block = item as BlockObjectResponse;
      if (block.has_children) {
        (block as BlockObjectResponse & { children?: BlockObjectResponse[] }).children = await getAllBlocks(notion, block.id);
      }
      blocks.push(block);
    }
    cursor = result.has_more ? result.next_cursor ?? undefined : undefined;
  } while (cursor);
  return blocks;
}
