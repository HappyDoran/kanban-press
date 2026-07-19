"use client";

import { useEffect, useState } from "react";

interface RepositorySummary {
  defaultBranch: string;
  fullName: string;
}

type TargetState = "error" | "loading" | "missing" | "ready" | "scope";

export function GitHubPagesTarget({ githubLogin }: { githubLogin: string }) {
  const [state, setState] = useState<TargetState>("loading");
  const [repository, setRepository] = useState<RepositorySummary | null>(null);
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
          providerError(payload) === "oauth_scope_missing"
        ) {
          setState("scope");
          return;
        }
        if (!response.ok) {
          throw new Error(providerError(payload));
        }
        const parsed = parseRepository(payload);
        setRepository(parsed);
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
        {state === "loading" ? <span>Repository 확인 중…</span> : null}
        {state === "ready" && repository !== null ? (
          <>
            <strong>{repository.fullName}</strong>
            <span>기본 branch · {repository.defaultBranch}</span>
          </>
        ) : null}
        {state === "missing" ? (
          <>
            <span>공개 `{repositoryName}` repository가 필요합니다.</span>
            <a
              href={`https://github.com/new?name=${encodeURIComponent(repositoryName)}`}
              rel="noreferrer"
              target="_blank"
            >
              GitHub에서 만들기
            </a>
          </>
        ) : null}
        {state === "scope" ? (
          <>
            <span>
              Repository와 GitHub Actions workflow 쓰기 권한을 다시 승인해
              주세요.
            </span>
            <a href="/auth/github/start?returnTo=%2F">GitHub 권한 다시 승인</a>
          </>
        ) : null}
        {state === "error" ? (
          <>
            <span>Repository 상태를 확인하지 못했습니다.</span>
            <button
              onClick={() => {
                setState("loading");
                setReloadKey((value) => value + 1);
              }}
              type="button"
            >
              다시 확인
            </button>
          </>
        ) : null}
      </div>
    </section>
  );
}

function parseRepository(value: unknown): RepositorySummary {
  if (
    typeof value !== "object" ||
    value === null ||
    !("repository" in value) ||
    typeof value.repository !== "object" ||
    value.repository === null ||
    !("defaultBranch" in value.repository) ||
    typeof value.repository.defaultBranch !== "string" ||
    !("fullName" in value.repository) ||
    typeof value.repository.fullName !== "string"
  ) {
    throw new Error("invalid_github_pages_response");
  }
  return {
    defaultBranch: value.repository.defaultBranch,
    fullName: value.repository.fullName,
  };
}

function providerError(value: unknown): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
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
