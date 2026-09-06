export interface RenderScheduler {
  readonly request: () => Promise<void>;
}

export interface RenderDeadlineScheduler {
  readonly setTimeout: (callback: () => void, milliseconds: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

export interface RenderSchedulerOptions {
  readonly deadlineMs: number;
  readonly deadlines?: RenderDeadlineScheduler;
}

export class RenderDeadlineExceededError extends Error {
  constructor() {
    super("Render deadline exceeded");
    this.name = "RenderDeadlineExceededError";
  }
}

const browserDeadlines: RenderDeadlineScheduler = Object.freeze({
  setTimeout: (callback: () => void, milliseconds: number): unknown => globalThis.setTimeout(callback, milliseconds),
  clearTimeout: (handle: unknown): void => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
});

/** Coalesces redraws and abandons an unresponsive read so later state can still be rendered. */
export function createRenderScheduler(
  renderOnce: (signal: AbortSignal) => Promise<void>,
  options: RenderSchedulerOptions = { deadlineMs: 5_000 },
): RenderScheduler {
  if (!Number.isFinite(options.deadlineMs) || options.deadlineMs < 1) throw new Error("Render deadline must be positive");
  const deadlines = options.deadlines ?? browserDeadlines;
  let pending = false;
  let active: Promise<void> | null = null;

  const runNext = (): Promise<void> => {
    pending = false;
    const controller = new AbortController();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let deadline: unknown;
      const finish = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        deadlines.clearTimeout(deadline);
        if (error !== undefined) {
          reject(error);
          return;
        }
        if (pending) {
          resolve(runNext());
          return;
        }
        resolve();
      };
      deadline = deadlines.setTimeout(() => {
        controller.abort();
        finish(new RenderDeadlineExceededError());
      }, options.deadlineMs);
      try {
        void renderOnce(controller.signal).then(
          () => finish(),
          (error: unknown) => finish(error),
        );
      } catch (error) {
        finish(error);
      }
    });
  };

  const request = (): Promise<void> => {
    pending = true;
    if (active === null) {
      active = runNext().finally(() => { active = null; });
    }
    return active;
  };

  return Object.freeze({ request });
}
