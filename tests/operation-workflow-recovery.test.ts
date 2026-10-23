import { afterEach, describe, expect, it, vi } from "vitest";
import { FlightCommandDispatcher, FlightControl, type FlightAction } from "../src/modules/flight-control/index.js";
import { OperationWorkflow } from "../src/production/operation-workflow/index.js";

const aircraft = ["aircraft-a", "aircraft-b", "aircraft-c", "aircraft-d"] as const;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
};
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const release of cleanup.splice(0)) release();
  vi.useRealTimers();
});

function setup() {
  vi.useFakeTimers();
  const sessions = new Map<string, string>(aircraft.map((id) => [id, `${id}-session-1`]));
  const relayListeners = new Set<() => void>();
  const signal = () => { for (const listener of relayListeners) listener(); };
  const flightReplies = new Map(aircraft.map((id) => [id, deferred<unknown>()]));
  const stopReplies = new Map(aircraft.map((id) => [id, deferred<{ ok: boolean }>()]));
  const streamPhases = new Map<string, string>(aircraft.map((id) => [id, "streaming"]));
  const mediaPhases = new Map<string, string>(aircraft.map((id) => [id, "failed"]));
  const flightCommands: Array<{ deviceId: string; name: string }> = [];
  const stops: string[] = [];
  const cancels: Array<{ deviceId: string; confirmationId: string }> = [];
  const facts = { payload: {
    sdkAvailability: "READY", remoteController: "CONNECTED", flightController: "CONNECTED",
    airLink: "CONNECTED", camera: "CONNECTED", isFlying: true, motorsOn: true,
  }, capabilities: { liveVideo: true } };
  const dispatcher = FlightCommandDispatcher.create({
    relay: {
      latestTelemetry: () => facts,
      sendCommand: (deviceId, request) => {
        flightCommands.push({ deviceId, name: request.name });
        return flightReplies.get(deviceId as typeof aircraft[number])!.promise;
      },
    },
    preflight: { evaluateFlightAction: () => ({ ok: true }) },
  });
  let confirmationSequence = 0;
  const flight = FlightControl.create({ dispatcher }, {
    now: () => 100,
    confirmation: { ttlMs: 30_000, createConfirmationId: () => `confirmation-${++confirmationSequence}` },
  });
  const workflow = OperationWorkflow.create({
    relayOperations: {
      devices: () => [...sessions].map(([deviceId, sessionId]) => ({ deviceId, sessionId })),
      telemetry: () => facts, controlTelemetry: () => facts,
      subscribe: (listener: () => void) => { relayListeners.add(listener); return () => { relayListeners.delete(listener); }; },
    },
    routeLibrary: { list: () => [] },
    missionControl: { get: (deviceId: string) => ({ deviceId, phase: "idle" }), subscribe: () => () => undefined },
    liveStreamControl: {
      get: (deviceId: string) => ({ deviceId, phase: streamPhases.get(deviceId) }),
      stop: async (deviceId: string) => {
        stops.push(deviceId);
        streamPhases.set(deviceId, "stopping");
        try {
          const result = await stopReplies.get(deviceId as typeof aircraft[number])!.promise;
          if (streamPhases.get(deviceId) === "stopping") streamPhases.set(deviceId, result.ok ? "stopped" : "failed");
          return result;
        } catch (error) {
          if (streamPhases.get(deviceId) === "stopping") streamPhases.set(deviceId, "failed");
          throw error;
        }
      },
      recordDisconnected: (deviceId: string) => { streamPhases.set(deviceId, "disconnected"); },
      subscribe: () => () => undefined,
    },
    mediaPipeline: {
      snapshot: () => ({ streams: [...mediaPhases].map(([deviceId, phase]) => ({ deviceId, phase })) }),
      evaluate: () => ({ ok: true }), invalidateStreamSource: () => undefined,
    },
    flightControl: {
      ...flight,
      cancel: (deviceId: string, confirmationId: string) => {
        cancels.push({ deviceId, confirmationId });
        return flight.cancel(deviceId, confirmationId);
      },
    },
    deviceSettings: { snapshot: () => ({}) },
    hardwareReadiness: { lanAddressAvailable: true, legacyMediaAvailable: true },
    now: () => 100,
  } as never);
  cleanup.push(() => {
    workflow.dispose();
    flight.dispose();
    for (const reply of flightReplies.values()) reply.resolve({ status: "succeeded" });
    for (const reply of stopReplies.values()) reply.resolve({ ok: true });
  });
  const device = (deviceId: string) => workflow.snapshot().devices.find((item) => item.deviceId === deviceId);
  const request = async (deviceId: string, action: FlightAction = "land") => {
    await expect(workflow.requestFlightAction(deviceId, action)).resolves.toMatchObject({ ok: true, value: { ok: true } });
    return flight.get(deviceId)!.confirmationId;
  };
  const disconnect = (deviceId: string) => { sessions.delete(deviceId); signal(); };
  return { workflow, device, request, disconnect, sessions, signal, flightReplies, stopReplies, streamPhases, mediaPhases, flightCommands, stops, cancels };
}

describe("operation workflow flight completion isolation", () => {
  it("keeps four aircraft independent when an old land ACK arrives after session replacement", async () => {
    const h = setup();
    const confirmations = await Promise.all(aircraft.map((id) => h.request(id)));
    const pending = aircraft.map((id, index) => h.workflow.confirmFlightAction(id, confirmations[index]!));
    for (const id of aircraft.slice(1)) h.flightReplies.get(id)!.resolve({ status: "succeeded" });
    await Promise.all(pending.slice(1));
    const peers = h.workflow.snapshot().devices.slice(1);
    expect(peers.map((item) => item.landing.phase)).toEqual(["awaiting-msdk", "awaiting-msdk", "awaiting-msdk"]);

    h.sessions.set(aircraft[0], "replacement-session");
    h.signal();
    h.flightReplies.get(aircraft[0])!.resolve({ status: "succeeded" });
    await expect(pending[0]).resolves.toMatchObject({ ok: true, value: { ok: true, code: "SUCCEEDED" } });

    expect(h.device(aircraft[0])).toMatchObject({ connectionEpoch: 0, landing: { phase: "idle" } });
    expect(h.workflow.snapshot().devices.slice(1)).toEqual(peers);
    expect(h.flightCommands).toEqual(aircraft.map((deviceId) => ({ deviceId, name: "flight.land" })));
  });

  it("rejects stale local effects even before a changed session notification arrives", async () => {
    const h = setup();
    const pending = h.workflow.confirmFlightAction(aircraft[0], await h.request(aircraft[0]));
    h.sessions.set(aircraft[0], "replacement-session");
    h.flightReplies.get(aircraft[0])!.resolve({ status: "succeeded" });
    await pending;
    expect(h.device(aircraft[0])?.landing.phase).toBe("idle");
  });

  it.each(["before-reconnect", "after-reconnect"])("ignores a disconnected flight result resolved %s, even with the same session ID", async (timing) => {
    const h = setup();
    const pending = h.workflow.confirmFlightAction(aircraft[0], await h.request(aircraft[0]));
    const sessionId = h.sessions.get(aircraft[0])!;
    h.disconnect(aircraft[0]);
    expect(h.workflow.snapshot().devices.map((item) => item.deviceId)).toEqual(aircraft.slice(1));
    const reconnect = () => { h.sessions.set(aircraft[0], sessionId); h.signal(); };
    if (timing === "after-reconnect") reconnect();
    h.flightReplies.get(aircraft[0])!.resolve({ status: "succeeded" });
    await pending;
    if (timing === "before-reconnect") reconnect();
    expect(h.device(aircraft[0])).toMatchObject({ connectionEpoch: 0, landing: { phase: "idle" } });
    expect(h.flightCommands).toHaveLength(1);
    expect(h.stops).toEqual([]);
  });

  it("invalidates the old dispatch when session identity changes away and back", async () => {
    const h = setup();
    const pending = h.workflow.confirmFlightAction(aircraft[0], await h.request(aircraft[0]));
    const original = h.sessions.get(aircraft[0])!;
    h.sessions.set(aircraft[0], "temporary-session"); h.signal();
    h.sessions.set(aircraft[0], original); h.signal();
    h.flightReplies.get(aircraft[0])!.resolve({ status: "succeeded" });
    await pending;
    expect(h.device(aircraft[0])?.landing.phase).toBe("idle");
  });

  it.each(["succeeded", "rejected", "throw"])("preserves a newer same-session confirmation after an older %s result", async (outcome) => {
    const h = setup();
    const pending = h.workflow.confirmFlightAction(aircraft[0], await h.request(aircraft[0]));
    const newer = await h.request(aircraft[0], "stop-auto-landing");
    if (outcome === "throw") h.flightReplies.get(aircraft[0])!.reject(new Error("in-memory dispatch failure"));
    else h.flightReplies.get(aircraft[0])!.resolve({ status: outcome });
    await pending;
    expect(h.device(aircraft[0])?.pendingFlightAction).toMatchObject({ confirmationId: newer });
    expect(h.device(aircraft[0])?.landing.phase).toBe(outcome === "succeeded" ? "awaiting-msdk" : "idle");
    h.disconnect(aircraft[0]);
    expect(h.cancels).toContainEqual({ deviceId: aircraft[0], confirmationId: newer });
    expect(h.flightCommands).toHaveLength(1);
  });

  it("keeps a new session confirmation cancellable after the old flight result completes", async () => {
    const h = setup();
    const pending = h.workflow.confirmFlightAction(aircraft[0], await h.request(aircraft[0]));
    h.sessions.set(aircraft[0], "replacement-session"); h.signal();
    const newer = await h.request(aircraft[0], "return-home");
    h.flightReplies.get(aircraft[0])!.resolve({ status: "succeeded" });
    await pending;
    h.disconnect(aircraft[0]);
    expect(h.cancels).toContainEqual({ deviceId: aircraft[0], confirmationId: newer });
  });

  it("clears the completed confirmation when no newer confirmation exists", async () => {
    const h = setup();
    const confirmation = await h.request(aircraft[0]);
    const pending = h.workflow.confirmFlightAction(aircraft[0], confirmation);
    h.flightReplies.get(aircraft[0])!.resolve({ status: "succeeded" });
    await pending;
    expect(h.device(aircraft[0])).toMatchObject({ pendingFlightAction: null, landing: { phase: "awaiting-msdk" } });
    h.disconnect(aircraft[0]);
    expect(h.cancels).toEqual([]);
  });

  it("does not mutate or publish after disposal when a flight ACK completes late", async () => {
    const h = setup();
    const pending = h.workflow.confirmFlightAction(aircraft[0], await h.request(aircraft[0]));
    const listener = vi.fn();
    h.workflow.subscribe(listener);
    h.workflow.dispose(); h.workflow.dispose();
    const disposed = h.workflow.snapshot();
    h.flightReplies.get(aircraft[0])!.resolve({ status: "succeeded" });
    await pending;
    expect(h.workflow.snapshot()).toEqual(disposed);
    expect(listener).not.toHaveBeenCalled();
    expect(h.flightCommands).toHaveLength(1);
  });
});

describe("operation workflow failed-media cleanup isolation", () => {
  it("sends all four stops while the first is stalled, isolates failures, and never retries", async () => {
    const h = setup();
    expect(h.workflow.refreshMedia()).toMatchObject({ ok: true });
    expect(h.stops).toEqual(aircraft);
    expect(h.workflow.refreshMedia()).toMatchObject({ ok: true });
    expect(h.stops).toEqual(aircraft);

    h.stopReplies.get(aircraft[1])!.reject(new Error("in-memory stop failure"));
    h.stopReplies.get(aircraft[2])!.resolve({ ok: false });
    h.stopReplies.get(aircraft[3])!.resolve({ ok: true });
    await vi.runAllTicks();
    await Promise.resolve();
    await Promise.resolve();
    expect(aircraft.map((id) => h.device(id)?.stream.phase)).toEqual(["stopping", "failed", "failed", "stopped"]);
    h.workflow.refreshMedia();
    expect(h.stops).toEqual(aircraft);
    h.stopReplies.get(aircraft[0])!.resolve({ ok: true });
    await Promise.resolve();
    expect(h.flightCommands).toEqual([]);
  });

  it("only cleans failed media for online starting or streaming aircraft", async () => {
    const h = setup();
    h.streamPhases.set(aircraft[0], "starting");
    h.mediaPhases.set(aircraft[1], "ready");
    h.streamPhases.set(aircraft[2], "stopped");
    h.sessions.delete(aircraft[3]);
    h.workflow.refreshMedia();
    expect(h.stops).toEqual([aircraft[0]]);
    expect(h.workflow.snapshot().devices.map((item) => item.deviceId)).toEqual(aircraft.slice(0, 3));
  });

  it("does not queue more cleanup commands or publish after disconnect, session replacement, and disposal", async () => {
    const h = setup();
    h.workflow.refreshMedia();
    expect(h.stops).toEqual(aircraft);
    h.disconnect(aircraft[0]);
    h.sessions.set(aircraft[1], "replacement-session"); h.signal();
    const listener = vi.fn();
    h.workflow.subscribe(listener);
    h.workflow.dispose();
    const disposed = h.workflow.snapshot();
    for (const reply of h.stopReplies.values()) reply.resolve({ ok: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(h.stops).toEqual(aircraft);
    expect(h.workflow.snapshot()).toEqual(disposed);
    expect(listener).not.toHaveBeenCalled();
    expect(h.workflow.refreshMedia()).toEqual({ ok: false, code: "DISPOSED" });
    expect(h.flightCommands).toEqual([]);
  });
});
