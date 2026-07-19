import {
  createGitHubAuthDependencies,
  finishGitHubLogin,
} from "../../../../lib/auth/github";

export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return finishGitHubLogin(request, createGitHubAuthDependencies());
}
