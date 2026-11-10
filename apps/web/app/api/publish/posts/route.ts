import { createPublishDependencies, listPublishedPosts } from "../../../../lib/publish/orchestration";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return listPublishedPosts(request, createPublishDependencies());
}
