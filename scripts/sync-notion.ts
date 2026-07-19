import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import slugify from 'slugify';
import pLimit from 'p-limit';
import { createNotionClient } from './notion/client.js';
import { queryWorkflowPages } from './notion/query.js';
import { getAllBlocks } from './notion/blocks.js';
import { blocksToMarkdown, blocksToPlainText } from './converter/notion-to-markdown.js';
import { classify } from './classifier/rules.js';
import { createPostFile } from './sync/frontmatter.js';
import { NOTION_PROPERTIES as P, STATUS } from './config.js';
import { getDate, getMultiSelect, getSelect, getStatus, getText, getTitle } from './notion/properties.js';

const notion = createNotionClient();
const dryRun = process.env.DRY_RUN === 'true';
const outputDir = path.resolve('src/content/blog');
const limit = pLimit(3);

function pageUrl(slug: string) {
  const site = (process.env.SITE_URL ?? 'https://username.github.io').replace(/\/$/, '');
  const base = (process.env.BASE_PATH ?? '/').replace(/^\/?/, '/').replace(/\/$/, '');
  return `${site}${base}/posts/${slug}/`.replace(/([^:]\/)\/+/g, '$1');
}

async function updatePage(pageId: string, properties: Record<string, unknown>) {
  if (dryRun) return console.log('[DRY RUN] update', pageId, properties);
  await notion.pages.update({ page_id: pageId, properties: properties as any });
}

async function processPage(page: Awaited<ReturnType<typeof queryWorkflowPages>>[number]) {
  const title = getTitle(page.properties[P.title]);
  const status = getStatus(page.properties[P.status]);
  const blocks = await getAllBlocks(notion, page.id);
  const plain = blocksToPlainText(blocks);

  if (status === STATUS.review) {
    const result = classify(title, plain);
    await updatePage(page.id, {
      [P.suggestedCategory]: { select: { name: result.category } },
      [P.suggestedTags]: { multi_select: result.tags.map(name => ({ name })) },
      [P.error]: { rich_text: [] },
    });
    console.log(`분류 완료: ${title} → ${result.category} (${result.confidence}%)`);
    return;
  }

  if (status !== STATUS.ready) return;
  const category = getSelect(page.properties[P.category]);
  if (!category) throw new Error(`'${title}'의 카테고리가 비어 있습니다.`);
  const manualSlug = getText(page.properties[P.slug]);
  const slug = manualSlug || slugify(title, { lower: true, strict: true, locale: 'ko' }) || page.id.slice(0, 8);
  const description = getText(page.properties[P.description]) || plain.trim().slice(0, 160);
  const tags = getMultiSelect(page.properties[P.tags]);
  const publishedAt = getDate(page.properties[P.publishedAt]) || new Date().toISOString().slice(0, 10);
  const markdown = blocksToMarkdown(blocks);
  const file = createPostFile({
    title, description, category, tags,
    publishedAt,
    updatedAt: page.last_edited_time,
    notionPageId: page.id,
    sourceUrl: page.url,
    draft: false,
  }, markdown);
  const categoryDir = slugify(category, { lower: true, strict: true }) || 'etc';
  const targetDir = path.join(outputDir, categoryDir);
  const target = path.join(targetDir, `${slug}.md`);
  if (dryRun) console.log(`[DRY RUN] write ${target}`);
  else { await fs.mkdir(targetDir, { recursive: true }); await fs.writeFile(target, file, 'utf8'); }
  await updatePage(page.id, {
    [P.slug]: { rich_text: [{ type: 'text', text: { content: slug } }] },
    [P.publishedAt]: { date: { start: publishedAt } },
    [P.publishedUrl]: { url: pageUrl(`${categoryDir}/${slug}`) },
    [P.lastSyncedAt]: { date: { start: new Date().toISOString() } },
    [P.error]: { rich_text: [] },
    [P.status]: { status: { name: STATUS.published } },
  });
  console.log(`게시 파일 생성: ${title} → ${target}`);
}

async function main() {
  const pages = await queryWorkflowPages(notion);
  console.log(`처리 대상 ${pages.length}개`);
  const results = await Promise.allSettled(pages.map(page => limit(() => processPage(page))));
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  for (const failure of failures) console.error(failure.reason);
  if (failures.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
