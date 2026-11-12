import {
  createNotionAuthDependencies,
  listNotionConnections,
} from "@/lib/server/auth/notion";

export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return listNotionConnections(request, createNotionAuthDependencies());
}
