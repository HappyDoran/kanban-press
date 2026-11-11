type Provider = "github" | "notion";
type LogLevel = "error" | "warn";

export interface ProviderFailureLog {
  code: "http_error" | "network_error" | "timeout";
  durationMs: number;
  operation: string;
  provider: Provider;
  retryAfterSeconds?: number | null;
  status?: number | null;
}

export type LogSink = (line: string) => void;

const SAFE_OPERATION = /^[a-z][a-z0-9_.-]{0,63}$/;

export function writeProviderFailureLog(
  event: ProviderFailureLog,
  sink: LogSink = (line) => console.warn(line),
): void {
  const operation = SAFE_OPERATION.test(event.operation)
    ? event.operation
    : "invalid_operation";
  const payload = {
    code: event.code,
    durationMs: boundedInteger(event.durationMs, 0, 60_000),
    event: "provider_request_failed",
    level: logLevel(event.code),
    operation,
    provider: event.provider,
    retryAfterSeconds: boundedNullableInteger(
      event.retryAfterSeconds,
      0,
      3_600,
    ),
    status: boundedNullableInteger(event.status, 100, 599),
  } as const;
  sink(JSON.stringify(payload));
}

/** 게시 내용 거절(422). `detail`은 이미지 거절 이유나 예약 속성 이름 같은 고정 값만 받는다. */
export function writePublishRejectedLog(
  event: { code: string; detail: string },
  sink: LogSink = (line) => console.warn(line),
): void {
  const safe = (value: string) => (SAFE_DETAIL.test(value) ? value : "invalid_detail");
  sink(JSON.stringify({ code: safe(event.code), detail: safe(event.detail), event: "publish_content_rejected", level: "warn" }));
}

/**
 * 게시·프리뷰 중 분류하지 못한 예외. 오류 이름과, 검사 오류면 실패한 필드 경로(키·번호만)를 남긴다. 값과 message는 남기지 않는다.
 */
export function writeUnexpectedFailureLog(
  operation: string,
  error: unknown,
  sink: LogSink = (line) => console.error(line),
): void {
  const name = error instanceof Error ? error.name : typeof error;
  const issue = (error as { issues?: { code?: unknown; path?: unknown }[] } | null)?.issues?.[0];
  const path = Array.isArray(issue?.path) ? issue.path.filter((key) => typeof key === "string" || typeof key === "number").join(".") : "";
  const safe = (value: string) => (SAFE_DETAIL.test(value) ? value : "invalid_detail");
  sink(
    JSON.stringify({
      detail: safe(name),
      event: "unexpected_failure",
      issue: typeof issue?.code === "string" ? safe(issue.code) : null,
      level: "error",
      operation: SAFE_OPERATION.test(operation) ? operation : "invalid_operation",
      path: path === "" ? null : safe(path),
    }),
  );
}

const SAFE_DETAIL = /^[A-Za-z][A-Za-z0-9_ .-]{0,63}$/;

function logLevel(code: ProviderFailureLog["code"]): LogLevel {
  return code === "http_error" ? "warn" : "error";
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return maximum;
  }
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function boundedNullableInteger(
  value: number | null | undefined,
  minimum: number,
  maximum: number,
): number | null {
  return value === undefined || value === null || !Number.isSafeInteger(value)
    ? null
    : Math.min(maximum, Math.max(minimum, value));
}
