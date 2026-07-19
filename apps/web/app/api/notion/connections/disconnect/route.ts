import {
  createNotionAuthDependencies,
  disconnectNotion,
} from "../../../../../lib/auth/notion";

export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return disconnectNotion(request, createNotionAuthDependencies());
}
