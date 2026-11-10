"use client";

import { useEffect, useState } from "react";

import { retryAtFromResponse } from "../lib/client/api";

import { RetryAction } from "./retry-action";

export interface RepositorySummary {
  defaultBranch: string;
  fullName: string;
}

export interface RepositoryReadiness {
  conflictingPaths: readonly string[];
  managedPaths: readonly string[];
  pagesSettingsUrl: string;
  state: "pages_setup_required" | "ready" | "repository_not_managed";
}

export interface RepositoryTarget {
  readiness: RepositoryReadiness;
  repository: RepositorySummary;
}

type TargetState = "error" | "loading" | "missing" | "ready" | "scope";
const CONFLICT_PATH_LIMIT = 5;

export function GitHubPagesTarget({ githubLogin }: { githubLogin: string }) {
  const [state, setState] = useState<TargetState>("loading");
  const [target, setTarget] = useState<RepositoryTarget | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    void fetch("/api/github/pages-repository", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await safeJson(response);
        if (response.status === 404) {
          setState("missing");
          return;
        }
        if (
          response.status === 403 &&
          providerError(payload).replace(/^github_/, "") ===
            "oauth_scope_missing"
        ) {
          setState("scope");
          return;
        }
        if (!response.ok) {
          setRetryAt(retryAtFromResponse(response));
          throw new Error(providerError(payload));
        }
        setTarget(parseRepositoryTarget(payload));
        setState("ready");
      })
      .catch((error) => {
        if (!isAbortError(error)) {
          setState("error");
        }
      });

    return () => controller.abort();
  }, [reloadKey]);

  const repositoryName = `${githubLogin}.github.io`;
  const retry = () => {
    setTarget(null);
    setRetryAt(null);
    setState("loading");
    setReloadKey((value) => value + 1);
  };

  return (
    <section aria-labelledby="github-pages-title" className="pagesTarget">
      <div>
        <p className="eyebrow">Publish destination</p>
        <h2 id="github-pages-title">GitHub Pages</h2>
        <p className="sectionDescription">
          게시 대상은 현재 계정의 공개 `{repositoryName}` repository로
          고정됩니다.
        </p>
      </div>
      <div className="pagesTargetStatus">
        {state === "loading" ? <span role="status">Repository 확인 중…</span> : null}
        {state === "ready" && target !== null ? (
          <RepositoryReadinessStatus onRetry={retry} target={target} />
        ) : null}
        {state === "missing" ? (
          <div className="pagesRecovery" role="alert">
            <span>공개 `{repositoryName}` repository가 필요합니다.</span>
            <a
              href={`https://github.com/new?name=${encodeURIComponent(repositoryName)}`}
              rel="noreferrer"
              target="_blank"
            >
              GitHub에서 만들기
            </a>
          </div>
        ) : null}
        {state === "scope" ? (
          <div className="pagesRecovery" role="alert">
            <span>
              Repository와 GitHub Actions workflow 쓰기 권한을 다시 승인해
              주세요.
            </span>
            <a href="/auth/github/start?returnTo=%2F">GitHub 권한 다시 승인</a>
          </div>
        ) : null}
        {state === "error" ? (
          <div className="pagesRecovery" role="alert">
            <span>Repository 상태를 확인하지 못했습니다.</span>
            <RetryAction
              label="다시 확인"
              onRetry={retry}
              retryAt={retryAt}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function RepositoryReadinessStatus({
  onRetry,
  target,
}: {
  onRetry: () => void;
  target: RepositoryTarget;
}) {
  const { readiness, repository } = target;
  const visibleConflicts = readiness.conflictingPaths.slice(
    0,
    CONFLICT_PATH_LIMIT,
  );
  const hiddenConflictCount =
    readiness.conflictingPaths.length - visibleConflicts.length;

  if (readiness.state === "ready") {
    return (
      <div className="pagesReadiness ready">
        <strong>{repository.fullName}</strong>
        <span>기본 branch · {repository.defaultBranch}</span>
        <span className="readinessLabel">● 게시 준비 완료</span>
        <span>
          앱이 관리하는 경로 {readiness.managedPaths.length}개만 갱신합니다.
        </span>
      </div>
    );
  }

  if (readiness.state === "pages_setup_required") {
    return (
      <div className="pagesReadiness warning" role="alert">
        <strong>{repository.fullName}</strong>
        <span>기본 branch · {repository.defaultBranch}</span>
        <span>
          GitHub Pages의 배포 소스를 GitHub Actions로 설정해야 게시할 수
          있습니다.
        </span>
        <div className="pagesTargetActions">
          <a href={readiness.pagesSettingsUrl} rel="noreferrer" target="_blank">
            Pages 설정 열기
          </a>
          <button onClick={onRetry} type="button">
            다시 확인
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pagesReadiness danger" role="alert">
      <strong>{repository.fullName}</strong>
      <span>
        기존 파일을 보호하기 위해 이 저장소에는 게시하지 않습니다. 아래 충돌
        경로를 확인해 주세요.
      </span>
      {visibleConflicts.length > 0 ? (
        <ul className="conflictingPaths">
          {visibleConflicts.map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
      ) : null}
      {hiddenConflictCount > 0 ? (
        <span>그 외 충돌 경로 {hiddenConflictCount}개</span>
      ) : null}
      <div className="pagesTargetActions">
        <a href={readiness.pagesSettingsUrl} rel="noreferrer" target="_blank">
          GitHub에서 저장소 확인
        </a>
        <button onClick={onRetry} type="button">
          다시 확인
        </button>
      </div>
    </div>
  );
}

export function parseRepositoryTarget(value: unknown): RepositoryTarget {
  if (
    typeof value !== "object" ||
    value === null ||
    !("repository" in value) ||
    !isRecord(value.repository) ||
    !isNonEmptyString(value.repository.defaultBranch) ||
    !isNonEmptyString(value.repository.fullName) ||
    !("readiness" in value) ||
    !isRecord(value.readiness) ||
    ![
      "ready",
      "pages_setup_required",
      "repository_not_managed",
    ].includes(String(value.readiness.state)) ||
    !isGitHubPagesSettingsUrl(
      value.readiness.pagesSettingsUrl,
      value.repository.fullName,
    ) ||
    !isPathArray(value.readiness.managedPaths) ||
    !isPathArray(value.readiness.conflictingPaths)
  ) {
    throw new Error("invalid_github_pages_response");
  }
  return {
    readiness: {
      conflictingPaths: value.readiness.conflictingPaths,
      managedPaths: value.readiness.managedPaths,
      pagesSettingsUrl: value.readiness.pagesSettingsUrl,
      state: value.readiness.state as RepositoryReadiness["state"],
    },
    repository: {
      defaultBranch: value.repository.defaultBranch,
      fullName: value.repository.fullName,
    },
  };
}

function isGitHubPagesSettingsUrl(value: unknown, fullName: string): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      url.pathname.toLowerCase() === `/${fullName}/settings/pages`.toLowerCase()
    );
  } catch {
    return false;
  }
}

function isPathArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isManagedPath);
}

function isManagedPath(value: unknown): value is string {
  return (
    isNonEmptyString(value) &&
    value.length <= 500 &&
    !value.startsWith("/") &&
    !value.split("/").includes("..")
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function providerError(value: unknown): string {
  return isRecord(value) && typeof value.error === "string"
    ? value.error
    : "github_pages_unavailable";
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
