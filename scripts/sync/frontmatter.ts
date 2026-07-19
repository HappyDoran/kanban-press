import matter from 'gray-matter';
export function createPostFile(data: Record<string, unknown>, body: string) {
  return `<!-- AUTO-GENERATED FROM NOTION. DO NOT EDIT DIRECTLY. -->\n${matter.stringify(body.trim() + '\n', data)}`;
}
