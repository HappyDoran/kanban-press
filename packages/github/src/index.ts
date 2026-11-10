import type { UserId } from "@notion-kanban-blog/domain";

export interface GitHubRepository {
  defaultBranch: string;
  fullName: string;
  isPrivate: boolean;
  providerRepositoryId: string;
}

export interface GitHubArtifact {
  bytes: Uint8Array;
  path: string;
}

export interface GitHubCommitResult {
  commitSha: string;
  created: boolean;
}

export interface GitHubDeploymentStatus {
  actionsUrl: string | null;
  pageUrl: string;
  state: "failed" | "in_progress" | "queued" | "succeeded";
}

export interface GitHubPagesReadiness {
  conflictingPaths: readonly string[];
  /** 기본 branch에 있는 게시 글 관련 파일(`src/content/blog/`, `src/assets/blog/`, `public/posts/`). 빈 저장소면 []. */
  contentPaths: readonly string[];
  managedPaths: readonly string[];
  pagesSettingsUrl: string;
  state: "pages_setup_required" | "ready" | "repository_not_managed";
}

export interface GitHubRepositoryAdapter {
  getPagesRepository(
    ownerUserId: UserId,
    ownerLogin: string,
  ): Promise<GitHubRepository>;

  getRepositoryReadiness(
    repository: GitHubRepository,
    managedPaths: readonly string[],
  ): Promise<GitHubPagesReadiness>;

  /** artifact를 쓰고 `deletePaths`를 지우는 commit 하나를 만든다. */
  commitArtifacts(
    repository: GitHubRepository,
    artifacts: readonly GitHubArtifact[],
    message: string,
    deletePaths?: readonly string[],
  ): Promise<GitHubCommitResult>;

  getDeploymentStatus(
    repository: GitHubRepository,
    commitSha: string,
  ): Promise<GitHubDeploymentStatus>;
}
