import { createPublishDependencies } from "../../../../lib/publish/orchestration";
import { previewNotionPage } from "../../../../lib/publish/preview-orchestration";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return previewNotionPage(request, createPublishDependencies());
}
