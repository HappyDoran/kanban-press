import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api";
import { publishAndWatch } from "./publish";

const COMMIT = "a".repeat(40);
const ACTIONS = "https://github.com/octocat/octocat.github.io/actions/runs/1";
const published = () =>
  Response.json({
    commitSha: COMMIT,
    contentHash: "b".repeat(64),
    pageUrl: "https://octocat.github.io/posts/hello/",
  });

afterEach(() => vi.unstubAllGlobals());

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function watch(overrides: Partial<Parameters<typeof publishAndWatch>[0]> = {}) {
  return publishAndWatch({
    connectionId: "connection",
    githubLogin: "octocat",
    isCancelled: () => false,
    onActionsUrl: () => undefined,
    providerPageId: "page",
    sleep: () => Promise.resolve(),
    ...overrides,
  });
}

describe("publishAndWatch", () => {
  it("polls until the deployment succeeds and reports the Actions link", async () => {
    const fetchMock = stubFetch(
      published(),
      Response.json({ actionsUrl: null, state: "queued" }),
      Response.json({ actionsUrl: ACTIONS, state: "succeeded" }),
    );
    const onActionsUrl = vi.fn();

    await expect(watch({ onActionsUrl })).resolves.toBe("https://octocat.github.io/posts/hello/");
    expect(onActionsUrl).toHaveBeenCalledWith(ACTIONS);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/publish", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, `/api/publish/status?commitSha=${COMMIT}`, expect.anything());
  });

  it("fails on a failed deployment", async () => {
    stubFetch(published(), Response.json({ actionsUrl: ACTIONS, state: "failed" }));

    await expect(watch()).rejects.toEqual(new ApiError("deployment_failed"));
  });

  it("passes the server error code and Retry-After through", async () => {
    stubFetch(Response.json({ error: "github_rate_limited" }, { headers: { "retry-after": "30" }, status: 429 }));

    const error = await watch().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "github_rate_limited" });
    expect((error as ApiError).retryAt).toBeGreaterThan(Date.now());
  });

  it("rejects a status link outside the user's Pages repository", async () => {
    stubFetch(
      published(),
      Response.json({ actionsUrl: "https://github.com/evil/evil.github.io/actions/runs/1", state: "succeeded" }),
    );

    await expect(watch()).rejects.toEqual(new ApiError("invalid_publish_status_response"));
  });

  it("stops quietly when the screen goes away", async () => {
    const fetchMock = stubFetch(published());

    await expect(watch({ isCancelled: () => true })).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after the polling limit", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(published());
    fetchMock.mockImplementation(async () => Response.json({ actionsUrl: null, state: "in_progress" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(watch()).rejects.toEqual(new ApiError("deployment_timeout"));
  });
});
