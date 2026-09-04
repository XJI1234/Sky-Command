import { describe, expect, it } from "vitest";
import { FlightCommandDispatcher } from "../src/modules/flight-control/flight-command-dispatcher/index.js";

const telemetry = () => ({
  deviceId: "phone-1",
  payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true, isFlying: false, motorsOn: false, batteryPercent: 90 },
  capabilities: { directFlight: true }
});

function fixture(overrides: Partial<{
  readonly preflight: (input: unknown) => unknown;
  readonly latestTelemetry: (deviceId: string) => unknown;
  readonly sendCommand: (deviceId: string, request: unknown) => Promise<unknown>;
}> = {}) {
  const sent: unknown[] = [];
  const dispatcher = FlightCommandDispatcher.create({
    relay: {
      latestTelemetry: overrides.latestTelemetry ?? (() => telemetry()),
      sendCommand: overrides.sendCommand ?? (async (deviceId, request) => { sent.push({ deviceId, request }); return { deviceId, commandId: "command-1", status: "succeeded", detail: "ok" }; })
    },
    preflight: { evaluateFlightAction: overrides.preflight ?? (() => ({ ok: true, blockers: [] })) },
  } as never);
  return { dispatcher, sent };
}

describe("FlightCommandDispatcher", () => {
  it.each([
    ["takeoff", "flight.takeoff"],
    ["land", "flight.land"],
    ["confirm-landing", "flight.confirm-landing"],
    ["return-home", "flight.return-home"],
    ["stop-takeoff", "flight.stop-takeoff"],
    ["stop-auto-landing", "flight.stop-auto-landing"]
  ] as const)("maps %s to %s with frozen confirmation fields", async (action, command) => {
    const value = fixture();
    await expect(value.dispatcher.dispatch("phone-1", action)).resolves.toMatchObject({ ok: true, code: "SUCCEEDED", deviceId: "phone-1", action });
    expect(value.sent).toEqual([{ deviceId: "phone-1", request: { name: command, fields: { confirm: true } } }]);
    const request = (value.sent[0] as { readonly request: { readonly fields: object } }).request;
    expect(Object.isFrozen(request.fields)).toBe(true);
  });

  it("blocks before sending on preflight failures and preserves every blocker", async () => {
    const value = fixture({ preflight: () => ({ ok: false, blockers: [{ code: "BATTERY_LOW", message: "low" }, { code: "AIRCRAFT_DISCONNECTED", message: "off" }] }) });
    await expect(value.dispatcher.dispatch("phone-1", "takeoff")).resolves.toMatchObject({ ok: false, code: "PREFLIGHT_BLOCKED", blockers: [{ code: "BATTERY_LOW" }, { code: "AIRCRAFT_DISCONNECTED" }] });
    expect(value.sent).toEqual([]);
  });

  it("submits a confirmed takeoff without a generic capability gate deciding DJI hardware safety", async () => {
    const sent: unknown[] = [];
    let gateCalls = 0;
    const dispatcher = FlightCommandDispatcher.create({
      relay: {
        latestTelemetry: () => ({ payload: { sdkAvailability: "READY", remoteController: "DISCONNECTED", flightController: "UNKNOWN", batteryPercent: 1, isFlying: true, motorsOn: true }, capabilities: {} }),
        sendCommand: async (_deviceId, request) => { sent.push(request); return { status: "succeeded" }; },
      },
      preflight: { evaluateFlightAction: () => ({ ok: true, blockers: [] }) },
      capabilityGate: { evaluate: () => { gateCalls += 1; throw new Error("direct-flight must not invoke the generic capability gate"); } },
    } as never);

    await expect(dispatcher.dispatch("phone-1", "takeoff")).resolves.toMatchObject({ ok: true, code: "SUCCEEDED" });
    expect(gateCalls).toBe(0);
    expect(sent).toEqual([{ name: "flight.takeoff", fields: { confirm: true } }]);
  });

  it.each(["land", "confirm-landing", "return-home", "stop-takeoff", "stop-auto-landing"] as const)("does not call the capability gate before sending recovery action %s", async (action) => {
    let gateCalls = 0;
    const value = fixture({
      gate: () => {
        gateCalls += 1;
        throw new Error("recovery commands must not be filtered by the generic gate");
      },
    });

    await expect(value.dispatcher.dispatch("phone-1", action)).resolves.toMatchObject({ ok: true, code: "SUCCEEDED", action });
    expect(gateCalls).toBe(0);
    expect(value.sent).toHaveLength(1);
  });

  it("contains absent telemetry, dependency failures and malformed dependency results", async () => {
    const missing = fixture({ latestTelemetry: () => null, preflight: (input) => (input as { readonly relayConnected: boolean }).relayConnected ? { ok: true, blockers: [] } : { ok: false, blockers: [{ code: "RELAY_DISCONNECTED", message: "offline" }] } });
    expect(missing.dispatcher.check("phone-1", "takeoff")).toMatchObject({ ok: false, code: "PREFLIGHT_BLOCKED" });
    const failed = fixture({ preflight: () => { throw new Error("fault"); } });
    expect(failed.dispatcher.check("phone-1", "takeoff")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    const rejected = fixture({ sendCommand: async () => ({ status: "rejected", detail: "unavailable" }) });
    await expect(rejected.dispatcher.dispatch("phone-1", "takeoff")).resolves.toMatchObject({ ok: false, code: "RELAY_REJECTED" });
    const throwing = fixture({ sendCommand: async () => { throw new Error("transport"); } });
    await expect(throwing.dispatcher.dispatch("phone-1", "takeoff")).resolves.toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
  });

  it("preserves a complete flight-action rejection instead of flattening it into a relay failure", async () => {
    const value = fixture({
      sendCommand: async () => ({
        status: "rejected",
        detail: "DJI rejected flight command",
        result: {
          kind: "object",
          fields: {
            domain: { kind: "string", value: "flight" },
            outcome: { kind: "string", value: "ACTION_REJECTED" },
            errorCode: { kind: "string", value: "COMMON_SYSTEM_BUSY" },
            errorDescription: { kind: "string", value: "The aircraft is busy" }
          }
        }
      })
    });

    await expect(value.dispatcher.dispatch("phone-1", "takeoff")).resolves.toMatchObject({
      ok: false,
      code: "FLIGHT_ACTION_REJECTED",
      platformError: { code: "COMMON_SYSTEM_BUSY", description: "The aircraft is busy" }
    });
  });

  it("reports missing terminal results as unconfirmed and does not trust malformed platform errors", async () => {
    const timedOut = fixture({ sendCommand: async () => ({ status: "timed-out", detail: "Command timed out" }) });
    await expect(timedOut.dispatcher.dispatch("phone-1", "land")).resolves.toMatchObject({ ok: false, code: "RESULT_UNCONFIRMED" });

    const malformed = fixture({
      sendCommand: async () => ({
        status: "rejected",
        detail: "Flight action was rejected",
        result: {
          kind: "object",
          fields: {
            domain: { kind: "string", value: "flight" },
            outcome: { kind: "string", value: "ACTION_REJECTED" },
            errorCode: { kind: "string", value: "COMMON_SYSTEM_BUSY" }
          }
        }
      })
    });
    await expect(malformed.dispatcher.dispatch("phone-1", "land")).resolves.toMatchObject({ ok: false, code: "RELAY_REJECTED" });
  });

  it("serializes each device without blocking independent devices", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const value = fixture({ sendCommand: () => new Promise((resolve) => { resolvers.push(resolve); }) });
    const first = value.dispatcher.dispatch("phone-1", "takeoff");
    expect(value.dispatcher.isBusy("phone-1")).toBe(true);
    await expect(value.dispatcher.dispatch("phone-1", "land")).resolves.toMatchObject({ ok: false, code: "OPERATION_IN_PROGRESS" });
    const second = value.dispatcher.dispatch("phone-2", "takeoff");
    resolvers.forEach((resolve) => resolve({ status: "succeeded" }));
    await expect(first).resolves.toMatchObject({ ok: true });
    await expect(second).resolves.toMatchObject({ ok: true });
    expect(value.dispatcher.isBusy("phone-1")).toBe(false);
  });

  it("rejects invalid values without calling dependencies", async () => {
    const value = fixture();
    expect(value.dispatcher.check(" ", "takeoff")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(value.dispatcher.dispatch("phone-1", "bad" as never)).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(value.sent).toEqual([]);
  });

  it("contains hostile telemetry, blocker and command-result values", async () => {
    const primitiveTelemetry = fixture({ latestTelemetry: () => 1 });
    expect(primitiveTelemetry.dispatcher.check("phone-1", "takeoff")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    const hostileTelemetry = fixture({ latestTelemetry: () => new Proxy({}, { get() { throw new Error("telemetry"); } }) });
    expect(hostileTelemetry.dispatcher.check("phone-1", "takeoff")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    const invalidBlockers = fixture({ preflight: () => ({ ok: false, blockers: [1] }) });
    expect(invalidBlockers.dispatcher.check("phone-1", "takeoff")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    const getterBlockers = fixture({ preflight: () => ({ ok: false, get blockers(): never { throw new Error("blockers"); } }) });
    expect(getterBlockers.dispatcher.check("phone-1", "takeoff")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    const malformedResult = fixture({ sendCommand: async () => 7 });
    await expect(malformedResult.dispatcher.dispatch("phone-1", "takeoff")).resolves.toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    const hostileResult = fixture({ sendCommand: async () => new Proxy({}, { get() { throw new Error("result"); } }) });
    await expect(hostileResult.dispatcher.dispatch("phone-1", "takeoff")).resolves.toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    expect(hostileResult.dispatcher.isBusy(" ")).toBe(false);
  });

  it("contains every transport and capability-reading boundary before it can send", async () => {
    const telemetryFault = fixture({ latestTelemetry: () => { throw new Error("telemetry"); } });
    expect(telemetryFault.dispatcher.check("phone-1", "takeoff")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    const nonArrayBlockers = fixture({ preflight: () => ({ ok: false, blockers: null }) });
    expect(nonArrayBlockers.dispatcher.check("phone-1", "takeoff")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    const proxyArray = new Proxy([{ code: "BATTERY_LOW", message: "low" }], { get(_target, property) { if (property === "map") throw new Error("map"); return Reflect.get(_target, property); } });
    const mappedFailure = fixture({ preflight: () => ({ ok: false, blockers: proxyArray }) });
    expect(mappedFailure.dispatcher.check("phone-1", "takeoff")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    const unknownStatus = fixture({ sendCommand: async () => ({ status: 4 }) });
    await expect(unknownStatus.dispatcher.dispatch("phone-1", "takeoff")).resolves.toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
  });

  it("rechecks at dispatch time and preserves blocked results with no optional fields", async () => {
    const value = fixture({ preflight: () => ({ ok: false, blockers: [{ code: "SDK_NOT_READY", message: "SDK" }] }) });
    await expect(value.dispatcher.dispatch("phone-1", "takeoff")).resolves.toMatchObject({ ok: false, code: "PREFLIGHT_BLOCKED", blockers: [{ code: "SDK_NOT_READY" }] });
    const noExtras = fixture({ preflight: () => ({ ok: false, blockers: [] }) });
    await expect(noExtras.dispatcher.dispatch("phone-1", "takeoff")).resolves.toMatchObject({ ok: false, code: "PREFLIGHT_BLOCKED", blockers: [] });
    const nonRecordPayload = fixture({ latestTelemetry: () => ({ payload: 1, capabilities: null }) });
    expect(nonRecordPayload.dispatcher.check("phone-1", "takeoff")).toMatchObject({ ok: true });
    const throwStatus = fixture({ sendCommand: async () => ({ get status(): never { throw new Error("status"); } }) });
    await expect(throwStatus.dispatcher.dispatch("phone-1", "takeoff")).resolves.toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    await expect(throwStatus.dispatcher.dispatch(1 as never, "takeoff")).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT", deviceId: "invalid" });
  });

  it("passes the exact takeoff action to the MSDK-invocation preflight seam", async () => {
    const inputs: unknown[] = [];
    const value = fixture({
      preflight: (input) => { inputs.push(input); return { ok: true, blockers: [] }; },
    });
    await expect(value.dispatcher.dispatch("phone-1", "takeoff")).resolves.toMatchObject({ ok: true, action: "takeoff" });
    expect(inputs[0]).toMatchObject({ relayConnected: true, action: "takeoff", payload: { sdkRegistered: true }, capabilities: { directFlight: true } });
    expect(inputs).toHaveLength(1);
    expect(value.dispatcher.isBusy("phone-1")).toBe(false);
  });
});
