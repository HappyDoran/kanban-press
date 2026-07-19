import {
  createGitHubAuthDependencies,
  logout,
} from "../../../lib/auth/github";

export const dynamic = "force-dynamic";

export function POST(request: Request): Response {
  return logout(request, createGitHubAuthDependencies());
}
