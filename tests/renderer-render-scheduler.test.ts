import { describe, expect, it } from "vitest";
import { createRenderScheduler } from "../src/production/operator-console/renderer/render-scheduler.js";

class ManualDeadlineScheduler {
  readonly callbacks: Array<() => void> = [];

  setTimeout(callback: () => void): number {
    this.callbacks.push(callback);
    return this.callbacks.length - 1;
  }

  clearTimeout(handle: number): void {
    this.callbacks[handle] = () => undefined;
  }

  fireNext(): void {
    const callback = this.callbacks.shift();
    if (callback === undefined) throw new Error("No deadline was scheduled");
    callback();
  }
}

describe("renderer render scheduler", () => {
  it("coalesces requests received during one pending redraw into exactly one latest redraw", async () => {
    const completed: Array<() => void> = [];
    let renders = 0;
    const scheduler = createRenderScheduler(async () => {
      renders += 1;
      await new Promise<void>((resolve) => { completed.push(resolve); });
    });

    const first = scheduler.request();
    const second = scheduler.request();
    const third = scheduler.request();
    expect(renders).toBe(1);

    completed.shift()!();
    await Promise.resolve();
    await Promise.resolve();
    expect(renders).toBe(2);

    completed.shift()!();
    await Promise.all([first, second, third]);
    expect(renders).toBe(2);
  });

  it("releases a failed render so a later refresh can run", async () => {
    let attempts = 0;
    const scheduler = createRenderScheduler(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("first render failed");
    });

    await expect(scheduler.request()).rejects.toThrow("first render failed");
    await expect(scheduler.request()).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });

  it("abandons an overdue redraw so the next request can render the latest state", async () => {
    const deadlines = new ManualDeadlineScheduler();
    const releases: Array<() => void> = [];
    const signals: AbortSignal[] = [];
    const scheduler = createRenderScheduler(async (signal) => {
      signals.push(signal);
      await new Promise<void>((resolve) => { releases.push(resolve); });
    }, { deadlineMs: 5_000, deadlines });

    const overdue = scheduler.request();
    expect(deadlines.callbacks).toHaveLength(1);

    deadlines.fireNext();
    await expect(overdue).rejects.toThrow("Render deadline exceeded");
    expect(signals[0]?.aborted).toBe(true);

    const retry = scheduler.request();
    expect(signals).toHaveLength(2);
    releases[0]!();
    releases[1]!();
    await expect(retry).resolves.toBeUndefined();
  });
});
