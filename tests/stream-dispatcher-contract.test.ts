import { describe, expect, it } from "vitest";
import { StreamDispatcher } from "../src/modules/live-stream-control/stream-dispatcher/index.js";

const telemetry = () => ({
  payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true },
  capabilities: { liveVideo: true }
});

function fixture(overrides: Partial<{
  readonly media: () => unknown;
  readonly telemetry: () => unknown;
  readonly gate: (input: unknown) => unknown;
  readonly target: (input: unknown) => unknown;
  readonly send: (deviceId: string, request: unknown) => Promise<unknown>;
}> = {}) {
  const sent: unknown[] = [];
  const dispatcher = StreamDispatcher.create({
    media: { snapshot: overrides.media ?? (() => ({ phase: "running", endpoint: { host: "192.168.1.20", port: 1935 } })) },
    relay: {
      latestTelemetry: overrides.telemetry ?? telemetry,
      sendCommand: overrides.send ?? (async (deviceId, request) => { sent.push({ deviceId, request }); return { status: "succeeded" }; })
    },
    capabilityGate: { evaluate: overrides.gate ?? (() => ({ ok: true, value: { enabled: true, reason: null } })) },
    targetConfig: { createRtmpTarget: overrides.target ?? ((input) => ({ ok: true, value: { protocol: "rtmp", rtmpUrl: `rtmp://192.168.1.20:1935/live/${encodeURIComponent((input as { deviceId: string }).deviceId)}` } })) }
  });
  return { dispatcher, sent };
}

describe("StreamDispatcher", () => {
  it("starts a device only through the exact RTMP command and records streaming", async () => {
    const value = fixture();
    await expect(value.dispatcher.start("phone-1")).resolves.toMatchObject({ ok: true, operation: "start", state: { phase: "streaming" } });
    expect(value.sent).toEqual([{ deviceId: "phone-1", request: { name: "live-stream.start", fields: { rtmpUrl: "rtmp://192.168.1.20:1935/live/phone-1" } } }]);
    expect(value.dispatcher.get("phone-1")).toMatchObject({ phase: "streaming" });
  });

  it("stops without asking the media service for an endpoint", async () => {
    const value = fixture({ media: () => { throw new Error("not used"); } });
    await expect(value.dispatcher.stop("phone-1")).resolves.toMatchObject({ ok: true, operation: "stop", state: { phase: "idle" } });
    expect(value.sent).toEqual([{ deviceId: "phone-1", request: { name: "live-stream.stop", fields: {} } }]);
  });

  it("does not send when media, target configuration or capability checks reject the request", async () => {
    const media = fixture({ media: () => ({ phase: "idle", endpoint: null }) });
    await expect(media.dispatcher.start("phone-1")).resolves.toMatchObject({ ok: false, code: "MEDIA_PIPELINE_UNAVAILABLE" });
    expect(media.sent).toEqual([]);
    const config = fixture({ target: () => ({ ok: false, code: "INVALID_TARGET" }) });
    await expect(config.dispatcher.start("phone-1")).resolves.toMatchObject({ ok: false, code: "CONFIGURATION_INVALID" });
    expect(config.sent).toEqual([]);
    const blocked = fixture({ gate: () => ({ ok: true, value: { enabled: false, reason: "LIVE_VIDEO_UNSUPPORTED" } }) });
    await expect(blocked.dispatcher.start("phone-1")).resolves.toMatchObject({ ok: false, code: "CAPABILITY_BLOCKED", reason: "LIVE_VIDEO_UNSUPPORTED" });
    expect(blocked.sent).toEqual([]);
  });

  it("reports missing telemetry through the capability gate as a disconnected relay", async () => {
    const inputs: unknown[] = [];
    const value = fixture({
      telemetry: () => null,
      gate: (input) => { inputs.push(input); return { ok: true, value: { enabled: false, reason: "RELAY_OFFLINE" } }; }
    });
    await expect(value.dispatcher.start("phone-1")).resolves.toMatchObject({ ok: false, code: "CAPABILITY_BLOCKED", reason: "RELAY_OFFLINE" });
    expect(inputs).toEqual([expect.objectContaining({ relayConnected: false, capabilities: {} })]);
  });

  it("isolates devices, ignores late completion after disconnect and manages terminal records", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const value = fixture({ send: () => new Promise((resolve) => { resolvers.push(resolve); }) });
    const snapshots: unknown[] = [];
    const unsubscribe = value.dispatcher.subscribe((current) => snapshots.push(current));
    const first = value.dispatcher.start("phone-1");
    await expect(value.dispatcher.stop("phone-1")).resolves.toMatchObject({ ok: false, code: "OPERATION_IN_PROGRESS" });
    const second = value.dispatcher.start("phone-2");
    expect(value.dispatcher.recordDisconnected("phone-1")).toMatchObject({ phase: "disconnected" });
    resolvers.forEach((resolve) => resolve({ status: "succeeded" }));
    await expect(first).resolves.toMatchObject({ ok: false, code: "DISCONNECTED", state: { phase: "disconnected" } });
    await expect(second).resolves.toMatchObject({ ok: true, state: { phase: "streaming" } });
    expect(value.dispatcher.forget("phone-1")).toBe(true);
    expect(value.dispatcher.forget("phone-2")).toBe(false);
    unsubscribe();
    expect(snapshots.length).toBeGreaterThan(0);
  });

  it("maps command rejection, dependency faults and invalid input without throwing", async () => {
    const rejected = fixture({ send: async () => ({ status: "rejected" }) });
    await expect(rejected.dispatcher.start("phone-1")).resolves.toMatchObject({ ok: false, code: "RELAY_REJECTED", state: { phase: "failed" } });
    const failed = fixture({ send: async () => { throw new Error("transport"); } });
    await expect(failed.dispatcher.stop("phone-1")).resolves.toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    await expect(failed.dispatcher.start(" ")).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT", state: null });
    expect(failed.dispatcher.get(" ")).toMatchObject({ phase: "idle" });
  });

  it("contains malformed dependencies and preserves state-listener isolation", async () => {
    const badTelemetry = fixture({ telemetry: () => 1 });
    expect(badTelemetry.dispatcher.check("phone-1")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    await expect(badTelemetry.dispatcher.start("phone-1")).resolves.toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    const hostileTelemetry = fixture({ telemetry: () => ({ get payload(): never { throw new Error("payload"); }, capabilities: {} }) });
    expect(hostileTelemetry.dispatcher.check("phone-1")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    const noReason = fixture({ gate: () => ({ ok: true, value: { enabled: false } }) });
    await expect(noReason.dispatcher.stop("phone-1")).resolves.toMatchObject({ ok: false, code: "CAPABILITY_BLOCKED", reason: "CAPABILITY_UNKNOWN" });
    const mediaFault = fixture({ media: () => { throw new Error("media"); } });
    await expect(mediaFault.dispatcher.start("phone-1")).resolves.toMatchObject({ ok: false, code: "MEDIA_PIPELINE_UNAVAILABLE" });
    const configFault = fixture({ target: () => { throw new Error("target"); } });
    await expect(configFault.dispatcher.start("phone-1")).resolves.toMatchObject({ ok: false, code: "CONFIGURATION_INVALID" });
    const value = fixture();
    value.dispatcher.subscribe(() => { throw new Error("observer"); });
    const stop = await value.dispatcher.stop("phone-1");
    expect(stop).toMatchObject({ ok: true, state: { phase: "idle" } });
    expect(value.dispatcher.recordDisconnected("missing")).toBeNull();
    expect(value.dispatcher.forget("missing")).toBe(false);
    expect(value.dispatcher.forget("phone-1")).toBe(true);
    expect(value.dispatcher.list()).toEqual([]);
  });

  it("normalizes non-record values and invalid device types at every boundary", async () => {
    const nonRecordPayload = fixture({ telemetry: () => ({ payload: 1, capabilities: 1 }) });
    await expect(nonRecordPayload.dispatcher.start("phone-1")).resolves.toMatchObject({ ok: true });
    const gateFault = fixture({ gate: () => ({ ok: true, value: { enabled: "yes" } }) });
    expect(gateFault.dispatcher.check("phone-1")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    const invalidStatus = fixture({ send: async () => 1 });
    await expect(invalidStatus.dispatcher.stop("phone-1")).resolves.toMatchObject({ ok: false, code: "RELAY_REJECTED" });
    const statusGetter = fixture({ send: async () => ({ get status(): never { throw new Error("status"); } }) });
    await expect(statusGetter.dispatcher.stop("phone-1")).resolves.toMatchObject({ ok: false, code: "RELAY_REJECTED" });
    const value = fixture();
    expect(value.dispatcher.check(" ")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(value.dispatcher.start(1 as never)).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(value.dispatcher.stop(1 as never)).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await value.dispatcher.start("phone-1");
    expect(value.dispatcher.get("phone-1")).toMatchObject({ phase: "streaming" });
    expect(value.dispatcher.get(1 as never)).toMatchObject({ phase: "idle" });
    await expect(value.dispatcher.stop("x".repeat(128))).resolves.toMatchObject({ ok: true });
    await expect(value.dispatcher.stop("x".repeat(129))).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(value.dispatcher.stop("phone\n1")).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("passes telemetry capabilities and connection state to the capability gate exactly", () => {
    const onlineInputs: unknown[] = [];
    const capabilities = { liveVideo: true, custom: "retained" };
    const online = fixture({
      telemetry: () => ({ payload: { sdkRegistered: false, remoteControllerConnected: false, flightControllerConnected: false, connected: false }, capabilities }),
      gate: (input) => { onlineInputs.push(input); return { ok: true, value: { enabled: true } }; }
    });
    expect(online.dispatcher.check("phone-1")).toEqual({ ok: true });
    expect(onlineInputs).toEqual([{
      operation: "live-stream",
      relayConnected: true,
      sdkRegistered: false,
      remoteControllerConnected: false,
      flightControllerConnected: false,
      aircraftConnected: false,
      capabilities
    }]);

    const offlineInputs: unknown[] = [];
    const offline = fixture({ telemetry: () => null, gate: (input) => { offlineInputs.push(input); return { ok: true, value: { enabled: true } }; } });
    expect(offline.dispatcher.check("phone-1")).toEqual({ ok: true });
    expect(offlineInputs).toEqual([expect.objectContaining({ relayConnected: false, capabilities: {}, sdkRegistered: undefined, remoteControllerConnected: undefined, flightControllerConnected: undefined, aircraftConnected: undefined })]);
  });

  it("treats malformed telemetry, gate and target contracts as dependency failures without dispatching", async () => {
    const telemetryCases = [undefined, true, "telemetry"];
    for (const candidate of telemetryCases) {
      const value = fixture({ telemetry: () => candidate });
      expect(value.dispatcher.check("phone-1")).toEqual({ ok: false, code: "DEPENDENCY_FAILURE" });
      await expect(value.dispatcher.stop("phone-1")).resolves.toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
      expect(value.sent).toEqual([]);
    }
    expect(fixture({ telemetry: () => ({}) }).dispatcher.check("phone-1")).toEqual({ ok: true });
    for (const gate of [
      () => { throw new Error("gate"); },
      () => undefined,
      () => ({}),
      () => ({ ok: false }),
      () => ({ ok: false, value: { enabled: true } }),
      () => ({ ok: true, value: null }),
      () => ({ ok: true, value: 1 }),
      () => ({ ok: true, value: { enabled: "yes" } })
    ]) {
      const value = fixture({ gate });
      expect(value.dispatcher.check("phone-1")).toEqual({ ok: false, code: "DEPENDENCY_FAILURE" });
      await expect(value.dispatcher.stop("phone-1")).resolves.toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
      expect(value.sent).toEqual([]);
    }
    for (const target of [
      () => undefined,
      () => null,
      () => 1,
      () => ({ ok: false }),
      () => ({ ok: false, value: { rtmpUrl: "rtmp://127.0.0.1/live/phone-1" } }),
      () => ({ ok: true, value: null }),
      () => ({ ok: true, value: 1 }),
      () => ({ ok: true, value: { rtmpUrl: 1 } })
    ]) {
      const value = fixture({ target });
      await expect(value.dispatcher.start("phone-1")).resolves.toMatchObject({ ok: false, code: "CONFIGURATION_INVALID", state: { phase: "failed" } });
      expect(value.sent).toEqual([]);
    }
  });

  it("requires a running media endpoint before constructing a target", async () => {
    for (const media of [
      () => null,
      () => 1,
      () => ({ phase: "idle", endpoint: { host: "127.0.0.1", port: 1935 } }),
      () => ({ phase: "running", endpoint: null }),
      () => ({ phase: "running", endpoint: 1 })
    ]) {
      const value = fixture({ media });
      await expect(value.dispatcher.start("phone-1")).resolves.toMatchObject({ ok: false, code: "MEDIA_PIPELINE_UNAVAILABLE", state: { phase: "failed" } });
      expect(value.sent).toEqual([]);
    }
  });

  it("publishes transition phases, clears busy lanes, and makes subscription disposal idempotent", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const value = fixture({ send: () => new Promise((resolve) => { resolvers.push(resolve); }) });
    const events: Array<readonly unknown[]> = [];
    const unsubscribe = value.dispatcher.subscribe((current) => events.push(current));

    const starting = value.dispatcher.start("phone-1");
    expect(value.dispatcher.get("phone-1")).toMatchObject({ phase: "starting" });
    resolvers.shift()!({ status: "succeeded" });
    await expect(starting).resolves.toMatchObject({ ok: true, state: { phase: "streaming" } });

    const stopping = value.dispatcher.stop("phone-1");
    expect(value.dispatcher.get("phone-1")).toMatchObject({ phase: "stopping" });
    resolvers.shift()!({ status: "succeeded" });
    await expect(stopping).resolves.toMatchObject({ ok: true, state: { phase: "idle" } });
    const restarted = value.dispatcher.start("phone-1");
    resolvers.shift()!({ status: "succeeded" });
    await expect(restarted).resolves.toMatchObject({ ok: true, state: { phase: "streaming" } });

    const beforeDispose = events.length;
    unsubscribe();
    unsubscribe();
    value.dispatcher.recordDisconnected("phone-1");
    expect(events).toHaveLength(beforeDispose);
  });

  it("keeps list order and snapshots immutable across terminal lanes and missing lookups", async () => {
    const value = fixture({ send: async () => ({ status: "rejected" }) });
    await value.dispatcher.stop("z-phone");
    await value.dispatcher.stop("a-phone");
    expect(value.dispatcher.recordDisconnected("z-phone")).toMatchObject({ phase: "disconnected" });
    const listed = value.dispatcher.list();
    expect(listed).toEqual([
      expect.objectContaining({ deviceId: "a-phone", phase: "failed", lastOperation: "stop", failureCode: "RELAY_REJECTED", reason: null }),
      expect.objectContaining({ deviceId: "z-phone", phase: "disconnected", lastOperation: "stop", failureCode: "DISCONNECTED", reason: null })
    ]);
    expect(Object.isFrozen(listed)).toBe(true);
    expect(Object.isFrozen(listed[0]!)).toBe(true);
    expect(value.dispatcher.get("missing")).toEqual({ deviceId: "missing", phase: "idle", lastOperation: null, failureCode: null, reason: null });
    expect(value.dispatcher.get(1 as never)).toEqual({ deviceId: "", phase: "idle", lastOperation: null, failureCode: null, reason: null });
  });

  it("returns disconnected after a late completion and releases the lane for a later request", async () => {
    let resolve: ((value: unknown) => void) | undefined;
    let permitted = true;
    const value = fixture({
      gate: () => ({ ok: true, value: { enabled: permitted, reason: "RELAY_OFFLINE" } }),
      send: () => new Promise((done) => { resolve = done; })
    });
    const pending = value.dispatcher.start("phone-1");
    expect(value.dispatcher.recordDisconnected("phone-1")).toMatchObject({ phase: "disconnected" });
    resolve!({ status: "succeeded" });
    await expect(pending).resolves.toMatchObject({ ok: false, code: "DISCONNECTED", state: { phase: "disconnected" } });
    permitted = false;
    await expect(value.dispatcher.start("phone-1")).resolves.toMatchObject({ ok: false, code: "CAPABILITY_BLOCKED", reason: "RELAY_OFFLINE" });
  });

  it("keeps failed result objects exact when a dependency does not provide an explanatory reason", async () => {
    const value = fixture({ gate: () => ({ ok: true, value: null }) });
    const dependencyFailure = await value.dispatcher.stop("phone-1");
    expect(dependencyFailure).toEqual({
      ok: false,
      operation: "stop",
      code: "DEPENDENCY_FAILURE",
      state: { deviceId: "phone-1", phase: "idle", lastOperation: null, failureCode: null, reason: null }
    });
    expect(Object.hasOwn(dependencyFailure, "reason")).toBe(false);
    const blocked = fixture({ gate: () => ({ ok: true, value: { enabled: false } }) });
    await expect(blocked.dispatcher.stop("phone-1")).resolves.toEqual({
      ok: false,
      operation: "stop",
      code: "CAPABILITY_BLOCKED",
      reason: "CAPABILITY_UNKNOWN",
      state: { deviceId: "phone-1", phase: "idle", lastOperation: null, failureCode: null, reason: null }
    });
  });

  it("does not create a non-string lane key for an invalid device input", async () => {
    const value = fixture();
    await expect(value.dispatcher.start(1 as never)).resolves.toEqual({ ok: false, operation: "start", code: "INVALID_INPUT", state: null });
    expect(value.dispatcher.list()).toEqual([{ deviceId: "", phase: "idle", lastOperation: null, failureCode: null, reason: null }]);
  });
});
