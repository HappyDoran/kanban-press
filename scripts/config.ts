export const NOTION_PROPERTIES = {
  title: '제목',
  status: '상태',
  category: '카테고리',
  suggestedCategory: '추천 카테고리',
  tags: '태그',
  suggestedTags: '추천 태그',
  slug: 'Slug',
  description: '설명',
  publishedAt: '게시일',
  publishedUrl: '게시 URL',
  error: '오류 메시지',
  lastSyncedAt: '마지막 동기화',
} as const;

export const STATUS = {
  writing: '작성 중',
  review: '검수',
  ready: '게시 준비',
  published: '게시 완료',
} as const;

export const ALLOWED_CATEGORIES = [
  'Frontend', 'React', 'CS', 'Algorithm', 'iOS', 'Swift', 'SwiftUI', 'DevOps', 'Troubleshooting', 'Etc'
] as const;
