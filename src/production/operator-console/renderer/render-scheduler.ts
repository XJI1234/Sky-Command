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

export interface BackgroundRefresh {
  readonly request: () => Promise<void>;
  readonly dispose: () => void;
}

export interface BackgroundRefreshOptions {
  readonly deadlineMs: number;
  readonly intervalMs: number;
  readonly onFetched?: () => void | Promise<void>;
  readonly deadlines?: RenderDeadlineScheduler;
  readonly setInterval?: (callback: () => void, milliseconds: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
}

const browserIntervals = Object.freeze({
  setInterval: (callback: () => void, milliseconds: number): unknown => globalThis.setInterval(callback, milliseconds),
  clearInterval: (handle: unknown): void => globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>),
});

/** Fetches latest host state off the paint path; a slow UI write cannot delay the next fetch. */
export function createBackgroundRefresh(
  fetchOnce: (signal: AbortSignal) => Promise<void>,
  options: BackgroundRefreshOptions,
): BackgroundRefresh {
  if (!Number.isFinite(options.deadlineMs) || options.deadlineMs < 1) throw new Error("Fetch deadline must be positive");
  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 1) throw new Error("Fetch interval must be positive");
  const deadlines = options.deadlines ?? browserDeadlines;
  const setInterval = options.setInterval ?? browserIntervals.setInterval;
  const clearInterval = options.clearInterval ?? browserIntervals.clearInterval;
  let disposed = false;
  let pending = false;
  let active: Promise<void> | null = null;
  let currentController: AbortController | null = null;

  const runFetch = (): Promise<void> => {
    pending = false;
    const controller = new AbortController();
    currentController = controller;
    return new Promise<void>((resolve) => {
      let settled = false;
      let deadline: unknown;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        deadlines.clearTimeout(deadline);
        if (currentController === controller) currentController = null;
        if (!disposed && pending) {
          resolve(runFetch());
          return;
        }
        resolve();
      };
      deadline = deadlines.setTimeout(() => {
        controller.abort();
        finish();
      }, options.deadlineMs);
      const afterFetch = (): void => {
        if (disposed || controller.signal.aborted || options.onFetched === undefined) return;
        try {
          void options.onFetched();
        } catch {
          /* paint isolation */
        }
      };
      try {
        void fetchOnce(controller.signal).then(
          () => {
            afterFetch();
            finish();
          },
          () => finish(),
        );
      } catch {
        finish();
      }
    });
  };

  const request = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    pending = true;
    if (active === null) {
      active = runFetch().finally(() => { active = null; });
    }
    return active;
  };

  const intervalHandle = setInterval(() => { void request(); }, options.intervalMs);
  return Object.freeze({
    request,
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      clearInterval(intervalHandle);
      currentController?.abort();
    },
  });
}
