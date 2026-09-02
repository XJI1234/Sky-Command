import { describe, expect, it } from "vitest";
import { PreflightCheck, type FlightActionPreflightInput, type PreflightInput, type PreflightPolicy } from "../src/modules/mission-control/preflight-check/index.js";

const ready = (): PreflightInput => ({
  relayConnected: true,
  payload: {
    sdkRegistered: true,
    remoteControllerConnected: true,
    flightControllerConnected: true,
    isFlying: false,
    motorsOn: false,
    batteryPercent: 80,
    pairingState: "PAIRED"
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

  it("ignores retained ProductKey compatibility telemetry in every flight precheck", () => {
    const productDisconnected = { ...ready(), payload: { ...ready().payload, connected: false } };
    expect(PreflightCheck.evaluate(productDisconnected)).toEqual({ ok: true, blockers: [] });
    expect(PreflightCheck.evaluateUpload({ ...productDisconnected, missionPhase: "staged" })).toEqual({ ok: true, blockers: [] });
    expect(PreflightCheck.evaluateFlightAction({
      relayConnected: true,
      payload: { ...productDisconnected.payload, isFlying: false, motorsOn: false, batteryPercent: 80 },
      capabilities: {},
      action: "takeoff",
    })).toEqual({ ok: true, blockers: [] });
  });

  it("uses raw MSDK lifecycle and link states instead of compatibility booleans", () => {
    const rawNotReady = withInput({ payload: { sdkAvailability: "STARTING", sdkRegistered: true } as never });
    expect(PreflightCheck.evaluate(rawNotReady).blockers.map((blocker) => blocker.code)).toContain("SDK_NOT_READY");

    const rawFlightDisconnected = withInput({ payload: { sdkAvailability: "READY", remoteController: "CONNECTED", flightController: "DISCONNECTED", sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true } as never });
    expect(PreflightCheck.evaluate(rawFlightDisconnected).blockers.map((blocker) => blocker.code)).toContain("AIRCRAFT_DISCONNECTED");

    const flightAction = (payload: Record<string, unknown>) => PreflightCheck.evaluateFlightAction({
      relayConnected: true,
      payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, isFlying: true, motorsOn: true, ...payload } as never,
      capabilities: {},
      action: "land",
    });
    expect(flightAction({ sdkAvailability: "BROKEN" }).blockers.map((blocker) => blocker.code)).toContain("SDK_NOT_READY");
    expect(flightAction({ remoteController: "BROKEN" }).blockers.map((blocker) => blocker.code)).toContain("REMOTE_CONTROLLER_DISCONNECTED");
    expect(flightAction({ flightController: "BROKEN" }).blockers.map((blocker) => blocker.code)).toContain("AIRCRAFT_DISCONNECTED");
  });

  it("reports every independent blocker with a stable displayable code", () => {
    const cases: readonly [PreflightInput, string][] = [
      [withInput({ relayConnected: false }), "RELAY_DISCONNECTED"],
      [withInput({ payload: { sdkRegistered: false } }), "SDK_NOT_READY"],
      [withInput({ payload: { remoteControllerConnected: false } }), "REMOTE_CONTROLLER_DISCONNECTED"],
      [withInput({ payload: { flightControllerConnected: false } }), "AIRCRAFT_DISCONNECTED"],
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

  it("fails closed when pairing or grounded-state telemetry is not an exact safe fact", () => {
    const invalidFlightStates: readonly [PreflightInput, string][] = [
      [withInput({ payload: { isFlying: null as never } }), "FLIGHT_STATE_UNKNOWN"],
      [withInput({ payload: { isFlying: "false" as never } }), "FLIGHT_STATE_UNKNOWN"],
      [withInput({ payload: { motorsOn: null as never } }), "MOTOR_STATE_UNKNOWN"],
      [withInput({ payload: { motorsOn: 0 as never } }), "MOTOR_STATE_UNKNOWN"],
    ];

    for (const [input, code] of invalidFlightStates) {
      expect(PreflightCheck.evaluate(input).blockers.map((blocker) => blocker.code)).toContain(code);
    }
  });

  it("does not treat pairing state as a waypoint mission start prerequisite", () => {
    expect(PreflightCheck.evaluate(withInput({ payload: { pairingState: "IDLE" } as never }))).toEqual({ ok: true, blockers: [] });
    expect(PreflightCheck.evaluate(withInput({ payload: { pairingState: undefined } as never }))).toEqual({ ok: true, blockers: [] });
  });

  it("keeps combined blockers ordered and never duplicates a reason", () => {
    const result = PreflightCheck.evaluate(withInput({
      relayConnected: false,
      payload: { sdkRegistered: false, remoteControllerConnected: false, flightControllerConnected: false, batteryPercent: 10, isFlying: true, motorsOn: true },
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

  it("uses action-specific conditions so only takeoff requires ground, battery and stopped motors", () => {
    const action: FlightActionPreflightInput = {
      relayConnected: true,
      payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, isFlying: true, motorsOn: true, batteryPercent: 80 },
      capabilities: {},
      action: "land"
    };
    const grounded = { ...action, payload: { ...action.payload, isFlying: false, motorsOn: false } };
    expect(PreflightCheck.evaluateFlightAction({ ...grounded, action: "takeoff" })).toEqual({ ok: true, blockers: [] });
    expect(PreflightCheck.evaluateFlightAction({ ...grounded, action: "takeoff", payload: { ...grounded.payload, motorsOn: true } })).toMatchObject({
      ok: false,
      blockers: [{ code: "MOTORS_RUNNING" }],
    });
    expect(PreflightCheck.evaluateFlightAction({ ...grounded, action: "takeoff", payload: { ...grounded.payload, batteryPercent: 19 } })).toMatchObject({
      ok: false,
      blockers: [{ code: "BATTERY_LOW" }],
    });
    expect(PreflightCheck.evaluateFlightAction({ ...grounded, action: "takeoff", payload: { ...grounded.payload, isFlying: true } })).toMatchObject({
      ok: false,
      blockers: [{ code: "AIRCRAFT_ALREADY_FLYING" }],
    });
    expect(PreflightCheck.evaluateFlightAction(action)).toEqual({ ok: true, blockers: [] });
    expect(PreflightCheck.evaluateFlightAction({ ...action, action: "return-home", payload: { ...action.payload, batteryPercent: 10 } })).toEqual({ ok: true, blockers: [] });
    expect(PreflightCheck.evaluateFlightAction({ ...action, action: "land", payload: { ...action.payload, batteryPercent: undefined, motorsOn: undefined } })).toEqual({ ok: true, blockers: [] });
    expect(PreflightCheck.evaluateFlightAction({ ...action, action: "return-home", payload: { ...action.payload, isFlying: undefined } })).toMatchObject({
      ok: false,
      blockers: [{ code: "FLIGHT_STATE_UNKNOWN" }],
    });
    expect(PreflightCheck.evaluateFlightAction({ ...grounded, action: "land" })).toMatchObject({
      ok: false,
      blockers: [{ code: "AIRCRAFT_ON_GROUND" }],
    });
  });

  it("checks upload hardware without applying launch-only telemetry constraints", () => {
    const input: PreflightInput = {
      relayConnected: true,
      payload: {
        sdkRegistered: true,
        remoteControllerConnected: true,
        flightControllerConnected: true,
        isFlying: true,
        motorsOn: true,
        batteryPercent: 5,
      },
      capabilities: { waypointMission: true, waypointMissionSupport: "supported" },
      missionPhase: "staged",
    };

    expect(PreflightCheck.evaluateUpload(input)).toEqual({ ok: true, blockers: [] });
    expect(PreflightCheck.evaluateUpload({ ...input, payload: { ...input.payload, remoteControllerConnected: false } })).toMatchObject({
      ok: false,
      blockers: [{ code: "REMOTE_CONTROLLER_DISCONNECTED" }],
    });
  });

  it("上传预检拒绝无效输入并分别报告每一项不可用硬件事实", () => {
    expect(PreflightCheck.evaluateUpload({} as never)).toMatchObject({
      ok: false,
      blockers: [{ code: "INVALID_INPUT" }],
    });
    expect(PreflightCheck.evaluateUpload({
      ...ready(),
      relayConnected: false,
      payload: {
        ...ready().payload,
        sdkRegistered: false,
        remoteControllerConnected: false,
        flightControllerConnected: true,
      },
      capabilities: { waypointMission: true, waypointMissionSupport: "unsupported" },
    })).toMatchObject({
      ok: false,
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: "RELAY_DISCONNECTED" }),
        expect.objectContaining({ code: "SDK_NOT_READY" }),
        expect.objectContaining({ code: "REMOTE_CONTROLLER_DISCONNECTED" }),
        expect.objectContaining({ code: "WAYPOINT_UNSUPPORTED" }),
      ]),
    });
  });

  it("fails closed for malformed direct-flight actions and policies", () => {
    const action: FlightActionPreflightInput = {
      relayConnected: true,
      payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, isFlying: false, motorsOn: false, batteryPercent: 80 },
      capabilities: {},
      action: "takeoff",
    };
    expect(PreflightCheck.evaluateFlightAction(null as never)).toEqual({ ok: false, blockers: [{ code: "INVALID_INPUT", message: "Device status could not be read." }] });
    expect(PreflightCheck.evaluateFlightAction({ ...action, action: "hover" as never })).toMatchObject({ ok: false, blockers: [{ code: "INVALID_INPUT" }] });
    const unreadableAction = Object.defineProperty({ ...action }, "action", { get: () => { throw new Error("action getter"); } });
    expect(() => PreflightCheck.evaluateFlightAction(unreadableAction as never)).not.toThrow();
    expect(PreflightCheck.evaluateFlightAction(unreadableAction as never)).toMatchObject({ ok: false, blockers: [{ code: "INVALID_INPUT" }] });
    expect(PreflightCheck.evaluateFlightAction(action, { minimumBatteryPercent: 0 } as never)).toMatchObject({ ok: false, blockers: [{ code: "INVALID_POLICY" }] });
  });

  it("reports every unavailable control link before direct flight", () => {
    const result = PreflightCheck.evaluateFlightAction({
      relayConnected: false,
      payload: { sdkRegistered: false, remoteControllerConnected: false, flightControllerConnected: false, isFlying: false, motorsOn: false, batteryPercent: 80 },
      capabilities: {},
      action: "takeoff",
    });
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      "RELAY_DISCONNECTED",
      "SDK_NOT_READY",
      "REMOTE_CONTROLLER_DISCONNECTED",
      "AIRCRAFT_DISCONNECTED",
    ]);
  });

  it("refuses takeoff when required telemetry is unknown", () => {
    const action: FlightActionPreflightInput = {
      relayConnected: true,
      payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, isFlying: false, motorsOn: false, batteryPercent: 80 },
      capabilities: {},
      action: "takeoff",
    };
    expect(PreflightCheck.evaluateFlightAction({ ...action, payload: { ...action.payload, batteryPercent: undefined } })).toMatchObject({ ok: false, blockers: [{ code: "BATTERY_UNKNOWN" }] });
    expect(PreflightCheck.evaluateFlightAction({ ...action, payload: { ...action.payload, isFlying: undefined } })).toMatchObject({ ok: false, blockers: [{ code: "FLIGHT_STATE_UNKNOWN" }] });
    expect(PreflightCheck.evaluateFlightAction({ ...action, payload: { ...action.payload, motorsOn: undefined } })).toMatchObject({ ok: false, blockers: [{ code: "MOTOR_STATE_UNKNOWN" }] });
  });

  it("allows each recovery action only while its matching DJI flight mode is observed", () => {
    const input: FlightActionPreflightInput = {
      relayConnected: true,
      payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, flightMode: "AUTO_TAKE_OFF" },
      capabilities: {},
      action: "stop-takeoff",
    };
    expect(PreflightCheck.evaluateFlightAction(input)).toEqual({ ok: true, blockers: [] });
    expect(PreflightCheck.evaluateFlightAction({ ...input, action: "stop-auto-landing", payload: { ...input.payload, flightMode: "AUTO_LANDING" } })).toEqual({ ok: true, blockers: [] });
    expect(PreflightCheck.evaluateFlightAction({ ...input, action: "stop-auto-landing", payload: { ...input.payload, flightMode: "CONFIRM_LANDING" } })).toEqual({ ok: true, blockers: [] });
    expect(PreflightCheck.evaluateFlightAction({ ...input, action: "stop-auto-landing", payload: { ...input.payload, flightMode: "GPS_NORMAL" } })).toMatchObject({
      ok: false,
      blockers: [{ code: "AUTO_LANDING_NOT_ACTIVE" }],
    });
    expect(PreflightCheck.evaluateFlightAction({ ...input, payload: { ...input.payload, flightMode: "GPS_NORMAL" } })).toMatchObject({ ok: false });
  });

  it("only permits confirmation to continue landing when MSDK explicitly requests it", () => {
    const input: FlightActionPreflightInput = {
      relayConnected: true,
      payload: { sdkAvailability: "READY", remoteController: "CONNECTED", flightController: "CONNECTED", isFlying: true, landingConfirmationNeeded: true },
      capabilities: {},
      action: "confirm-landing" as never,
    };
    expect(PreflightCheck.evaluateFlightAction(input)).toEqual({ ok: true, blockers: [] });
    expect(PreflightCheck.evaluateFlightAction({ ...input, payload: { ...input.payload, landingConfirmationNeeded: false } })).toMatchObject({
      ok: false,
      blockers: [{ code: "LANDING_CONFIRMATION_NOT_REQUIRED" }],
    });
    expect(PreflightCheck.evaluateFlightAction({ ...input, payload: { ...input.payload, isFlying: false } })).toMatchObject({
      ok: false,
      blockers: [{ code: "AIRCRAFT_ON_GROUND" }],
    });
  });

  it("拒绝在未知飞行状态下确认继续降落", () => {
    const result = PreflightCheck.evaluateFlightAction({
      relayConnected: true,
      payload: { sdkAvailability: "READY", remoteController: "CONNECTED", flightController: "CONNECTED", isFlying: "unknown", landingConfirmationNeeded: true } as never,
      capabilities: {},
      action: "confirm-landing",
    });
    expect(result.blockers.map((blocker) => blocker.code)).toContain("FLIGHT_STATE_UNKNOWN");
  });
});
