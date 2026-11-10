"use client";

// 다시 시도 버튼. 서버가 준 `Retry-After`가 지나기 전에는 남은 초를 보여주고 누를 수 없게 한다(제품 명세 §6.1).

import { useEffect, useState } from "react";

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
    <button className="buttonSecondary" disabled={remaining > 0} onClick={onRetry} type="button">
      {remaining > 0 ? `${label} (${remaining}초 후)` : label}
    </button>
  );
}
