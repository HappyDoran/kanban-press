import {
  createNotionAuthDependencies,
  finishNotionConnection,
} from "@/lib/server/auth/notion";

export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return finishNotionConnection(request, createNotionAuthDependencies());
}
