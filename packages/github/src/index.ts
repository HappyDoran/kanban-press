import type {
  GitHubInstallationId,
  UserId,
} from "@notion-kanban-blog/domain";

export interface GitHubRepository {
  defaultBranch: string;
  fullName: string;
  isPrivate: boolean;
  providerRepositoryId: string;
}

export interface GitHubRepositoryAdapter {
  listRepositories(): Promise<readonly GitHubRepository[]>;
}

export interface GitHubAdapterFactory {
  forInstallation(
    ownerUserId: UserId,
    installationId: GitHubInstallationId,
  ): Promise<GitHubRepositoryAdapter>;
}
