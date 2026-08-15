import { describe, expect, it } from "vitest";
import { PreflightCheck, type FlightActionPreflightInput, type PreflightInput, type PreflightPolicy } from "../src/modules/mission-control/preflight-check/index.js";

const ready = (): PreflightInput => ({
  relayConnected: true,
  payload: {
    sdkRegistered: true,
    remoteControllerConnected: true,
    flightControllerConnected: true,
    connected: true,
    isFlying: false,
    motorsOn: false,
    batteryPercent: 80
  },
  capabilities: { waypointMission: true, waypointMissionSupport: "supported" },
  missionPhase: "uploaded"
});

const withInput = (change: Partial<PreflightInput> & { payload?: Partial<PreflightInput["payload"]>; capabilities?: Partial<PreflightInput["capabilities"]> }): PreflightInput => {
  const base = ready();
  return {
    ...base,
    ...change,
    payload: { ...base.payload, ...change.payload },
    capabilities: { ...base.capabilities, ...change.capabilities }
  };
};

describe("preflight check contract", () => {
  it("accepts an uploaded mission only when every required link and safety signal is ready", () => {
    const result = PreflightCheck.evaluate(ready());
    expect(result).toEqual({ ok: true, blockers: [] });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.blockers)).toBe(true);
  });

  it("reports every independent blocker with a stable displayable code", () => {
    const cases: readonly [PreflightInput, string][] = [
      [withInput({ relayConnected: false }), "RELAY_DISCONNECTED"],
      [withInput({ payload: { sdkRegistered: false } }), "SDK_NOT_READY"],
      [withInput({ payload: { remoteControllerConnected: false } }), "REMOTE_CONTROLLER_DISCONNECTED"],
      [withInput({ payload: { flightControllerConnected: false } }), "AIRCRAFT_DISCONNECTED"],
      [withInput({ payload: { connected: false } }), "AIRCRAFT_DISCONNECTED"],
      [withInput({ capabilities: { waypointMission: false } }), "WAYPOINT_UNSUPPORTED"],
      [withInput({ capabilities: { waypointMissionSupport: "unsupported" } }), "WAYPOINT_UNSUPPORTED"],
      [withInput({ missionPhase: "staged" }), "MISSION_NOT_UPLOADED"],
      [withInput({ payload: { batteryPercent: undefined } }), "BATTERY_UNKNOWN"],
      [withInput({ payload: { batteryPercent: 19 } }), "BATTERY_LOW"],
      [withInput({ payload: { isFlying: undefined } }), "FLIGHT_STATE_UNKNOWN"],
      [withInput({ payload: { isFlying: true } }), "AIRCRAFT_ALREADY_FLYING"],
      [withInput({ payload: { motorsOn: undefined } }), "MOTOR_STATE_UNKNOWN"],
      [withInput({ payload: { motorsOn: true } }), "MOTORS_RUNNING"]
    ];

    for (const [input, code] of cases) {
      const result = PreflightCheck.evaluate(input);
      expect(result.ok).toBe(false);
      expect(result.blockers.map((blocker) => blocker.code)).toContain(code);
      expect(result.blockers.every((blocker) => blocker.message.length > 0)).toBe(true);
    }
  });

  it("keeps combined blockers ordered and never duplicates a reason", () => {
    const result = PreflightCheck.evaluate(withInput({
      relayConnected: false,
      payload: { sdkRegistered: false, remoteControllerConnected: false, flightControllerConnected: false, connected: false, batteryPercent: 10, isFlying: true, motorsOn: true },
      capabilities: { waypointMission: false, waypointMissionSupport: "unsupported" },
      missionPhase: "staged"
    }));
    expect(result).toMatchObject({ ok: false });
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      "RELAY_DISCONNECTED",
      "SDK_NOT_READY",
      "REMOTE_CONTROLLER_DISCONNECTED",
      "AIRCRAFT_DISCONNECTED",
      "WAYPOINT_UNSUPPORTED",
      "MISSION_NOT_UPLOADED",
      "BATTERY_LOW",
      "AIRCRAFT_ALREADY_FLYING",
      "MOTORS_RUNNING"
    ]);
  });

  it("keeps unknown battery distinct from a valid low battery and honors the configured boundary", () => {
    expect(PreflightCheck.evaluate(withInput({ payload: { batteryPercent: 20 } })).ok).toBe(true);
    expect(PreflightCheck.evaluate(withInput({ payload: { batteryPercent: 0 } })).blockers.map((blocker) => blocker.code)).toContain("BATTERY_LOW");
    expect(PreflightCheck.evaluate(withInput({ payload: { batteryPercent: 101 } })).blockers.map((blocker) => blocker.code)).toContain("BATTERY_UNKNOWN");
    expect(PreflightCheck.evaluate(withInput({ payload: { batteryPercent: 30 } }), { minimumBatteryPercent: 31 }).blockers.map((blocker) => blocker.code)).toContain("BATTERY_LOW");
  });

  it("returns an invalid-policy blocker without trusting malformed policy values", () => {
    const invalid: readonly PreflightPolicy[] = [{ minimumBatteryPercent: 0 }, { minimumBatteryPercent: 101 }, { minimumBatteryPercent: 20.5 }];
    for (const policy of invalid) {
      const result = PreflightCheck.evaluate(ready(), policy);
      expect(result).toMatchObject({ ok: false, blockers: [{ code: "INVALID_POLICY" }] });
    }
    expect(PreflightCheck.evaluate(ready(), null as never)).toMatchObject({ ok: false, blockers: [{ code: "INVALID_POLICY" }] });
  });

  it("contains malformed input and getter exceptions without changing caller objects", () => {
    const input = ready();
    const originalBattery = input.payload.batteryPercent;
    const malformed = { relayConnected: true, payload: null, capabilities: null, missionPhase: "uploaded" } as never;
    const throwing = {
      relayConnected: true,
      get payload(): never { throw new Error("untrusted getter"); },
      capabilities: {},
      missionPhase: "uploaded"
    } as never;

    expect(() => PreflightCheck.evaluate(malformed)).not.toThrow();
    expect(PreflightCheck.evaluate(malformed).ok).toBe(false);
    expect(() => PreflightCheck.evaluate(throwing)).not.toThrow();
    expect(PreflightCheck.evaluate(throwing).ok).toBe(false);
    const throwingPolicy = { get minimumBatteryPercent(): number { throw new Error("untrusted policy getter"); } } as never;
    expect(() => PreflightCheck.evaluate(ready(), throwingPolicy)).not.toThrow();
    expect(PreflightCheck.evaluate(ready(), throwingPolicy)).toMatchObject({ ok: false, blockers: [{ code: "INVALID_POLICY" }] });
    PreflightCheck.evaluate(input);
    expect(input.payload.batteryPercent).toBe(originalBattery);
  });

  it("evaluates direct flight actions without treating already-flying or motors-running as blockers", () => {
    const action: FlightActionPreflightInput = {
      relayConnected: true,
      payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true, isFlying: true, motorsOn: true, batteryPercent: 80 },
      capabilities: {},
      action: "land"
    };
    expect(PreflightCheck.evaluateFlightAction({ ...action, payload: { ...action.payload, isFlying: false, motorsOn: false } })).toEqual({ ok: true, blockers: [] });
    expect(PreflightCheck.evaluateFlightAction(action)).toEqual({ ok: true, blockers: [] });
    expect(PreflightCheck.evaluateFlightAction({ ...action, payload: { ...action.payload, batteryPercent: 10 } })).toMatchObject({ ok: false, blockers: [{ code: "BATTERY_LOW" }] });
  });
});
