import { describe, expect, it, vi } from "vitest";

import {
  parseRetryAfter,
  providerRequest,
  ProviderTransportError,
} from "./provider-request";
import { writeProviderFailureLog } from "./structured-log";

describe("providerRequest", () => {
  it("bounds Retry-After and emits only allowlisted structured fields", async () => {
    const lines: string[] = [];
    const response = await providerRequest({
      fetch: vi.fn().mockResolvedValue(
        new Response("credential=never-log", {
          headers: { "retry-after": "7200" },
          status: 429,
        }),
      ),
      input: "https://provider.example/private?token=never-log",
      log: (line) => lines.push(line),
      operation: "content.list",
      provider: "notion",
    });

    expect(parseRetryAfter(response.headers)).toBe(3_600);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      code: "http_error",
      event: "provider_request_failed",
      operation: "content.list",
      provider: "notion",
      retryAfterSeconds: 3_600,
      status: 429,
    });
    expect(lines[0]).not.toContain("never-log");
    expect(lines[0]).not.toContain("provider.example");
  });

  it("terminates a fetch implementation that ignores abort", async () => {
    const lines: string[] = [];
    const pending = new Promise<Response>(() => undefined);
    await expect(
      providerRequest({
        fetch: vi.fn(() => pending),
        input: "https://api.github.com/user",
        log: (line) => lines.push(line),
        operation: "identity.get",
        provider: "github",
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ code: "timeout" } satisfies Partial<ProviderTransportError>);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      code: "timeout",
      provider: "github",
    });
  });

  it("preserves caller cancellation without misreporting a timeout", async () => {
    const controller = new AbortController();
    const lines: string[] = [];
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
    );
    const request = providerRequest({
      fetch: fetchMock as typeof fetch,
      init: { signal: controller.signal },
      input: "https://api.notion.com/v1/search",
      log: (line) => lines.push(line),
      operation: "content.search",
      provider: "notion",
      timeoutMs: 1_000,
    });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(lines).toEqual([]);
  });
});

describe("writeProviderFailureLog", () => {
  it("rejects arbitrary operation text and never serializes extra input", () => {
    const lines: string[] = [];
    writeProviderFailureLog(
      {
        code: "network_error",
        durationMs: Number.POSITIVE_INFINITY,
        operation: "token=secret value",
        provider: "github",
      },
      (line) => lines.push(line),
    );
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      durationMs: 60_000,
      operation: "invalid_operation",
    });
    expect(lines[0]).not.toContain("secret");
  });
});
