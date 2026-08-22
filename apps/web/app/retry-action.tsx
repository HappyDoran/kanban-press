"use client";

import { useEffect, useState } from "react";

export function retryAtFromResponse(
  response: Response,
  now = Date.now(),
): number | null {
  const seconds = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 3_600
    ? now + seconds * 1_000
    : null;
}

export function retrySecondsRemaining(retryAt: number | null, now: number): number {
  return retryAt === null ? 0 : Math.max(0, Math.ceil((retryAt - now) / 1_000));
}

export function RetryAction({
  label,
  onRetry,
  retryAt,
}: {
  label: string;
  onRetry: () => void;
  retryAt: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  const remaining = retrySecondsRemaining(retryAt, now);

  useEffect(() => {
    if (remaining === 0) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [remaining]);

  return (
    <button disabled={remaining > 0} onClick={onRetry} type="button">
      {remaining > 0 ? `${label} (${remaining}초 후)` : label}
    </button>
  );
}
