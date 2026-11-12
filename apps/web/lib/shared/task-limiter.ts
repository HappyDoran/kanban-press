export class TaskLimiter {
  readonly #limit: number;
  readonly #pending: Array<() => void> = [];
  #active = 0;
  #resumeAt = 0;

  constructor(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError("Task limit must be a positive integer");
    }
    this.#limit = limit;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const execute = () => {
        this.#active += 1;
        void Promise.resolve()
          .then(() => this.#waitForResume())
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            this.#active -= 1;
            this.#pending.shift()?.();
          });
      };
      if (this.#active < this.#limit) {
        execute();
      } else {
        this.#pending.push(execute);
      }
    });
  }

  /** `timestamp`(ms epoch)까지 아직 시작하지 않은 작업을 멈춘다. 요청 한도 응답의 대기 시간을 지키는 데 쓴다. */
  pauseUntil(timestamp: number): void {
    this.#resumeAt = Math.max(this.#resumeAt, timestamp);
  }

  async #waitForResume(): Promise<void> {
    for (let delay = this.#resumeAt - Date.now(); delay > 0; delay = this.#resumeAt - Date.now()) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
