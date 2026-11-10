import { describe, expect, it, vi } from "vitest";

import { TaskLimiter } from "./task-limiter";

describe("TaskLimiter", () => {
  it("never runs more than the configured number of tasks", async () => {
    const limiter = new TaskLimiter(2);
    let active = 0;
    let maximumActive = 0;

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        limiter.run(async () => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await Promise.resolve();
          active -= 1;
          return index;
        }),
      ),
    );

    expect(maximumActive).toBe(2);
  });

  it("holds tasks that have not started until the pause time, then runs them", async () => {
    vi.useFakeTimers({ now: 0 });
    try {
      const limiter = new TaskLimiter(3);
      const started: number[] = [];
      limiter.pauseUntil(20_000);
      limiter.pauseUntil(5_000); // 더 이른 시각으로 줄이지 않는다
      const done = Promise.all([1, 2].map((id) => limiter.run(async () => started.push(id))));

      await vi.advanceTimersByTimeAsync(19_999);
      expect(started).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      await done;
      expect(started).toEqual([1, 2]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects an invalid concurrency limit", () => {
    expect(() => new TaskLimiter(0)).toThrow(RangeError);
  });
});
