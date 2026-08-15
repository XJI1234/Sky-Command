import { describe, expect, it } from "vitest";
import { CommandTracker, type TimerScheduler } from "../src/modules/relay-link/command-tracker/index.js";

class Scheduler implements TimerScheduler {
  private next = 1;
  private timers = new Map<number, () => void>();
  setTimeout(callback: () => void, _milliseconds: number): number { const id = this.next++; this.timers.set(id, callback); return id; }
  clearTimeout(handle: number): void { this.timers.delete(handle); }
  fireAll(): void { for (const callback of [...this.timers.values()]) callback(); this.timers.clear(); }
  pending(): number { return this.timers.size; }
}

class RetainedScheduler implements TimerScheduler {
  readonly callbacks: Array<() => void> = [];
  setTimeout(callback: () => void, _milliseconds: number): number { this.callbacks.push(callback); return this.callbacks.length - 1; }
  clearTimeout(_handle: number): void {}
  fire(index: number): void { this.callbacks[index]?.(); }
}

const create = (scheduler = new Scheduler()) => ({ tracker: CommandTracker.create({ scheduler, timeoutMs: 10 }), scheduler });

describe("command-tracker contract", () => {
  it("tracks and resolves commands exactly once", () => {
    const { tracker, scheduler } = create();
    expect(tracker.snapshot()).toEqual([]);
    expect(tracker.begin({ connectionId: "connection-1", commandId: "command-1" })).toMatchObject({ ok: true, value: { commandId: "command-1" } });
    expect(tracker.resolve({ connectionId: "connection-1", commandId: "command-1", ok: true, detail: "accepted" })).toEqual({ ok: true, value: { connectionId: "connection-1", commandId: "command-1", status: "succeeded", detail: "accepted" } });
    expect(tracker.snapshot()).toEqual([]);
    expect(scheduler.pending()).toBe(0);
    expect(tracker.resolve({ connectionId: "connection-1", commandId: "command-1", ok: true, detail: "late" })).toMatchObject({ ok: false, error: { code: "COMMAND_NOT_FOUND" } });
  });

  it("透明传递并隔离匹配命令的结构化结果", () => {
    const { tracker } = create();
    const result = { kind: "object" as const, fields: { domain: { kind: "string" as const, value: "camera" } } };
    tracker.begin({ connectionId: "connection-1", commandId: "command-1" });
    const resolved = tracker.resolve({ connectionId: "connection-1", commandId: "command-1", ok: true, detail: "confirmed", result });
    expect(resolved).toMatchObject({ ok: true, value: { status: "succeeded", result } });
    if (!resolved.ok || resolved.value.result === undefined) throw new Error("expected structured result");
    expect(resolved.value.result).not.toBe(result);
    expect(Object.isFrozen(resolved.value.result)).toBe(true);
    expect(Object.isFrozen(resolved.value.result.fields)).toBe(true);
  });

  it("拒绝畸形结构化结果且不完成仍在等待的命令", () => {
    const { tracker } = create();
    tracker.begin({ connectionId: "connection-1", commandId: "command-1" });
    expect(tracker.resolve({ connectionId: "connection-1", commandId: "command-1", ok: true, detail: "bad", result: { kind: "string", value: "not object" } as never })).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
    expect(tracker.snapshot()).toMatchObject([{ commandId: "command-1" }]);
    const hostile = new Proxy({ connectionId: "connection-1", commandId: "command-1", ok: true, detail: "bad" }, { get() { throw new Error("secret"); } });
    expect(tracker.resolve(hostile as never)).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
  });

  it("rejects duplicate and stale command identities atomically", () => {
    const { tracker } = create();
    tracker.begin({ connectionId: "connection-1", commandId: "command-1" });
    const before = tracker.snapshot();
    expect(tracker.begin({ connectionId: "connection-1", commandId: "command-1" })).toMatchObject({ ok: false, error: { code: "DUPLICATE_COMMAND" } });
    expect(tracker.resolve({ connectionId: "connection-2", commandId: "command-1", ok: false, detail: "wrong phone" })).toMatchObject({ ok: false, error: { code: "STALE_CONNECTION" } });
    expect(tracker.snapshot()).toBe(before);
  });

  it("times out pending commands and cancels every command on disconnect", () => {
    const { tracker, scheduler } = create();
    const outcomes: string[] = [];
    tracker.subscribe((outcome) => outcomes.push(`${outcome.commandId}:${outcome.status}`));
    tracker.begin({ connectionId: "connection-1", commandId: "command-1" });
    scheduler.fireAll();
    expect(outcomes).toEqual(["command-1:timed-out"]);
    tracker.begin({ connectionId: "connection-1", commandId: "command-2" });
    tracker.begin({ connectionId: "connection-1", commandId: "command-3" });
    tracker.begin({ connectionId: "connection-2", commandId: "command-4" });
    tracker.cancelConnection("connection-1", "phone disconnected");
    tracker.cancelConnection("connection-1", "again");
    expect(outcomes).toEqual(["command-1:timed-out", "command-2:disconnected", "command-3:disconnected"]);
    expect(tracker.snapshot()).toMatchObject([{ connectionId: "connection-2", commandId: "command-4" }]);
  });

  it("contains listener failures and supports reentrant begins", () => {
    const { tracker } = create();
    let nested = false;
    const calls: string[] = [];
    tracker.subscribe(() => { throw new Error("listener failure"); });
    tracker.subscribe((outcome) => { calls.push(outcome.commandId); if (!nested) { nested = true; tracker.begin({ connectionId: "connection-2", commandId: "nested" }); } });
    tracker.begin({ connectionId: "connection-1", commandId: "command-1" });
    tracker.resolve({ connectionId: "connection-1", commandId: "command-1", ok: false, detail: "rejected" });
    expect(calls).toEqual(["command-1"]);
    expect(tracker.snapshot()).toMatchObject([{ commandId: "nested" }]);
  });

  it("returns frozen snapshots and stable errors for invalid input", () => {
    const { tracker } = create();
    expect(tracker.begin(null as never)).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
    expect(tracker.begin({ connectionId: " ", commandId: "x" })).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
    expect(tracker.resolve({ connectionId: "x", commandId: "y", ok: "yes", detail: "" } as never)).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
    const hostile = new Proxy({ connectionId: "x", commandId: "y" }, { get() { throw new Error("sensitive"); } });
    expect(tracker.begin(hostile as never)).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
    tracker.begin({ connectionId: "x", commandId: "y" });
    tracker.cancelConnection(" ", "bad");
    tracker.cancelConnection("x", "");
    const snapshot = tracker.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(() => (snapshot as unknown as Array<unknown>).pop()).toThrow();
  });

  it("preserves every documented command-tracker detail and distinguishes stale from missing identities", () => {
    const { tracker } = create();
    expect(tracker.begin(null as never)).toEqual({ ok: false, error: { code: "INVALID_COMMAND", message: "Command identity is invalid" } });
    expect(tracker.begin({ connectionId: "connection-1", commandId: "command-1" })).toMatchObject({ ok: true });
    expect(tracker.begin({ connectionId: "connection-1", commandId: "command-1" })).toEqual({ ok: false, error: { code: "DUPLICATE_COMMAND", message: "Command is already pending" } });
    expect(tracker.resolve({ connectionId: "connection-2", commandId: "command-1", ok: false, detail: "wrong" })).toEqual({ ok: false, error: { code: "STALE_CONNECTION", message: "Command belongs to another connection" } });
    expect(tracker.resolve({ connectionId: "connection-2", commandId: "command-2", ok: false, detail: "missing" })).toEqual({ ok: false, error: { code: "COMMAND_NOT_FOUND", message: "Command is not pending" } });
    expect(tracker.resolve({ connectionId: "connection-1", commandId: "command-1", ok: "yes", detail: "invalid" } as never)).toEqual({ ok: false, error: { code: "INVALID_COMMAND", message: "Command result is invalid" } });
  });

  it("does not let a cleared timer finish a replacement command with the same identity", () => {
    const scheduler = new RetainedScheduler();
    const tracker = CommandTracker.create({ scheduler, timeoutMs: 10 });
    const outcomes: unknown[] = [];
    tracker.subscribe((outcome) => outcomes.push(outcome));
    tracker.begin({ connectionId: "connection-1", commandId: "command-1" });
    expect(tracker.resolve({ connectionId: "connection-1", commandId: "command-1", ok: true, detail: "accepted" })).toEqual({ ok: true, value: { connectionId: "connection-1", commandId: "command-1", status: "succeeded", detail: "accepted" } });
    tracker.begin({ connectionId: "connection-1", commandId: "command-1" });
    scheduler.fire(0);
    expect(tracker.snapshot()).toEqual([{ connectionId: "connection-1", commandId: "command-1" }]);
    scheduler.fire(1);
    expect(outcomes).toEqual([
      { connectionId: "connection-1", commandId: "command-1", status: "succeeded", detail: "accepted" },
      { connectionId: "connection-1", commandId: "command-1", status: "timed-out", detail: "Command timed out" },
    ]);
  });

  it("ignores a retained timer after its command has already completed", () => {
    const scheduler = new RetainedScheduler();
    const tracker = CommandTracker.create({ scheduler, timeoutMs: 10 });
    tracker.begin({ connectionId: "connection-1", commandId: "command-1" });
    tracker.resolve({ connectionId: "connection-1", commandId: "command-1", ok: true, detail: "accepted" });
    expect(() => scheduler.fire(0)).not.toThrow();
    expect(tracker.snapshot()).toEqual([]);
  });

  it("rejects a result whose payload access fails after identity validation", () => {
    const { tracker } = create();
    tracker.begin({ connectionId: "connection-1", commandId: "command-1" });
    const hostile = new Proxy({ connectionId: "connection-1", commandId: "command-1", ok: true, detail: "accepted" }, {
      get(target, key) {
        if (key === "ok") throw new Error("payload access failed");
        return Reflect.get(target, key);
      },
    });
    expect(tracker.resolve(hostile as never)).toEqual({ ok: false, error: { code: "INVALID_COMMAND", message: "Command result is invalid" } });
    expect(tracker.snapshot()).toEqual([{ connectionId: "connection-1", commandId: "command-1" }]);
  });

  it("uses the supplied disconnect reason only when it is a nonempty valid detail and unsubscribes once", () => {
    const { tracker } = create();
    const delivered: unknown[] = [];
    tracker.subscribe((outcome) => delivered.push(outcome));
    tracker.begin({ connectionId: "connection-1", commandId: "command-1" });
    tracker.cancelConnection("connection-1", "phone disconnected");
    tracker.begin({ connectionId: "connection-2", commandId: "command-2" });
    tracker.cancelConnection("connection-2", "");
    expect(delivered).toEqual([
      { connectionId: "connection-1", commandId: "command-1", status: "disconnected", detail: "phone disconnected" },
      { connectionId: "connection-2", commandId: "command-2", status: "disconnected", detail: "Connection disconnected" },
    ]);
    expect(tracker.snapshot()).toEqual([]);
  });

  it("accepts only bounded printable command identities and result details", () => {
    const { tracker } = create();
    const identity = "i".repeat(128);
    const detail = "d".repeat(1024);
    expect(tracker.begin({ connectionId: identity, commandId: identity })).toMatchObject({ ok: true });
    expect(tracker.resolve({ connectionId: identity, commandId: identity, ok: false, detail })).toMatchObject({ ok: true, value: { status: "rejected", detail } });
    expect(tracker.begin({ connectionId: "i".repeat(129), commandId: "command" })).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
    expect(tracker.begin({ connectionId: "connection", commandId: "bad\u0000id" })).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
    tracker.begin({ connectionId: "connection", commandId: "command" });
    expect(tracker.resolve({ connectionId: "connection", commandId: "command", ok: true, detail: "d".repeat(1025) })).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
    expect(tracker.resolve({ connectionId: "connection", commandId: "command", ok: true, detail: "bad\u0000detail" })).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
  });

  it("rejects each non-string command identity without changing pending commands", () => {
    const invalidInputs = [
      { connectionId: 1, commandId: "command" },
      { connectionId: "connection", commandId: 1 },
    ];
    for (const input of invalidInputs) {
      const { tracker } = create();
      expect(tracker.begin(input as never)).toEqual({ ok: false, error: { code: "INVALID_COMMAND", message: "Command identity is invalid" } });
      expect(tracker.snapshot()).toEqual([]);
    }
  });

  it("rejects a non-string result detail without completing its pending command", () => {
    const { tracker } = create();
    tracker.begin({ connectionId: "connection", commandId: "command" });
    expect(tracker.resolve({ connectionId: "connection", commandId: "command", ok: true, detail: 1 } as never)).toEqual({ ok: false, error: { code: "INVALID_COMMAND", message: "Command result is invalid" } });
    expect(tracker.snapshot()).toEqual([{ connectionId: "connection", commandId: "command" }]);
  });

  it("omits result when the relay did not provide a structured result", () => {
    const { tracker } = create();
    tracker.begin({ connectionId: "connection", commandId: "command" });
    const resolved = tracker.resolve({ connectionId: "connection", commandId: "command", ok: true, detail: "accepted" });
    expect(resolved).toEqual({ ok: true, value: { connectionId: "connection", commandId: "command", status: "succeeded", detail: "accepted" } });
    if (!resolved.ok) throw new Error("expected a completed command");
    expect(Object.hasOwn(resolved.value, "result")).toBe(false);
  });

  it("does not deliver outcomes after its subscription is cancelled", () => {
    const { tracker } = create();
    const outcomes: unknown[] = [];
    const unsubscribe = tracker.subscribe((outcome) => outcomes.push(outcome));
    unsubscribe();
    tracker.begin({ connectionId: "connection", commandId: "command" });
    tracker.resolve({ connectionId: "connection", commandId: "command", ok: true, detail: "accepted" });
    expect(outcomes).toEqual([]);
  });

  it("preserves documented messages when otherwise-string command fields violate their bounds", () => {
    const { tracker } = create();
    expect(tracker.begin({ connectionId: " ", commandId: "command" })).toEqual({ ok: false, error: { code: "INVALID_COMMAND", message: "Command identity is invalid" } });
    tracker.begin({ connectionId: "connection", commandId: "command" });
    expect(tracker.resolve({ connectionId: "connection", commandId: "command", ok: true, detail: "bad\u0000detail" })).toEqual({ ok: false, error: { code: "INVALID_COMMAND", message: "Command result is invalid" } });
    expect(tracker.snapshot()).toEqual([{ connectionId: "connection", commandId: "command" }]);
  });
});
