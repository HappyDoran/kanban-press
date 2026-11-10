// 사용자 OAuth token으로 `<login>.github.io` 저장소를 읽고 게시 commit을 만드는 GitHub REST client.
// HTTP 요청·응답 검증은 #send·#json·#optional 세 곳만 거친다.
import type { SessionCodec } from "@notion-kanban-blog/auth";
import type {
  GitHubArtifact,
  GitHubCommitResult,
  GitHubDeploymentStatus,
  GitHubPagesReadiness,
  GitHubRepository,
  GitHubRepositoryAdapter,
} from "@notion-kanban-blog/github";
import { createAstroTemplateManifest } from "@notion-kanban-blog/publisher";
import { z } from "zod";

import { createGitHubAuthDependencies } from "../auth/github";
import { errorResponse, readSession } from "../auth/session";
import { parseRetryAfter, providerRequest, ProviderTransportError } from "../operations/provider-request";
import type { LogSink } from "../operations/structured-log";

const GITHUB_API_ORIGIN = "https://api.github.com";
const MAX_ARTIFACTS = 200;
const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;

const apiVersionSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const loginSchema = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/);
const repositoryNameSchema = z.string().regex(/^[A-Za-z0-9._-]{1,100}$/);
const numericIdSchema = z.string().regex(/^[1-9]\d{0,19}$/);
const gitShaSchema = z.string().regex(/^[a-f0-9]{40,64}$/);
const gitPathSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine((path) => path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."));

const repositorySchema = z.object({
  default_branch: z.string().min(1).max(255),
  full_name: z.string().min(3).max(255),
  id: z.number().int().safe().positive(),
  name: z.string().min(1).max(255),
  owner: z.object({
    id: z.number().int().safe().positive(),
    login: z.string().min(1).max(255),
    type: z.literal("User"),
  }),
  permissions: z.object({ push: z.boolean() }),
  private: z.boolean(),
});
const gitObjectSchema = z.object({ sha: gitShaSchema });
const gitRefSchema = z.object({ object: gitObjectSchema });
const gitCommitSchema = z.object({ sha: gitShaSchema, tree: gitObjectSchema });
const gitTreeSchema = z.object({
  tree: z.array(
    z.discriminatedUnion("type", [
      z.object({ mode: z.literal("100644"), path: gitPathSchema, sha: gitShaSchema, type: z.literal("blob") }),
      z.object({ mode: z.literal("040000"), path: gitPathSchema, sha: gitShaSchema, type: z.literal("tree") }),
    ]),
  ),
  truncated: z.boolean(),
});
const workflowRunsSchema = z.object({
  workflow_runs: z.array(
    z.object({
      conclusion: z.string().nullable(),
      head_sha: gitShaSchema,
      html_url: z.string().url(),
      status: z.string(),
    }),
  ),
});
const pagesDeploymentSchema = z.object({ status: z.string() });
const fileContentSchema = z.object({
  content: z.string().max(64 * 1024),
  encoding: z.literal("base64"),
  type: z.literal("file"),
});
const pagesSettingsSchema = z.object({ build_type: z.string() });

// 관리 표식이 없는 저장소에서도 덮어써도 되는 v1 template 파일과 글.
const MANAGED_MARKER_PATH = ".notion-kanban-blog/managed.json";
const LEGACY_V1_PATHS = new Set([
  ".github/workflows/deploy.yml",
  ".gitignore",
  "astro.config.mjs",
  "package.json",
  "pnpm-workspace.yaml",
  "src/content.config.ts",
  "src/content/blog/.gitkeep",
  "src/layouts/BaseLayout.astro",
  "src/pages/index.astro",
  "src/pages/posts/[...slug].astro",
  "tsconfig.json",
]);
const LEGACY_BLOG_POST_PATH = /^src\/content\/blog\/[^/]+\.md$/;
const CONTENT_PATH = /^(?:src\/content\/blog|src\/assets\/blog|public\/posts)\//;
const FAILED_PAGES_STATUSES = new Set(["cancelled", "error", "errored", "failed"]);
const OK_RUN_CONCLUSIONS = new Set(["neutral", "skipped", "success"]);

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
      | "timeout"
      | "unavailable",
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(code);
  }
}

type NotFoundCode = "git_resource_not_found" | "repository_not_found";

export class GitHubPagesClient implements GitHubRepositoryAdapter {
  readonly #accessToken: string;
  readonly #apiVersion: string;
  readonly #fetch: typeof fetch;
  readonly #log: LogSink | undefined;
  readonly #timeoutMs: number | undefined;

  constructor(options: {
    accessToken: string;
    apiVersion: string;
    fetch?: typeof fetch;
    log?: LogSink;
    timeoutMs?: number;
  }) {
    this.#accessToken = z.string().min(1).max(4096).parse(options.accessToken);
    this.#apiVersion = apiVersionSchema.parse(options.apiVersion);
    this.#fetch = options.fetch ?? fetch;
    this.#log = options.log;
    this.#timeoutMs = options.timeoutMs;
  }

  /** 세션 사용자 소유의 공개 `<login>.github.io`이고 push 권한과 게시 scope가 있을 때만 돌려준다. */
  async getPagesRepository(ownerUserId: string, ownerLogin: string): Promise<GitHubRepository> {
    const ownerId = numericIdSchema.parse(ownerUserId);
    const login = loginSchema.parse(ownerLogin);
    const name = `${login}.github.io`;
    const response = await this.#send(`/repos/${encodeURIComponent(login)}/${encodeURIComponent(name)}`, "repository.get");
    if (!response.ok) {
      throw providerError(response, "repository_not_found");
    }
    if (!hasPublishingScopes(response.headers.get("x-oauth-scopes"))) {
      throw new GitHubPagesError("oauth_scope_missing");
    }
    const repository = await parseBody(response, repositorySchema);
    const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
    if (
      String(repository.owner.id) !== ownerId ||
      !same(repository.owner.login, login) ||
      !same(repository.name, name) ||
      !same(repository.full_name, `${login}/${name}`)
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

  /**
   * 기본 branch에 artifact를 쓰고 `deletePaths`를 지우는 commit 하나를 만든다.
   * 빈 저장소면 branch를 만든다. force push는 하지 않는다.
   */
  async commitArtifacts(
    repository: GitHubRepository,
    artifacts: readonly GitHubArtifact[],
    message: string,
    deletePaths: readonly string[] = [],
  ): Promise<GitHubCommitResult> {
    const repo = repositoryPath(repository);
    const commitMessage = z.string().trim().min(1).max(250).parse(message);
    assertArtifacts(artifacts, deletePaths);
    const head = await this.#headCommit(repository);
    if (head === null && deletePaths.length > 0) {
      throw new GitHubPagesError("git_resource_not_found");
    }
    // GitHub는 동시에 몰리는 쓰기 요청을 제한한다(secondary rate limit). 그래서 UTF-8 텍스트는 tree 요청에
    // 내용을 함께 넣고(blob 요청 없음), 이미지 같은 바이너리만 blob을 하나씩 차례로 만든다.
    const written: { content?: string; mode: string; path: string; sha?: string; type: string }[] = [];
    for (const artifact of artifacts) {
      const text = utf8Text(artifact.bytes);
      if (text !== null) {
        written.push({ content: text, mode: "100644", path: artifact.path, type: "blob" });
        continue;
      }
      const blob = await this.#json(`${repo}/git/blobs`, gitObjectSchema, {
        content: Buffer.from(artifact.bytes).toString("base64"),
        encoding: "base64",
      });
      written.push({ mode: "100644", path: artifact.path, sha: blob.sha, type: "blob" });
    }
    // Git trees API는 base tree 위에서 sha가 null인 항목을 삭제로 본다.
    const tree = [...written, ...deletePaths.map((path) => ({ mode: "100644", path, sha: null, type: "blob" }))];
    const newTree = await this.#json(`${repo}/git/trees`, gitObjectSchema, {
      ...(head === null ? {} : { base_tree: head.tree.sha }),
      tree,
    });
    const commit = await this.#json(`${repo}/git/commits`, gitCommitSchema, {
      message: commitMessage,
      ...(head === null ? {} : { parents: [head.sha] }),
      tree: newTree.sha,
    });
    if (head === null) {
      await this.#json(`${repo}/git/refs`, gitRefSchema, {
        ref: `refs/heads/${repository.defaultBranch}`,
        sha: commit.sha,
      });
    } else {
      await this.#json(
        `${repo}/git/refs/heads/${encodeURIComponent(repository.defaultBranch)}`,
        gitRefSchema,
        { force: false, sha: commit.sha },
        "PATCH",
      );
    }
    return { commitSha: commit.sha, created: true };
  }

  /**
   * Pages가 GitHub Actions 빌드로 설정됐는지, 덮어쓸 수 없는 남의 파일이 있는지 본다.
   * 관리 표식이 있으면 우리 저장소로 보고, 없으면 v1 template·글 밖의 파일을 충돌로 돌려준다.
   */
  async getRepositoryReadiness(
    repository: GitHubRepository,
    managedPaths: readonly string[],
  ): Promise<GitHubPagesReadiness> {
    const repo = repositoryPath(repository);
    const paths = parseManagedPaths(managedPaths);
    const [owner, name] = repository.fullName.split("/");
    const base = { managedPaths: paths, pagesSettingsUrl: `https://github.com/${owner}/${name}/settings/pages` };
    let contentPaths: string[] = [];
    const [head, pages] = await Promise.all([
      this.#headCommit(repository),
      this.#optional(`${repo}/pages`, pagesSettingsSchema),
    ]);

    if (head !== null) {
      const response = await this.#send(`${repo}/git/trees/${head.tree.sha}?recursive=1`, "repository.tree");
      if (!response.ok) {
        throw providerError(response, "git_resource_not_found");
      }
      const tree = gitTreeSchema.safeParse(await response.json().catch(() => null));
      const entries = tree.success ? tree.data.tree : [];
      if (!tree.success || tree.data.truncated || new Set(entries.map((entry) => entry.path)).size !== entries.length) {
        return { ...base, conflictingPaths: [], contentPaths: [], state: "repository_not_managed" };
      }
      const blobs = entries.filter((entry) => entry.type === "blob").map((entry) => entry.path);
      contentPaths = blobs.filter((path) => CONTENT_PATH.test(path)).sort((left, right) => left.localeCompare(right));
      const conflictingPaths = blobs.includes(MANAGED_MARKER_PATH)
        ? []
        : blobs
            .filter((path) => !LEGACY_V1_PATHS.has(path) && !LEGACY_BLOG_POST_PATH.test(path))
            .sort((left, right) => left.localeCompare(right));
      if (conflictingPaths.length > 0) {
        return { ...base, conflictingPaths, contentPaths: [], state: "repository_not_managed" };
      }
    }
    return {
      ...base,
      conflictingPaths: [],
      contentPaths,
      state: pages?.build_type === "workflow" ? "ready" : "pages_setup_required",
    };
  }

  /** commit의 Pages 배포 상태. Pages 배포 결과를 먼저 보고, 없으면 deploy.yml workflow run으로 판단한다. */
  async getDeploymentStatus(repository: GitHubRepository, commitSha: string): Promise<GitHubDeploymentStatus> {
    const repo = repositoryPath(repository);
    const sha = gitShaSchema.parse(commitSha);
    const [workflow, pages] = await Promise.all([
      this.#optional(
        `${repo}/actions/workflows/deploy.yml/runs?event=push&head_sha=${sha}&per_page=10`,
        workflowRunsSchema,
      ),
      this.#optional(`${repo}/pages/deployments/${sha}`, pagesDeploymentSchema),
    ]);
    const run = workflow?.workflow_runs.find((candidate) => candidate.head_sha === sha);
    const state: GitHubDeploymentStatus["state"] =
      pages?.status === "succeed"
        ? "succeeded"
        : pages !== null && FAILED_PAGES_STATUSES.has(pages.status)
          ? "failed"
          : run?.status === "completed"
            ? run.conclusion !== null && OK_RUN_CONCLUSIONS.has(run.conclusion)
              ? run.conclusion === "success"
                ? "in_progress" // 빌드는 끝났고 Pages 배포를 기다린다.
                : "queued"
              : "failed"
            : run?.status === "in_progress"
              ? "in_progress"
              : "queued";
    return {
      actionsUrl: safeActionsUrl(repository, run?.html_url),
      pageUrl: `https://${repository.fullName.split("/")[0]?.toLowerCase()}.github.io/`,
      state,
    };
  }

  /** 기본 branch의 작은 텍스트 파일 하나(설정 파일용). 파일이나 branch가 없으면 null. */
  async readFile(repository: GitHubRepository, path: string): Promise<string | null> {
    const repo = repositoryPath(repository);
    const filePath = gitPathSchema.parse(path).split("/").map(encodeURIComponent).join("/");
    const file = await this.#optional(
      `${repo}/contents/${filePath}?ref=${encodeURIComponent(repository.defaultBranch)}`,
      fileContentSchema,
      [404, 409],
    );
    return file === null ? null : Buffer.from(file.content, "base64").toString("utf8");
  }

  /** 기본 branch의 최신 commit. branch가 없는 빈 저장소(404·409)면 null. */
  async #headCommit(repository: GitHubRepository) {
    const repo = repositoryPath(repository);
    const reference = await this.#optional(
      `${repo}/git/ref/heads/${encodeURIComponent(repository.defaultBranch)}`,
      gitRefSchema,
      [404, 409],
    );
    if (reference === null) {
      return null;
    }
    const response = await this.#send(`${repo}/git/commits/${reference.object.sha}`, "git.read");
    if (!response.ok) {
      throw providerError(response, "git_resource_not_found");
    }
    return parseBody(response, gitCommitSchema);
  }

  /** 쓰기 요청. branch ref 갱신의 409·422는 그 사이 branch가 움직인 것이므로 conflict로 본다. */
  async #json<T>(path: string, schema: z.ZodType<T>, body: unknown, method = "POST"): Promise<T> {
    const response = await this.#send(path, "git.write", { body: JSON.stringify(body), method });
    if (path.includes("/git/refs") && (response.status === 409 || response.status === 422)) {
      throw new GitHubPagesError("conflict");
    }
    if (!response.ok) {
      throw providerError(response, "git_resource_not_found");
    }
    return parseBody(response, schema);
  }

  /** 없을 수 있는 자원 읽기. `absent` 상태면 null. */
  async #optional<T>(path: string, schema: z.ZodType<T>, absent = [404]): Promise<T | null> {
    const response = await this.#send(path, "git.read");
    if (absent.includes(response.status)) {
      return null;
    }
    if (!response.ok) {
      throw providerError(response, "git_resource_not_found");
    }
    return parseBody(response, schema);
  }

  async #send(path: string, operation: string, init: { body?: string; method?: string } = {}): Promise<Response> {
    try {
      return await providerRequest({
        fetch: this.#fetch,
        init: {
          ...init,
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${this.#accessToken}`,
            ...(init.body === undefined ? {} : { "content-type": "application/json" }),
            "user-agent": "notion-kanban-blog",
            "x-github-api-version": this.#apiVersion,
          },
        },
        input: `${GITHUB_API_ORIGIN}${path}`,
        log: this.#log,
        operation,
        provider: "github",
        timeoutMs: this.#timeoutMs,
      });
    } catch (error) {
      throw error instanceof ProviderTransportError ? new GitHubPagesError(error.code) : error;
    }
  }
}

/** `/api/github/pages-repository`: 게시 대상 저장소와 준비 상태. token은 응답에 넣지 않는다. */
export async function getGitHubPagesRepository(
  request: Request,
  dependencies: { createClient: (accessToken: string) => GitHubRepositoryAdapter; sessionCodec: SessionCodec },
): Promise<Response> {
  const session = await readSession(request, dependencies.sessionCodec);
  if (session === null) {
    return errorResponse(401, "authentication_required");
  }
  try {
    const client = dependencies.createClient(session.accessToken);
    const repository = await client.getPagesRepository(session.userId, session.githubLogin);
    const [owner = "", name = ""] = repository.fullName.split("/");
    const managedPaths = createAstroTemplateManifest({
      defaultBranch: repository.defaultBranch,
      owner,
      repository: name,
    }).artifacts.map((artifact) => artifact.path);
    const readiness = await client.getRepositoryReadiness(repository, managedPaths);
    return Response.json({ readiness, repository }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (!(error instanceof GitHubPagesError)) {
      return errorResponse(502, "github_pages_unavailable");
    }
    // 이 route만 접두어 없는 code를 쓴다(timeout 제외). 화면이 이 code로 복구 안내를 고른다.
    return gitHubErrorResponse(error, error.code === "timeout" ? "github_timeout" : error.code);
  }
}

export function createGitHubPagesDependencies(environment: NodeJS.ProcessEnv = process.env) {
  const apiVersion = apiVersionSchema.parse(environment.GITHUB_API_VERSION);
  return {
    createClient: (accessToken: string) => new GitHubPagesClient({ accessToken, apiVersion }),
    sessionCodec: createGitHubAuthDependencies(environment).sessionCodec,
  };
}

const GITHUB_ERROR_STATUS: Record<GitHubPagesError["code"], number> = {
  access_denied: 403,
  conflict: 409,
  git_resource_not_found: 502,
  invalid_response: 502,
  oauth_scope_missing: 403,
  rate_limited: 429,
  repository_must_be_public: 403,
  repository_not_found: 404,
  repository_owner_mismatch: 403,
  repository_write_denied: 403,
  timeout: 504,
  unavailable: 502,
};

/** GitHubPagesError → HTTP 응답. rate limit이면 retry-after를 붙인다. */
export function gitHubErrorResponse(error: GitHubPagesError, code = `github_${error.code}`): Response {
  return errorResponse(
    GITHUB_ERROR_STATUS[error.code],
    code,
    error.retryAfterSeconds === null ? {} : { "retry-after": String(error.retryAfterSeconds) },
  );
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** 올바른 UTF-8이고 NUL이 없으면 텍스트로 본다. 아니면 null(바이너리). */
function utf8Text(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) {
    return null;
  }
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    return null;
  }
}

function hasPublishingScopes(value: string | null): boolean {
  const scopes = new Set((value ?? "").split(",").map((scope) => scope.trim()));
  return (scopes.has("public_repo") || scopes.has("repo")) && scopes.has("workflow");
}

/** `/repos/<owner>/<name>`. fullName이 GitHub 이름 규칙을 벗어나면 URL에 넣지 않는다. */
function repositoryPath(repository: GitHubRepository): string {
  const [owner = "", name = "", ...rest] = repository.fullName.split("/");
  if (rest.length > 0 || !loginSchema.safeParse(owner).success || !repositoryNameSchema.safeParse(name).success) {
    throw new GitHubPagesError("invalid_response");
  }
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

/** 저장소에 쓰기 전 마지막 경계: 개수·총 크기·경로가 저장소 안인지·쓰기와 삭제의 중복을 확인한다. */
function assertArtifacts(artifacts: readonly GitHubArtifact[], deletePaths: readonly string[]): void {
  const paths = [...artifacts.map((artifact) => artifact.path), ...deletePaths];
  const totalBytes = artifacts.reduce((sum, artifact) => sum + artifact.bytes.byteLength, 0);
  if (
    paths.length === 0 ||
    paths.length > MAX_ARTIFACTS ||
    deletePaths.some((path) => !gitPathSchema.safeParse(path).success) ||
    totalBytes > MAX_ARTIFACT_BYTES ||
    new Set(paths).size !== paths.length ||
    artifacts.some((artifact) => !(artifact.bytes instanceof Uint8Array) || !gitPathSchema.safeParse(artifact.path).success)
  ) {
    throw new GitHubPagesError("invalid_response");
  }
}

function parseManagedPaths(paths: readonly string[]): string[] {
  if (paths.length === 0 || paths.length > MAX_ARTIFACTS || new Set(paths).size !== paths.length) {
    throw new GitHubPagesError("invalid_response");
  }
  return paths.map((path) => gitPathSchema.parse(path)).sort((left, right) => left.localeCompare(right));
}

/** workflow run URL은 이 저장소의 github.com Actions 경로일 때만 화면에 넘긴다. */
function safeActionsUrl(repository: GitHubRepository, candidate: string | undefined): string | null {
  if (candidate === undefined || !URL.canParse(candidate)) {
    return null;
  }
  const url = new URL(candidate);
  const prefix = `/${repository.fullName}/actions/`.toLowerCase();
  return url.origin === "https://github.com" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname.toLowerCase().startsWith(prefix)
    ? url.href
    : null;
}

function providerError(response: Response, notFound: NotFoundCode): GitHubPagesError {
  if (response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")) {
    return new GitHubPagesError("rate_limited", parseRetryAfter(response.headers));
  }
  if (response.status === 404) {
    return new GitHubPagesError(notFound);
  }
  return new GitHubPagesError(response.status === 401 || response.status === 403 ? "access_denied" : "unavailable");
}

async function parseBody<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new GitHubPagesError("invalid_response");
  }
  return parsed.data;
}
