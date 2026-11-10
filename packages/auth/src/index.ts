import type { UserId } from "@kanban-press/domain";

/** Unix time in whole seconds. */
export type UnixTimestamp = number;

export interface GitHubSession {
  accessToken: string;
  expiresAt: UnixTimestamp;
  githubLogin: string;
  issuedAt: UnixTimestamp;
  userId: UserId;
}

export interface SessionCodec {
  open(cookieValue: string): Promise<GitHubSession | null>;
  seal(session: GitHubSession): Promise<string>;
}
