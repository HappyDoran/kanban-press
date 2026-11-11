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
