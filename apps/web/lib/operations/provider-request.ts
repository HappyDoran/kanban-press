import { writeProviderFailureLog, type LogSink } from "./structured-log";

export const PROVIDER_REQUEST_TIMEOUT_MS = 10_000;

export class ProviderTransportError extends Error {
  override readonly name = "ProviderTransportError";

  constructor(readonly code: "timeout" | "unavailable") {
    super(`Provider transport failed: ${code}`);
  }
}

interface ProviderRequestOptions {
  fetch: typeof fetch;
  init?: RequestInit;
  input: RequestInfo | URL;
  log?: LogSink | undefined;
  operation: string;
  provider: "github" | "notion";
  timeoutMs?: number | undefined;
}

export async function providerRequest({
  fetch: fetchImplementation,
  init,
  input,
  log,
  operation,
  provider,
  timeoutMs = PROVIDER_REQUEST_TIMEOUT_MS,
}: ProviderRequestOptions): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init?.signal;
  const startedAt = performance.now();
  let timedOut = false;
  let timeoutReject: ((reason: ProviderTransportError) => void) | null = null;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  if (callerSignal?.aborted === true) {
    abortFromCaller();
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
    timeoutReject?.(new ProviderTransportError("timeout"));
  }, timeoutMs);

  try {
    const request = fetchImplementation(input, {
      ...init,
      signal: controller.signal,
    });
    const response = await Promise.race([
      request,
      new Promise<never>((_resolve, reject) => {
        timeoutReject = reject;
      }),
    ]);
    if (!response.ok) {
      writeProviderFailureLog(
        {
          code: "http_error",
          durationMs: performance.now() - startedAt,
          operation,
          provider,
          retryAfterSeconds: parseRetryAfter(response.headers),
          status: response.status,
        },
        log,
      );
    }
    return response;
  } catch (error) {
    if (callerSignal?.aborted === true && !timedOut) {
      throw error;
    }
    const code = timedOut ? "timeout" : "unavailable";
    writeProviderFailureLog(
      {
        code: code === "timeout" ? "timeout" : "network_error",
        durationMs: performance.now() - startedAt,
        operation,
        provider,
      },
      log,
    );
    throw error instanceof ProviderTransportError
      ? error
      : new ProviderTransportError(code);
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export function parseRetryAfter(headers: Headers): number | null {
  const value = Number.parseInt(headers.get("retry-after") ?? "", 10);
  return Number.isSafeInteger(value) && value >= 0
    ? Math.min(value, 3_600)
    : null;
}
