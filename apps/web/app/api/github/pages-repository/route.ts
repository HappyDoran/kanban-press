import {
  createGitHubPagesDependencies,
  getGitHubPagesRepository,
} from "../../../../lib/github/pages";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return getGitHubPagesRepository(
    request,
    createGitHubPagesDependencies(),
  );
}
