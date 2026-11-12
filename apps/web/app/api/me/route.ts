import {
  createGitHubAuthDependencies,
  getCurrentUser,
} from "@/lib/server/auth/github";

export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return getCurrentUser(request, createGitHubAuthDependencies());
}
