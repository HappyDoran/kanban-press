import {
  createGitHubAuthDependencies,
  getCurrentUser,
} from "../../../lib/auth/github";

export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return getCurrentUser(request, createGitHubAuthDependencies());
}
