import { describe, expect, it } from "vitest";

import {
  parseActionsUrl,
  parsePublishStatus,
  publishErrorMessage,
} from "./api";

const actionsUrl =
  "https://github.com/octocat/octocat.github.io/actions/runs/123456789";

describe("parseActionsUrl", () => {
  it("accepts only a descendant of the signed-in user's fixed Actions path", () => {
    expect(parseActionsUrl(actionsUrl, "octocat")).toBe(actionsUrl);
    expect(
      parseActionsUrl(
        "https://github.com/other/other.github.io/actions/runs/123",
        "octocat",
      ),
    ).toBeNull();
    expect(
      parseActionsUrl(
        "https://github.com/octocat/octocat.github.io/actions-evil/runs/123",
        "octocat",
      ),
    ).toBeNull();
  });

  it("rejects insecure, credentialed, root, and decorated URLs", () => {
    expect(parseActionsUrl(actionsUrl.replace("https:", "http:"), "octocat")).toBeNull();
    expect(
      parseActionsUrl(
        "https://user@github.com/octocat/octocat.github.io/actions/runs/123",
        "octocat",
      ),
    ).toBeNull();
    expect(
      parseActionsUrl(
        "https://github.com/octocat/octocat.github.io/actions/",
        "octocat",
      ),
    ).toBeNull();
    expect(parseActionsUrl(`${actionsUrl}?token=secret`, "octocat")).toBeNull();
  });
});

describe("parsePublishStatus", () => {
  it("parses a valid status and its strict Actions URL", () => {
    expect(
      parsePublishStatus(
        { actionsUrl, state: "in_progress" },
        "octocat",
      ),
    ).toEqual({ actionsUrl, state: "in_progress" });
    expect(
      parsePublishStatus({ actionsUrl: null, state: "queued" }, "octocat"),
    ).toEqual({ actionsUrl: null, state: "queued" });
  });

  it("rejects missing or untrusted Actions URLs", () => {
    expect(parsePublishStatus({ state: "failed" }, "octocat")).toBeNull();
    expect(
      parsePublishStatus(
        { actionsUrl: "https://example.com/actions/runs/1", state: "failed" },
        "octocat",
      ),
    ).toBeNull();
  });
});

describe("publishErrorMessage", () => {
  it("maps stable provider errors to actionable Korean recovery guidance", () => {
    expect(publishErrorMessage("github_repository_not_managed")).toContain(
      "충돌 경로",
    );
    expect(publishErrorMessage("pages_setup_required")).toContain(
      "Actions로 설정",
    );
    expect(publishErrorMessage("github_oauth_scope_missing")).toContain(
      "다시 승인",
    );
    expect(publishErrorMessage("github_conflict")).toContain("다시 시도");
    expect(publishErrorMessage("notion_rate_limited")).toContain("잠시");
    expect(publishErrorMessage("github_timeout")).toContain("시간이 초과");
    expect(publishErrorMessage("invalid_publish_image")).toContain("이미지");
  });
});
