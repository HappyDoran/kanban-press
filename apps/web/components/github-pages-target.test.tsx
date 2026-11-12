import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  PagesSummary,
  parseRepositoryTarget,
  RepositoryReadinessStatus,
  type RepositoryTarget,
} from "./github-pages-target";

const readyTarget: RepositoryTarget = {
  readiness: {
    conflictingPaths: [],
    managedPaths: [".github/workflows/deploy.yml", "src/content/blog/post.md"],
    pagesSettingsUrl:
      "https://github.com/octocat/octocat.github.io/settings/pages",
    state: "ready",
  },
  repository: {
    defaultBranch: "main",
    fullName: "octocat/octocat.github.io",
  },
};

describe("parseRepositoryTarget", () => {
  it("strictly parses the readiness contract", () => {
    expect(parseRepositoryTarget(readyTarget)).toEqual(readyTarget);
  });

  it("rejects mismatched settings URLs and unsafe managed paths", () => {
    expect(() =>
      parseRepositoryTarget({
        ...readyTarget,
        readiness: {
          ...readyTarget.readiness,
          pagesSettingsUrl: "https://example.com/settings/pages",
        },
      }),
    ).toThrow("invalid_github_pages_response");
    expect(() =>
      parseRepositoryTarget({
        ...readyTarget,
        readiness: {
          ...readyTarget.readiness,
          managedPaths: ["../outside.md"],
        },
      }),
    ).toThrow("invalid_github_pages_response");
  });
});

describe("RepositoryReadinessStatus", () => {
  it("renders the default branch and ready state", () => {
    const html = renderToStaticMarkup(
      <RepositoryReadinessStatus onRetry={() => undefined} target={readyTarget} />,
    );

    expect(html).toContain("기본 branch · main");
    expect(html).toContain("관리하는 경로 2개");
  });

  it("summarizes readiness in one line with text, not color alone", () => {
    const summary = (state: Parameters<typeof PagesSummary>[0]["state"], target: RepositoryTarget | null) =>
      renderToStaticMarkup(
        <PagesSummary repositoryName="octocat.github.io" state={state} target={target} />,
      );

    expect(summary("ready", readyTarget)).toContain("게시 준비 완료");
    expect(summary("ready", readyTarget)).toContain("statusDot ok");
    expect(
      summary("ready", { ...readyTarget, readiness: { ...readyTarget.readiness, state: "pages_setup_required" } }),
    ).toContain("Pages 설정 필요");
    expect(summary("missing", null)).toContain("저장소 없음");
    expect(summary("scope", null)).toContain("권한 필요");
  });

  it("offers an accessible Pages settings link and retry action", () => {
    const html = renderToStaticMarkup(
      <RepositoryReadinessStatus
        onRetry={() => undefined}
        target={{
          ...readyTarget,
          readiness: {
            ...readyTarget.readiness,
            state: "pages_setup_required",
          },
        }}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('href="https://github.com/octocat/octocat.github.io/settings/pages"');
    expect(html).toContain("Pages 설정 열기");
    expect(html).toContain("다시 확인");
  });

  it("summarizes excessive conflicting paths while protecting the repository", () => {
    const html = renderToStaticMarkup(
      <RepositoryReadinessStatus
        onRetry={() => undefined}
        target={{
          ...readyTarget,
          readiness: {
            ...readyTarget.readiness,
            conflictingPaths: Array.from(
              { length: 8 },
              (_, index) => `existing/file-${index + 1}.md`,
            ),
            state: "repository_not_managed",
          },
        }}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("기존 파일을 보호");
    expect(html).toContain("existing/file-5.md");
    expect(html).not.toContain("existing/file-6.md");
    expect(html).toContain("그 외 충돌 경로 3개");
  });
});
