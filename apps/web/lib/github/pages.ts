import type { SessionCodec } from "@notion-kanban-blog/auth";
import type {
  GitHubArtifact,
  GitHubCommitResult,
  GitHubDeploymentStatus,
  GitHubRepository,
  GitHubRepositoryAdapter,
} from "@notion-kanban-blog/github";
import { z } from "zod";

import {
  createGitHubAuthDependencies,
  errorResponse,
  readCookie,
  SESSION_COOKIE,
} from "../auth/github";

const GITHUB_API_ORIGIN = "https://api.github.com";
const loginSchema = z
  .string()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/);
const numericIdSchema = z.string().regex(/^[1-9]\d{0,19}$/);
const environmentSchema = z.object({
  GITHUB_API_VERSION: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const repositorySchema = z
  .object({
    default_branch: z.string().min(1).max(255),
    full_name: z.string().min(3).max(255),
    id: z.number().int().safe().positive(),
    name: z.string().min(1).max(255),
    owner: z
      .object({
        id: z.number().int().safe().positive(),
        login: z.string().min(1).max(255),
        type: z.literal("User"),
      })
      .passthrough(),
    permissions: z
      .object({
        push: z.boolean(),
      })
      .passthrough(),
    private: z.boolean(),
  })
  .passthrough();
const gitShaSchema = z.string().regex(/^[a-f0-9]{40,64}$/);
const gitRefSchema = z
  .object({ object: z.object({ sha: gitShaSchema }).passthrough() })
  .passthrough();
const gitCommitSchema = z
  .object({
    sha: gitShaSchema,
    tree: z.object({ sha: gitShaSchema }).passthrough(),
  })
  .passthrough();
const gitObjectSchema = z.object({ sha: gitShaSchema }).passthrough();
const workflowRunsSchema = z
  .object({
    workflow_runs: z.array(
      z
        .object({
          conclusion: z.string().nullable(),
          head_sha: gitShaSchema,
          html_url: z.string().url(),
          status: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const pagesDeploymentSchema = z
  .object({ status: z.string() })
  .passthrough();

export interface GitHubPagesDependencies {
  client: GitHubRepositoryAdapter;
  sessionCodec: SessionCodec;
}

interface GitHubPagesClientOptions {
  accessToken: string;
  apiVersion: string;
  fetch?: typeof fetch;
}

export class GitHubPagesClient implements GitHubRepositoryAdapter {
  readonly #accessToken: string;
  readonly #apiVersion: string;
  readonly #fetch: typeof fetch;

  constructor(options: GitHubPagesClientOptions) {
    this.#accessToken = z.string().min(1).max(4096).parse(options.accessToken);
    this.#apiVersion = environmentSchema.shape.GITHUB_API_VERSION.parse(
      options.apiVersion,
    );
    this.#fetch = options.fetch ?? fetch;
  }

  async getPagesRepository(
    ownerUserId: string,
    ownerLogin: string,
  ): Promise<GitHubRepository> {
    const parsedOwnerId = numericIdSchema.parse(ownerUserId);
    const parsedLogin = loginSchema.parse(ownerLogin);
    const repositoryName = `${parsedLogin}.github.io`;
    const response = await this.#fetch(
      `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(parsedLogin)}/${encodeURIComponent(repositoryName)}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${this.#accessToken}`,
          "user-agent": "notion-kanban-blog",
          "x-github-api-version": this.#apiVersion,
        },
      },
    );
    if (!response.ok) {
      throw providerError(response);
    }
    if (!hasPublishingScopes(response.headers.get("x-oauth-scopes"))) {
      throw new GitHubPagesError("oauth_scope_missing");
    }

    const parsed = repositorySchema.safeParse(await safeJson(response));
    if (!parsed.success) {
      throw new GitHubPagesError("invalid_response");
    }
    const repository = parsed.data;
    if (
      String(repository.owner.id) !== parsedOwnerId ||
      repository.owner.login.toLowerCase() !== parsedLogin.toLowerCase() ||
      repository.name.toLowerCase() !== repositoryName.toLowerCase() ||
      repository.full_name.toLowerCase() !==
        `${parsedLogin}/${repositoryName}`.toLowerCase()
    ) {
      throw new GitHubPagesError("repository_owner_mismatch");
    }
    if (repository.private) {
      throw new GitHubPagesError("repository_must_be_public");
    }
    if (!repository.permissions.push) {
      throw new GitHubPagesError("repository_write_denied");
    }
    return {
      defaultBranch: repository.default_branch,
      fullName: repository.full_name,
      isPrivate: repository.private,
      providerRepositoryId: String(repository.id),
    };
  }

  async commitArtifacts(
    repository: GitHubRepository,
    artifacts: readonly GitHubArtifact[],
    message: string,
  ): Promise<GitHubCommitResult> {
    const target = repositoryTarget(repository);
    const parsedMessage = z.string().trim().min(1).max(250).parse(message);
    const parsedArtifacts = parseArtifacts(artifacts);
    const encodedBranch = encodeURIComponent(repository.defaultBranch);
    const reference = await this.#optionalJson(
      `${GITHUB_API_ORIGIN}/repos/${target}/git/ref/heads/${encodedBranch}`,
      gitRefSchema,
      new Set([404, 409]),
    );
    const headCommit =
      reference === null
        ? null
        : await this.#json(
            `/repos/${target}/git/commits/${reference.object.sha}`,
            gitCommitSchema,
          );
    const treeEntries = await Promise.all(
      parsedArtifacts.map(async (artifact) => {
        const blob = await this.#json(
          `/repos/${target}/git/blobs`,
          gitObjectSchema,
          {
            body: JSON.stringify({
              content: Buffer.from(artifact.bytes).toString("base64"),
              encoding: "base64",
            }),
            method: "POST",
          },
        );
        return {
          mode: "100644",
          path: artifact.path,
          sha: blob.sha,
          type: "blob",
        };
      }),
    );
    const tree = await this.#json(
      `/repos/${target}/git/trees`,
      gitObjectSchema,
      {
        body: JSON.stringify({
          ...(headCommit === null ? {} : { base_tree: headCommit.tree.sha }),
          tree: treeEntries,
        }),
        method: "POST",
      },
    );
    const commit = await this.#json(
      `/repos/${target}/git/commits`,
      gitCommitSchema,
      {
        body: JSON.stringify({
          message: parsedMessage,
          ...(headCommit === null ? {} : { parents: [headCommit.sha] }),
          tree: tree.sha,
        }),
        method: "POST",
      },
    );
    if (headCommit === null) {
      await this.#json(
        `/repos/${target}/git/refs`,
        gitRefSchema,
        {
          body: JSON.stringify({
            ref: `refs/heads/${repository.defaultBranch}`,
            sha: commit.sha,
          }),
          method: "POST",
        },
        true,
      );
    } else {
      await this.#json(
        `/repos/${target}/git/refs/heads/${encodedBranch}`,
        gitRefSchema,
        {
          body: JSON.stringify({ force: false, sha: commit.sha }),
          method: "PATCH",
        },
        true,
      );
    }
    return { commitSha: commit.sha, created: true };
  }

  async getDeploymentStatus(
    repository: GitHubRepository,
    commitSha: string,
  ): Promise<GitHubDeploymentStatus> {
    const target = repositoryTarget(repository);
    const sha = gitShaSchema.parse(commitSha);
    const workflowUrl = new URL(
      `${GITHUB_API_ORIGIN}/repos/${target}/actions/workflows/deploy.yml/runs`,
    );
    workflowUrl.searchParams.set("event", "push");
    workflowUrl.searchParams.set("head_sha", sha);
    workflowUrl.searchParams.set("per_page", "10");
    const [workflow, pages] = await Promise.all([
      this.#optionalJson(workflowUrl, workflowRunsSchema),
      this.#optionalJson(
        `${GITHUB_API_ORIGIN}/repos/${target}/pages/deployments/${sha}`,
        pagesDeploymentSchema,
      ),
    ]);
    const run =
      workflow?.workflow_runs.find((candidate) => candidate.head_sha === sha) ??
      null;
    const pageUrl = `https://${repository.fullName.split("/")[0]}.github.io/`;

    if (pages?.status === "succeed") {
      return {
        actionsUrl: run?.html_url ?? null,
        pageUrl,
        state: "succeeded",
      };
    }
    if (
      pages !== null &&
      ["cancelled", "error", "errored", "failed"].includes(pages.status)
    ) {
      return {
        actionsUrl: run?.html_url ?? null,
        pageUrl,
        state: "failed",
      };
    }
    if (
      run?.status === "completed" &&
      run.conclusion !== "success" &&
      run.conclusion !== "neutral" &&
      run.conclusion !== "skipped"
    ) {
      return { actionsUrl: run.html_url, pageUrl, state: "failed" };
    }
    if (run?.status === "completed" && run.conclusion === "success") {
      return { actionsUrl: run.html_url, pageUrl, state: "in_progress" };
    }
    return {
      actionsUrl: run?.html_url ?? null,
      pageUrl,
      state: run?.status === "in_progress" ? "in_progress" : "queued",
    };
  }

  async #json<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit = {},
    conflictOnFailure = false,
  ): Promise<T> {
    const response = await this.#fetch(
      path.startsWith("https:") ? path : `${GITHUB_API_ORIGIN}${path}`,
      {
        ...init,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${this.#accessToken}`,
          "content-type": "application/json",
          "user-agent": "notion-kanban-blog",
          "x-github-api-version": this.#apiVersion,
          ...init.headers,
        },
      },
    );
    if (!response.ok) {
      if (
        conflictOnFailure &&
        (response.status === 409 || response.status === 422)
      ) {
        throw new GitHubPagesError("conflict");
      }
      throw providerError(response, "git_resource_not_found");
    }
    const parsed = schema.safeParse(await safeJson(response));
    if (!parsed.success) {
      throw new GitHubPagesError("invalid_response");
    }
    return parsed.data;
  }

  async #optionalJson<T>(
    input: string | URL,
    schema: z.ZodType<T>,
    absentStatuses: ReadonlySet<number> = new Set([404]),
  ): Promise<T | null> {
    const response = await this.#fetch(input, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.#accessToken}`,
        "user-agent": "notion-kanban-blog",
        "x-github-api-version": this.#apiVersion,
      },
    });
    if (absentStatuses.has(response.status)) {
      return null;
    }
    if (!response.ok) {
      throw providerError(response, "git_resource_not_found");
    }
    const parsed = schema.safeParse(await safeJson(response));
    if (!parsed.success) {
      throw new GitHubPagesError("invalid_response");
    }
    return parsed.data;
  }
}

export class GitHubPagesError extends Error {
  override readonly name = "GitHubPagesError";

  constructor(
    readonly code:
      | "access_denied"
      | "conflict"
      | "git_resource_not_found"
      | "invalid_response"
      | "oauth_scope_missing"
      | "rate_limited"
      | "repository_must_be_public"
      | "repository_not_found"
      | "repository_owner_mismatch"
      | "repository_write_denied"
      | "unavailable",
  ) {
    super(code);
  }
}

export async function getGitHubPagesRepository(
  request: Request,
  dependencies: Omit<GitHubPagesDependencies, "client"> & {
    createClient: (accessToken: string) => GitHubRepositoryAdapter;
  },
): Promise<Response> {
  const sessionCookie = readCookie(request, SESSION_COOKIE);
  const session =
    sessionCookie === null
      ? null
      : await dependencies.sessionCodec.open(sessionCookie);
  if (session === null) {
    return errorResponse(401, "authentication_required");
  }

  try {
    const repository = await dependencies
      .createClient(session.accessToken)
      .getPagesRepository(session.userId, session.githubLogin);
    return Response.json(
      { repository },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (!(error instanceof GitHubPagesError)) {
      return errorResponse(502, "github_pages_unavailable");
    }
    const status =
      error.code === "repository_not_found"
        ? 404
        : error.code === "rate_limited"
          ? 429
          : error.code === "unavailable" ||
              error.code === "invalid_response"
            ? 502
            : 403;
    return errorResponse(status, error.code);
  }
}

export function createGitHubPagesDependencies(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const parsed = environmentSchema.parse(environment);
  const auth = createGitHubAuthDependencies(environment);
  return {
    createClient: (accessToken: string) =>
      new GitHubPagesClient({
        accessToken,
        apiVersion: parsed.GITHUB_API_VERSION,
      }),
    sessionCodec: auth.sessionCodec,
  };
}

function hasPublishingScopes(value: string | null): boolean {
  if (value === null) {
    return false;
  }
  const scopes = new Set(
    value
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
  );
  return (scopes.has("public_repo") || scopes.has("repo")) &&
    scopes.has("workflow");
}

function repositoryTarget(repository: GitHubRepository): string {
  const [owner, name, ...rest] = repository.fullName.split("/");
  if (
    owner === undefined ||
    name === undefined ||
    rest.length > 0 ||
    !loginSchema.safeParse(owner).success ||
    !z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,100}$/)
      .safeParse(name).success
  ) {
    throw new GitHubPagesError("invalid_response");
  }
  return `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function parseArtifacts(
  artifacts: readonly GitHubArtifact[],
): GitHubArtifact[] {
  if (artifacts.length === 0 || artifacts.length > 200) {
    throw new GitHubPagesError("invalid_response");
  }
  let totalBytes = 0;
  const seen = new Set<string>();
  return artifacts.map((artifact) => {
    if (
      artifact.path.length === 0 ||
      artifact.path.startsWith("/") ||
      artifact.path.length > 1_024 ||
      artifact.path
        .split("/")
        .some(
          (segment) =>
            segment.length === 0 || segment === "." || segment === "..",
        ) ||
      seen.has(artifact.path)
    ) {
      throw new GitHubPagesError("invalid_response");
    }
    if (!(artifact.bytes instanceof Uint8Array)) {
      throw new GitHubPagesError("invalid_response");
    }
    seen.add(artifact.path);
    totalBytes += artifact.bytes.byteLength;
    if (totalBytes > 20 * 1024 * 1024) {
      throw new GitHubPagesError("invalid_response");
    }
    return artifact;
  });
}

function providerError(
  response: Response,
  notFoundCode: "git_resource_not_found" | "repository_not_found" =
    "repository_not_found",
): GitHubPagesError {
  if (
    response.status === 429 ||
    (response.status === 403 &&
      response.headers.get("x-ratelimit-remaining") === "0")
  ) {
    return new GitHubPagesError("rate_limited");
  }
  if (response.status === 404) {
    return new GitHubPagesError(notFoundCode);
  }
  if (response.status === 401 || response.status === 403) {
    return new GitHubPagesError("access_denied");
  }
  return new GitHubPagesError("unavailable");
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
