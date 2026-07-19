import {
  createNotionAuthDependencies,
  startNotionConnection,
} from "../../../../lib/auth/notion";

export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return startNotionConnection(request, createNotionAuthDependencies());
}
