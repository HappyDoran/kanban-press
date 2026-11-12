import { createPublishDependencies } from "@/lib/server/publish/orchestration";
import { previewNotionPage } from "@/lib/server/publish/preview-orchestration";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return previewNotionPage(request, createPublishDependencies());
}
