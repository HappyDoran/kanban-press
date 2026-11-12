import {
  createPublishDependencies,
  publishNotionPage,
} from "@/lib/server/publish/orchestration";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return publishNotionPage(request, createPublishDependencies());
}
