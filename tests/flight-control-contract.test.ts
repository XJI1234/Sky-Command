import { describe, expect, it } from "vitest";
import { FlightControl } from "../src/modules/flight-control/index.js";

function fixture(overrides: Partial<{
  readonly now: () => number;
  readonly check: (deviceId: string, action: string) => unknown;
  readonly dispatch: (deviceId: string, action: string) => Promise<unknown>;
}> = {}) {
  const events: unknown[] = [];
  const control = FlightControl.create({
    dispatcher: {
      check: overrides.check ?? (() => ({ ok: true })),
      dispatch: overrides.dispatch ?? (async (deviceId, action) => ({ ok: true, code: "SUCCEEDED", deviceId, action })),
      isBusy: () => false
    }
  }, { now: overrides.now ?? (() => 100), confirmation: { ttlMs: 1_000, createConfirmationId: () => "confirm-1" } });
  control.subscribe((snapshot) => events.push(snapshot));
  return { control, events };
}

describe("FlightControl", () => {
  it("向手机端飞控命令发送明确的确认字段", async () => {
    const requests: unknown[] = [];
    const dispatcher = (await import("../src/modules/flight-control/flight-command-dispatcher/index.js")).FlightCommandDispatcher.create({
      relay: {
        latestTelemetry: () => ({ payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true }, capabilities: {} }),
        sendCommand: async (_deviceId, request) => { requests.push(request); return { status: "succeeded" }; }
      },
      preflight: { evaluateFlightAction: () => ({ ok: true }) },
      capabilityGate: { evaluate: () => ({ ok: true, value: { enabled: true } }) }
    });

    await expect(dispatcher.dispatch("phone-1", "return-home")).resolves.toMatchObject({ ok: true, code: "SUCCEEDED" });
    expect(requests).toEqual([{ name: "flight.return-home", fields: { confirm: true } }]);
  });

  it("creates a confirmation only after a successful safety check and dispatches only after consumption", async () => {
    const value = fixture();
    const request = value.control.request("phone-1", "takeoff");
    expect(request).toMatchObject({ ok: true, code: "CONFIRMATION_REQUIRED", confirmation: { confirmationId: "confirm-1" } });
    expect(value.control.get("phone-1")).toMatchObject({ action: "takeoff" });
    await expect(value.control.confirm("phone-1", "confirm-1")).resolves.toMatchObject({ ok: true, code: "SUCCEEDED", action: "takeoff" });
    expect(value.control.get("phone-1")).toBeNull();
    expect(value.events).toHaveLength(2);
  });

  it("never creates a confirmation for a blocked action and exposes the stable reason", () => {
    const value = fixture({ check: () => ({ ok: false, code: "PREFLIGHT_BLOCKED", blockers: [{ code: "BATTERY_LOW", message: "low" }] }) });
    expect(value.control.request("phone-1", "takeoff")).toMatchObject({ ok: false, code: "PREFLIGHT_BLOCKED", blockers: [{ code: "BATTERY_LOW" }] });
    expect(value.control.get("phone-1")).toBeNull();
  });

  it("does not permit confirmation reuse, cross-device use, cancellation or expiry to dispatch", async () => {
    let calls = 0;
    let time = 10;
    const value = fixture({ now: () => time, dispatch: async () => { calls++; return { ok: true, code: "SUCCEEDED", deviceId: "phone-1", action: "takeoff" }; } });
    value.control.request("phone-1", "takeoff");
    await expect(value.control.confirm("phone-2", "confirm-1")).resolves.toMatchObject({ ok: false, code: "NO_PENDING_CONFIRMATION" });
    expect(value.control.cancel("phone-1", "confirm-1")).toMatchObject({ ok: true, code: "CANCELLED" });
    await expect(value.control.confirm("phone-1", "confirm-1")).resolves.toMatchObject({ ok: false, code: "NO_PENDING_CONFIRMATION" });
    value.control.request("phone-1", "takeoff");
    time = 2_000;
    await expect(value.control.confirm("phone-1", "confirm-1")).resolves.toMatchObject({ ok: false, code: "CONFIRMATION_EXPIRED" });
    expect(calls).toBe(0);
  });

  it("isolates multiple devices and ignores late dispatch completion after disposal", async () => {
    let finish!: (value: unknown) => void;
    const value = fixture({ dispatch: () => new Promise((resolve) => { finish = resolve; }) });
    value.control.request("phone-1", "takeoff");
    value.control.request("phone-2", "land");
    const first = value.control.confirm("phone-1", "confirm-1");
    expect(value.control.get("phone-2")).toMatchObject({ action: "land" });
    value.control.dispose();
    finish({ ok: true, code: "SUCCEEDED", deviceId: "phone-1", action: "takeoff" });
    await expect(first).resolves.toMatchObject({ ok: false, code: "DISPOSED" });
    expect(value.control.get("phone-2")).toBeNull();
  });

  it("contains hostile clocks, dispatcher faults, stale reads and observer faults", async () => {
    const nowFault = fixture({ now: () => { throw new Error("clock"); } });
    expect(nowFault.control.request("phone-1", "takeoff")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    expect(nowFault.control.get("phone-1")).toBeNull();
    expect(nowFault.control.cancel("phone-1", "confirm-1")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    const checkingFault = fixture({ check: () => { throw new Error("check"); } });
    expect(checkingFault.control.request("phone-1", "takeoff")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    const dispatchFault = fixture({ dispatch: async () => { throw new Error("dispatch"); } });
    dispatchFault.control.subscribe(() => { throw new Error("observer"); });
    dispatchFault.control.request("phone-1", "takeoff");
    await expect(dispatchFault.control.confirm("phone-1", "confirm-1")).resolves.toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    expect(dispatchFault.control.get("bad\u0000")).toBeNull();
    expect(dispatchFault.control.cancel("phone-1", "wrong")).toMatchObject({ ok: false, code: "NO_PENDING_CONFIRMATION" });
    const unsubscribe = dispatchFault.control.subscribe(() => undefined);
    unsubscribe();
    unsubscribe();
    dispatchFault.control.dispose();
    dispatchFault.control.dispose();
    expect(dispatchFault.control.request("phone-1", "takeoff")).toMatchObject({ ok: false, code: "DISPOSED" });
    await expect(dispatchFault.control.confirm("phone-1", "confirm-1")).resolves.toMatchObject({ ok: false, code: "DISPOSED" });
  });

  it("returns stable results for every root confirmation boundary", async () => {
    const confirmationFailure = FlightControl.create({ dispatcher: { check: () => ({ ok: true }), dispatch: async (deviceId, action) => ({ ok: true, code: "SUCCEEDED", deviceId, action }), isBusy: () => false } }, { now: () => 1, confirmation: { ttlMs: 0, createConfirmationId: () => "confirm" } });
    expect(confirmationFailure.request("phone-1", "takeoff")).toMatchObject({ ok: false, code: "CONFIGURATION_INVALID" });
    expect(confirmationFailure.cancel("phone-1", "confirm")).toMatchObject({ ok: false, code: "CONFIGURATION_INVALID" });
    await expect(confirmationFailure.confirm("phone-1", "confirm")).resolves.toMatchObject({ ok: false, code: "CONFIGURATION_INVALID" });
    const valid = fixture();
    expect(valid.control.request(" ", "takeoff")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(valid.control.confirm(" ", "confirm-1")).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(valid.control.confirm("phone-1", " ")).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(valid.control.cancel(" ", "confirm-1")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(valid.control.cancel("phone-1", " ")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    valid.control.request("phone-1", "takeoff");
    expect(valid.control.cancel("phone-1", "wrong")).toMatchObject({ ok: false, code: "CONFIRMATION_MISMATCH" });
    expect(valid.control.get("phone-1")).toMatchObject({ action: "takeoff" });
  });

  it("publishes detached snapshots and removes a subscription exactly once", () => {
    const value = fixture();
    const snapshots: readonly (readonly unknown[])[] = [];
    const unsubscribe = value.control.subscribe((snapshot) => snapshots.push(snapshot));
    value.control.request("phone-1", "takeoff");
    expect(snapshots).toHaveLength(1);
    expect(Object.isFrozen(snapshots[0])).toBe(true);
    expect(snapshots[0]).toMatchObject([{ deviceId: "phone-1", action: "takeoff", confirmationId: "confirm-1" }]);
    unsubscribe();
    unsubscribe();
    value.control.cancel("phone-1", "confirm-1");
    expect(snapshots).toHaveLength(1);
  });

  it("handles read-time expiration, every check shape and all released calls", () => {
    let time = 1;
    const expiring = fixture({ now: () => time });
    expiring.control.request("phone-1", "takeoff");
    time = 2_000;
    expect(expiring.control.get("phone-1")).toBeNull();
    const reason = fixture({ check: () => ({ ok: false, code: "CAPABILITY_BLOCKED", reason: "UNSUPPORTED" }) });
    expect(reason.control.request("phone-1", "takeoff")).toMatchObject({ ok: false, code: "CAPABILITY_BLOCKED", reason: "UNSUPPORTED" });
    const bare = fixture({ check: () => ({ ok: false, code: "DEPENDENCY_FAILURE" }) });
    expect(bare.control.request("phone-1", "takeoff")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    const invalid = fixture();
    void invalid.control.confirm(7 as never, "confirm-1");
    invalid.control.dispose();
    expect(invalid.control.cancel("phone-1", "confirm-1")).toMatchObject({ ok: false, code: "DISPOSED" });
    expect(invalid.control.get("phone-1")).toBeNull();
  });

  it("contains nonnumeric clock values during publishing and confirming", async () => {
    let calls = 0;
    const control = FlightControl.create({ dispatcher: { check: () => ({ ok: true }), dispatch: async (deviceId, action) => ({ ok: true, code: "SUCCEEDED", deviceId, action }), isBusy: () => false } }, { now: () => {
      calls += 1;
      return calls === 1 ? 1 : true as never;
    }, confirmation: { ttlMs: 1_000, createConfirmationId: () => "confirm" } });
    control.subscribe(() => undefined);
    expect(control.request("phone-1", "takeoff")).toMatchObject({ ok: true });
    expect(control.get("phone-1")).toBeNull();
    await expect(control.confirm("phone-1", "confirm")).resolves.toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
  });

  it("clears a valid pending confirmation and rejects clear after disposal", () => {
    const value = fixture();
    expect(value.control.clear("phone-1")).toBe(false);
    expect(value.control.request("phone-1", "takeoff")).toMatchObject({ ok: true });
    expect(value.control.clear("phone-1")).toBe(true);
    expect(value.control.get("phone-1")).toBeNull();
    value.control.dispose();
    expect(value.control.clear("phone-1")).toBe(false);
  });
});
