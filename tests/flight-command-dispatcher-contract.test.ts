import { describe, expect, it } from "vitest";
import { FlightCommandDispatcher } from "../src/modules/flight-control/flight-command-dispatcher/index.js";

const telemetry = () => ({
  deviceId: "phone-1",
  payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true, isFlying: false, motorsOn: false, batteryPercent: 90 },
  capabilities: { directFlight: true }
});

function fixture(overrides: Partial<{
  readonly preflight: (input: unknown) => unknown;
  readonly gate: (input: unknown) => unknown;
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
    capabilityGate: { evaluate: overrides.gate ?? (() => ({ ok: true, value: { operation: "direct-flight", enabled: true, reason: null } })) }
  });
  return { dispatcher, sent };
}

describe("FlightCommandDispatcher", () => {
  it.each([
    ["takeoff", "flight.takeoff"],
    ["land", "flight.land"],
    ["return-home", "flight.return-home"]
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

  it("uses the capability gate only after preflight and refuses unavailable direct flight", async () => {
    const order: string[] = [];
    const value = fixture({
      preflight: () => { order.push("preflight"); return { ok: true, blockers: [] }; },
      gate: () => { order.push("gate"); return { ok: true, value: { operation: "direct-flight", enabled: false, reason: "DIRECT_FLIGHT_UNSUPPORTED" } }; }
    });
    await expect(value.dispatcher.dispatch("phone-1", "takeoff")).resolves.toMatchObject({ ok: false, code: "CAPABILITY_BLOCKED", reason: "DIRECT_FLIGHT_UNSUPPORTED" });
    expect(order).toEqual(["preflight", "gate"]);
    expect(value.sent).toEqual([]);
  });

  it("contains absent telemetry, dependency failures and malformed dependency results", async () => {
    const missing = fixture({ latestTelemetry: () => null, preflight: (input) => (input as { readonly relayConnected: boolean }).relayConnected ? { ok: true, blockers: [] } : { ok: false, blockers: [{ code: "RELAY_DISCONNECTED", message: "offline" }] } });
    expect(missing.dispatcher.check("phone-1", "takeoff")).toMatchObject({ ok: false, code: "PREFLIGHT_BLOCKED" });
    const failed = fixture({ preflight: () => { throw new Error("fault"); } });
    expect(failed.dispatcher.check("phone-1", "takeoff")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    const malformed = fixture({ gate: () => 7 });
    expect(malformed.dispatcher.check("phone-1", "takeoff")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    const rejected = fixture({ sendCommand: async () => ({ status: "rejected", detail: "unavailable" }) });
    await expect(rejected.dispatcher.dispatch("phone-1", "takeoff")).resolves.toMatchObject({ ok: false, code: "RELAY_REJECTED" });
    const throwing = fixture({ sendCommand: async () => { throw new Error("transport"); } });
    await expect(throwing.dispatcher.dispatch("phone-1", "takeoff")).resolves.toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
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
    const missingReason = fixture({ gate: () => ({ ok: true, value: { enabled: false } }) });
    expect(missingReason.dispatcher.check("phone-1", "takeoff")).toMatchObject({ ok: false, code: "CAPABILITY_BLOCKED", reason: "CAPABILITY_UNKNOWN" });
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
    const gateThrow = fixture({ gate: () => { throw new Error("gate"); } });
    expect(gateThrow.dispatcher.check("phone-1", "takeoff")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    const gateMalformed = fixture({ gate: () => ({ ok: true, value: 1 }) });
    expect(gateMalformed.dispatcher.check("phone-1", "takeoff")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    const capabilityBlocked = fixture({ gate: () => ({ ok: true, value: { enabled: false, reason: null } }) });
    await expect(capabilityBlocked.dispatcher.dispatch("phone-1", "takeoff")).resolves.toMatchObject({ ok: false, code: "CAPABILITY_BLOCKED", reason: "CAPABILITY_UNKNOWN" });
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

  it("passes the exact action and link facts into both safety seams", async () => {
    const inputs: unknown[] = [];
    const value = fixture({
      preflight: (input) => { inputs.push(input); return { ok: true, blockers: [] }; },
      gate: (input) => { inputs.push(input); return { ok: true, value: { enabled: true } }; }
    });
    await expect(value.dispatcher.dispatch("phone-1", "return-home")).resolves.toMatchObject({ ok: true, action: "return-home" });
    expect(inputs[0]).toMatchObject({ relayConnected: true, action: "return-home", payload: { sdkRegistered: true }, capabilities: { directFlight: true } });
    expect(inputs[1]).toMatchObject({ operation: "direct-flight", relayConnected: true, sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true });
    expect(inputs[1]).not.toHaveProperty("aircraftConnected");
    expect(value.dispatcher.isBusy("phone-1")).toBe(false);
  });
});
