import type { BlockObjectResponse, RichTextItemResponse } from '@notionhq/client/build/src/api-endpoints.js';

type WithChildren = BlockObjectResponse & { children?: BlockObjectResponse[] };
const rich = (items: RichTextItemResponse[]) => items.map((item) => {
  let text = item.plain_text.replace(/([\\`*_{}[\]()#+\-.!>])/g, '\\$1');
  if (item.annotations.code) text = `\`${item.plain_text}\``;
  if (item.annotations.bold) text = `**${text}**`;
  if (item.annotations.italic) text = `*${text}*`;
  if (item.annotations.strikethrough) text = `~~${text}~~`;
  return item.href ? `[${text}](${item.href})` : text;
}).join('');

export function blocksToMarkdown(blocks: BlockObjectResponse[], depth = 0): string {
  return blocks.map((raw) => {
    const block = raw as WithChildren;
    const data = block[block.type as keyof BlockObjectResponse] as any;
    const child = block.children?.length ? `\n${blocksToMarkdown(block.children, depth + 1)}` : '';
    switch (block.type) {
      case 'paragraph': return `${rich(data.rich_text)}${child}\n`;
      case 'heading_1': return `# ${rich(data.rich_text)}\n`;
      case 'heading_2': return `## ${rich(data.rich_text)}\n`;
      case 'heading_3': return `### ${rich(data.rich_text)}\n`;
      case 'bulleted_list_item': return `${'  '.repeat(depth)}- ${rich(data.rich_text)}${child}`;
      case 'numbered_list_item': return `${'  '.repeat(depth)}1. ${rich(data.rich_text)}${child}`;
      case 'to_do': return `${'  '.repeat(depth)}- [${data.checked ? 'x' : ' '}] ${rich(data.rich_text)}${child}`;
      case 'quote': return `> ${rich(data.rich_text)}\n`;
      case 'callout': return `> ${data.icon?.emoji ?? '💡'} ${rich(data.rich_text)}\n`;
      case 'divider': return `---\n`;
      case 'code': return `\n\`\`\`${data.language === 'plain text' ? '' : data.language}\n${data.rich_text.map((v: RichTextItemResponse) => v.plain_text).join('')}\n\`\`\`\n`;
      case 'image': {
        const url = data.type === 'external' ? data.external.url : data.file.url;
        const caption = rich(data.caption ?? []);
        return `![${caption}](${url})\n`;
      }
      case 'bookmark': return `[${data.caption?.length ? rich(data.caption) : data.url}](${data.url})\n`;
      case 'toggle': return `<details><summary>${rich(data.rich_text)}</summary>\n\n${child}\n</details>\n`;
      default: return `<!-- 지원하지 않는 Notion 블록: ${block.type} -->\n${child}`;
    }
  }).join('\n');
}

export function blocksToPlainText(blocks: BlockObjectResponse[]): string {
  return blocks.map((raw) => {
    const block = raw as WithChildren;
    const data = block[block.type as keyof BlockObjectResponse] as any;
    const own = data?.rich_text?.map((v: RichTextItemResponse) => v.plain_text).join('') ?? '';
    return `${own} ${block.children ? blocksToPlainText(block.children) : ''}`;
  }).join(' ');
}
