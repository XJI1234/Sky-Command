import { describe, expect, it } from "vitest";
import { DesktopRuntime } from "../src/production/desktop-runtime/index.js";

describe("DesktopRuntime", () => {
  it("starts the relay before the media pipeline", async () => {
    const calls: string[] = [];
    const runtime = DesktopRuntime.create({
      relay: { start: async () => { calls.push("relay.start"); return { ok: true, value: { state: "listening", endpoint: { host: "127.0.0.1", port: 9160 } } }; }, stop: async () => { calls.push("relay.stop"); }, snapshot: () => ({ state: "stopped" }), devices: () => [], latestTelemetry: () => null, sendCommand: async () => ({ status: "rejected" }), sendMission: async () => ({ status: "rejected" }), subscribe: () => () => undefined },
      media: { start: () => { calls.push("media.start"); return { ok: true, value: { phase: "running" } }; }, stop: () => { calls.push("media.stop"); return { ok: true, value: { phase: "idle" } }; }, snapshot: () => ({ phase: "idle" }), dispose: () => undefined },
      live: { list: () => [], stop: async () => ({ ok: true }) }
    }, { mediaStartInput: {} });

    await expect(runtime.start()).resolves.toMatchObject({ ok: true });
    expect(calls).toEqual(["relay.start", "media.start"]);
    expect(runtime.snapshot()).toEqual({ phase: "running", revision: 2, relay: { state: "stopped" }, media: { phase: "idle" } });
  });

  it("rolls the relay back when media startup fails", async () => {
    const calls: string[] = [];
    const runtime = DesktopRuntime.create({
      relay: { start: async () => { calls.push("relay.start"); return { ok: true }; }, stop: async () => { calls.push("relay.stop"); }, snapshot: () => ({}), subscribe: () => () => undefined },
      media: { start: () => { calls.push("media.start"); return { ok: false }; }, stop: () => { calls.push("media.stop"); return { ok: true }; }, snapshot: () => ({}), dispose: () => undefined },
      live: { list: () => [], stop: async () => ({ ok: true }) }
    }, { mediaStartInput: {} });

    await expect(runtime.start()).resolves.toMatchObject({ ok: false, code: "MEDIA_START_FAILED", value: { phase: "idle" } });
    expect(calls).toEqual(["relay.start", "media.start", "relay.stop"]);
  });

  it("stops active live devices before media and relay services", async () => {
    const calls: string[] = [];
    const runtime = DesktopRuntime.create({
      relay: { start: async () => ({ ok: true }), stop: async () => { calls.push("relay.stop"); }, snapshot: () => ({}), subscribe: () => () => undefined },
      media: { start: () => ({ ok: true }), stop: () => { calls.push("media.stop"); return { ok: true }; }, snapshot: () => ({}), dispose: () => undefined },
      live: { list: () => [{ deviceId: "phone-1", phase: "streaming" }, { deviceId: "phone-2", phase: "idle" }], stop: async (deviceId) => { calls.push(`live.stop:${deviceId}`); return { ok: true }; } }
    }, { mediaStartInput: {} });

    await runtime.start();
    await expect(runtime.stop()).resolves.toMatchObject({ ok: true, value: { phase: "idle" } });
    expect(calls).toEqual(["live.stop:phone-1", "media.stop", "relay.stop"]);
  });

  it("dispose closes a running runtime and then detaches its resources", async () => {
    const calls: string[] = [];
    const runtime = DesktopRuntime.create({
      relay: { start: async () => ({ ok: true }), stop: async () => { calls.push("relay.stop"); }, snapshot: () => ({}), subscribe: () => () => { calls.push("relay.unsubscribe"); } },
      media: { start: () => ({ ok: true }), stop: () => { calls.push("media.stop"); return { ok: true }; }, snapshot: () => ({}), dispose: () => { calls.push("media.dispose"); } },
      live: { list: () => [], stop: async () => ({ ok: true }) }
    }, { mediaStartInput: {} });

    await runtime.start();
    await runtime.dispose();
    expect(calls).toEqual(["media.stop", "relay.stop", "relay.unsubscribe", "media.dispose"]);
    expect(runtime.snapshot()).toMatchObject({ phase: "disposed" });
  });

  it("rejects a second operation while the first startup is still pending", async () => {
    let resolveRelay: ((value: unknown) => void) | undefined;
    const runtime = DesktopRuntime.create({
      relay: { start: () => new Promise((resolve) => { resolveRelay = resolve; }), stop: async () => undefined, snapshot: () => ({}), subscribe: () => () => undefined },
      media: { start: () => ({ ok: true }), stop: () => ({ ok: true }), snapshot: () => ({}), dispose: () => undefined },
      live: { list: () => [], stop: async () => ({ ok: true }) }
    }, { mediaStartInput: {} });

    const pending = runtime.start();
    await expect(runtime.start()).resolves.toMatchObject({ ok: false, code: "OPERATION_IN_PROGRESS" });
    await expect(runtime.stop()).resolves.toMatchObject({ ok: false, code: "OPERATION_IN_PROGRESS" });
    resolveRelay!({ ok: true });
    await expect(pending).resolves.toMatchObject({ ok: true, value: { phase: "running" } });
  });

  it("publishes frozen snapshots while isolating failing listeners", async () => {
    const snapshots: unknown[] = [];
    const runtime = DesktopRuntime.create({
      relay: { start: async () => ({ ok: true }), stop: async () => undefined, snapshot: () => ({ state: "stopped" }), subscribe: () => () => undefined },
      media: { start: () => ({ ok: true }), stop: () => ({ ok: true }), snapshot: () => ({ phase: "idle" }), dispose: () => undefined },
      live: { list: () => [], stop: async () => ({ ok: true }) }
    }, { mediaStartInput: {} });
    runtime.subscribe(() => { throw new Error("observer"); });
    const unsubscribe = runtime.subscribe((snapshot) => snapshots.push(snapshot));

    await runtime.start();
    expect(snapshots).not.toEqual([]);
    const snapshot = runtime.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.relay as object)).toBe(true);
    unsubscribe();
    const count = snapshots.length;
    await runtime.stop();
    expect(snapshots).toHaveLength(count);
  });

  it("normalizes dependency faults and exposes stable lifecycle rejection codes", async () => {
    const relayFailure = DesktopRuntime.create({
      relay: { start: async () => { throw new Error("relay"); }, stop: async () => undefined, snapshot: () => null, subscribe: () => () => undefined },
      media: { start: () => ({ ok: true }), stop: () => ({ ok: true }), snapshot: () => 1, dispose: () => undefined },
      live: { list: () => [], stop: async () => ({ ok: true }) }
    }, { mediaStartInput: {} });
    await expect(relayFailure.start()).resolves.toEqual({ ok: false, code: "RELAY_START_FAILED", value: { phase: "idle", revision: 2, relay: null, media: null } });
    await expect(relayFailure.stop()).resolves.toMatchObject({ ok: false, code: "NOT_RUNNING" });

    const mediaFailure = DesktopRuntime.create({
      relay: { start: async () => ({ ok: true }), stop: async () => undefined, snapshot: () => ({}), subscribe: () => () => undefined },
      media: { start: () => { throw new Error("media"); }, stop: () => ({ ok: true }), snapshot: () => ({}), dispose: () => undefined },
      live: { list: () => [], stop: async () => ({ ok: true }) }
    }, { mediaStartInput: {} });
    await expect(mediaFailure.start()).resolves.toMatchObject({ ok: false, code: "MEDIA_START_FAILED" });
  });

  it("reports duplicate, disposed, and stop-cleanup outcomes without skipping later cleanup", async () => {
    const calls: string[] = [];
    const runtime = DesktopRuntime.create({
      relay: { start: async () => ({ ok: true }), stop: async () => { calls.push("relay.stop"); throw new Error("relay"); }, snapshot: () => ({}), subscribe: () => () => undefined },
      media: { start: () => ({ ok: true }), stop: () => { calls.push("media.stop"); return { ok: false }; }, snapshot: () => ({}), dispose: () => undefined },
      live: { list: () => [null, { deviceId: 1, phase: "streaming" }, { deviceId: "phone-1", phase: "starting" }, { deviceId: "phone-2", phase: "stopping" }], stop: async (deviceId) => { calls.push(`live.stop:${deviceId}`); return { ok: true }; } }
    }, { mediaStartInput: {} });
    expect(runtime.services().relay).toBeDefined();
    await runtime.start();
    await expect(runtime.start()).resolves.toMatchObject({ ok: false, code: "ALREADY_RUNNING" });
    await expect(runtime.stop()).resolves.toMatchObject({ ok: false, code: "MEDIA_STOP_FAILED" });
    expect(calls).toEqual(["live.stop:phone-1", "live.stop:phone-2", "media.stop", "relay.stop"]);
    await runtime.dispose();
    await runtime.dispose();
    await expect(runtime.start()).resolves.toMatchObject({ ok: false, code: "DISPOSED" });
    await expect(runtime.stop()).resolves.toMatchObject({ ok: false, code: "DISPOSED" });
  });

  it("forwards relay updates only after becoming running", async () => {
    let relayListener: (() => void) | undefined;
    const runtime = DesktopRuntime.create({
      relay: { start: async () => ({ ok: true }), stop: async () => undefined, snapshot: () => ({}), subscribe: (listener) => { relayListener = listener; return () => undefined; } },
      media: { start: () => ({ ok: true }), stop: () => ({ ok: true }), snapshot: () => ({}), dispose: () => undefined },
      live: { list: () => [], stop: async () => ({ ok: true }) }
    }, { mediaStartInput: {} });
    const revisions: number[] = [];
    runtime.subscribe((snapshot) => revisions.push(snapshot.revision));
    relayListener!();
    expect(revisions).toEqual([]);
    await runtime.start();
    const before = runtime.snapshot().revision;
    relayListener!();
    expect(runtime.snapshot().revision).toBe(before + 1);
  });

  it("tolerates an untrusted live list and reports a relay stop fault after successful media cleanup", async () => {
    const calls: string[] = [];
    const runtime = DesktopRuntime.create({
      relay: { start: async () => ({ ok: true }), stop: async () => { calls.push("relay.stop"); throw new Error("relay"); }, snapshot: () => ({}), subscribe: () => () => undefined },
      media: { start: () => ({ ok: true }), stop: () => { calls.push("media.stop"); return { ok: true }; }, snapshot: () => ({}), dispose: () => undefined },
      live: { list: () => 1 as never, stop: async (deviceId) => { calls.push(`live.stop:${deviceId}`); return { ok: true }; } }
    }, { mediaStartInput: {} });
    await runtime.start();
    await expect(runtime.stop()).resolves.toMatchObject({ ok: false, code: "RELAY_STOP_FAILED" });
    expect(calls).toEqual(["media.stop", "relay.stop"]);
  });

  it("makes repeated disposal a no-op with an unchanged terminal snapshot", async () => {
    const calls: string[] = [];
    const runtime = DesktopRuntime.create({
      relay: { start: async () => ({ ok: true }), stop: async () => { calls.push("relay.stop"); }, snapshot: () => ({}), subscribe: () => () => { calls.push("relay.unsubscribe"); } },
      media: { start: () => ({ ok: true }), stop: () => { calls.push("media.stop"); return { ok: true }; }, snapshot: () => ({}), dispose: () => { calls.push("media.dispose"); } },
      live: { list: () => [], stop: async () => ({ ok: true }) }
    }, { mediaStartInput: {} });
    await runtime.dispose();
    const first = runtime.snapshot();
    await runtime.dispose();
    expect(runtime.snapshot()).toEqual(first);
    expect(calls).toEqual(["relay.unsubscribe", "media.dispose"]);
  });
});
