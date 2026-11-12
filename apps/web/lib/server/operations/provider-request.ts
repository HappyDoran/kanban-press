// Notion·GitHub로 나가는 모든 HTTP 요청의 공통 경계(제품 명세 §6.1).
// 10초 안에 끝나지 않으면 abort를 무시하는 fetch라도 timeout으로 끝내고, 실패는 allowlist 로그만 남긴다.
// 서버는 자동 재시도하지 않는다. 재시도는 사용자가 화면에서 한다.
import { writeProviderFailureLog, type LogSink } from "./structured-log";

export const PROVIDER_REQUEST_TIMEOUT_MS = 10_000;

export class ProviderTransportError extends Error {
  override readonly name = "ProviderTransportError";

  constructor(readonly code: "timeout" | "unavailable") {
    super(`Provider transport failed: ${code}`);
  }
}

export async function providerRequest({
  fetch: fetchImplementation,
  init,
  input,
  log,
  operation,
  provider,
  timeoutMs = PROVIDER_REQUEST_TIMEOUT_MS,
}: {
  fetch: typeof fetch;
  init?: RequestInit;
  input: RequestInfo | URL;
  log?: LogSink | undefined;
  operation: string;
  provider: "github" | "notion";
  timeoutMs?: number | undefined;
}): Promise<Response> {
  const startedAt = performance.now();
  const timeout = new AbortController();
  const callerSignal = init?.signal ?? null;
  const signal = callerSignal === null ? timeout.signal : AbortSignal.any([callerSignal, timeout.signal]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  // fetch가 abort를 무시해도 끝나도록 timeout을 따로 경쟁시킨다.
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timeout.abort();
      reject(new ProviderTransportError("timeout"));
    }, timeoutMs);
  });
  const logFailure = (code: "http_error" | "network_error" | "timeout", response?: Response) =>
    writeProviderFailureLog(
      {
        code,
        durationMs: performance.now() - startedAt,
        operation,
        provider,
        ...(response === undefined
          ? {}
          : { retryAfterSeconds: parseRetryAfter(response.headers), status: response.status }),
      },
      log,
    );

  try {
    const response = await Promise.race([fetchImplementation(input, { ...init, signal }), timedOut]);
    if (!response.ok) {
      logFailure("http_error", response);
    }
    return response;
  } catch (error) {
    const isTimeout = timeout.signal.aborted;
    if (callerSignal?.aborted === true && !isTimeout) {
      throw error; // 호출한 쪽이 취소했다. 장애가 아니므로 기록하지 않는다.
    }
    logFailure(isTimeout ? "timeout" : "network_error");
    throw new ProviderTransportError(isTimeout ? "timeout" : "unavailable");
  } finally {
    clearTimeout(timer);
  }
}

/** `Retry-After` 초. 0 이상 정수만 믿고 1시간으로 자른다. 없거나 잘못되면 null. */
export function parseRetryAfter(headers: Headers): number | null {
  const value = Number.parseInt(headers.get("retry-after") ?? "", 10);
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 3_600) : null;
}
