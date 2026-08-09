const RELATIVE_UNITS = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
] as const;

const ABSOLUTE_THRESHOLD = 30 * 86_400_000;

export function formatEditedAt(value: string, now = Date.now()): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    return value;
  }
  const elapsed = now - time;
  if (elapsed >= ABSOLUTE_THRESHOLD || elapsed < 0) {
    return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(
      time,
    );
  }
  const formatter = new Intl.RelativeTimeFormat("ko", { numeric: "always" });
  for (const [unit, milliseconds] of RELATIVE_UNITS) {
    if (elapsed >= milliseconds) {
      return formatter.format(-Math.trunc(elapsed / milliseconds), unit);
    }
  }
  return "방금 전";
}
