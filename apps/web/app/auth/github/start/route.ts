import {
  createGitHubAuthDependencies,
  startGitHubLogin,
} from "@/lib/server/auth/github";

export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return startGitHubLogin(request, createGitHubAuthDependencies());
}
