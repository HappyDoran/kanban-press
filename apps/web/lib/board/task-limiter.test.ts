import { describe, expect, it } from "vitest";

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

  it("rejects an invalid concurrency limit", () => {
    expect(() => new TaskLimiter(0)).toThrow(RangeError);
  });
});
