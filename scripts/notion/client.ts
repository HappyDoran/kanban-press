import { Client } from '@notionhq/client';

export function createNotionClient() {
  const auth = process.env.NOTION_TOKEN;
  if (!auth) throw new Error('NOTION_TOKEN이 없습니다. .env.example을 참고하세요.');
  return new Client({ auth, notionVersion: '2026-03-11' });
}
