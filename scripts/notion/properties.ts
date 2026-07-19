import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints.js';

type Property = PageObjectResponse['properties'][string];
export const getTitle = (p?: Property) => p?.type === 'title' ? p.title.map(v => v.plain_text).join('') : '';
export const getText = (p?: Property) => p?.type === 'rich_text' ? p.rich_text.map(v => v.plain_text).join('') : '';
export const getStatus = (p?: Property) => p?.type === 'status' ? p.status?.name ?? '' : p?.type === 'select' ? p.select?.name ?? '' : '';
export const getSelect = (p?: Property) => p?.type === 'select' ? p.select?.name ?? '' : '';
export const getMultiSelect = (p?: Property) => p?.type === 'multi_select' ? p.multi_select.map(v => v.name) : [];
export const getDate = (p?: Property) => p?.type === 'date' ? p.date?.start ?? '' : '';
