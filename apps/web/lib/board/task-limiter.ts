export class TaskLimiter {
  readonly #limit: number;
  readonly #pending: Array<() => void> = [];
  #active = 0;

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
}
