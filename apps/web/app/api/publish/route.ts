import {
  createPublishDependencies,
  publishNotionPage,
} from "../../../lib/publish/orchestration";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return publishNotionPage(request, createPublishDependencies());
}
