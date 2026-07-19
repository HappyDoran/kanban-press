import {
  createPublishDependencies,
  getPublishStatus,
} from "../../../../lib/publish/orchestration";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return getPublishStatus(request, createPublishDependencies());
}
