import { describe, expect, it } from "vitest";
import { PreflightCheck, type FlightActionPreflightInput, type PreflightInput } from "../src/modules/mission-control/preflight-check/index.js";

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
  it("accepts an uploaded mission when the relay and MSDK are reachable", () => {
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

  it("uses raw MSDK lifecycle for mission reachability without treating link states as DJI safety decisions", () => {
    const rawNotReady = withInput({ payload: { sdkAvailability: "STARTING", sdkRegistered: true } as never });
    expect(PreflightCheck.evaluate(rawNotReady).blockers.map((blocker) => blocker.code)).toContain("SDK_NOT_READY");

    const rawFlightDisconnected = withInput({ payload: { sdkAvailability: "READY", remoteController: "DISCONNECTED", flightController: "UNKNOWN", sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true } as never });
    expect(PreflightCheck.evaluate(rawFlightDisconnected)).toEqual({ ok: true, blockers: [] });

    const flightAction = (payload: Record<string, unknown>) => PreflightCheck.evaluateFlightAction({
      relayConnected: true,
      payload: { sdkAvailability: "READY", remoteController: "CONNECTED", flightController: "CONNECTED", isFlying: false, motorsOn: false, batteryPercent: 80, ...payload } as never,
      capabilities: {},
      action: "takeoff",
    });
    expect(flightAction({ sdkAvailability: "BROKEN" }).blockers.map((blocker) => blocker.code)).toContain("SDK_NOT_READY");
    expect(flightAction({ remoteController: "BROKEN" })).toEqual({ ok: true, blockers: [] });
    expect(flightAction({ flightController: "BROKEN" })).toEqual({ ok: true, blockers: [] });
  });

  it("reports only command reachability and mission identity blockers for a wayline start", () => {
    const cases: readonly [PreflightInput, string][] = [
      [withInput({ relayConnected: false }), "RELAY_DISCONNECTED"],
      [withInput({ payload: { sdkRegistered: false } }), "SDK_NOT_READY"],
      [withInput({ missionPhase: "staged" }), "MISSION_NOT_UPLOADED"],
    ];

    for (const [input, code] of cases) {
      const result = PreflightCheck.evaluate(input);
      expect(result.ok).toBe(false);
      expect(result.blockers.map((blocker) => blocker.code)).toContain(code);
      expect(result.blockers.every((blocker) => blocker.message.length > 0)).toBe(true);
    }
  });

  it("does not use local device facts to pre-judge a DJI wayline action", () => {
    const allDeviceFactsUnfavorable = withInput({
      payload: {
        sdkAvailability: "READY",
        remoteController: "DISCONNECTED",
        flightController: "UNKNOWN",
        batteryPercent: 1,
        isFlying: true,
        motorsOn: true,
      } as never,
      capabilities: { waypointMission: false, waypointMissionSupport: "unsupported" },
    });

    expect(PreflightCheck.evaluate(allDeviceFactsUnfavorable)).toEqual({ ok: true, blockers: [] });
    expect(PreflightCheck.evaluateUpload({ ...allDeviceFactsUnfavorable, missionPhase: "staged" })).toEqual({ ok: true, blockers: [] });
  });

  it("does not require an unrelated capability snapshot to reach a ready MSDK", () => {
    const withoutCapabilities = { ...ready(), capabilities: null } as never;

    expect(PreflightCheck.evaluate(withoutCapabilities)).toEqual({ ok: true, blockers: [] });
    expect(PreflightCheck.evaluateUpload({ ...withoutCapabilities, missionPhase: "staged" })).toEqual({ ok: true, blockers: [] });
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
      "MISSION_NOT_UPLOADED",
    ]);
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
    PreflightCheck.evaluate(input);
    expect(input.payload.batteryPercent).toBe(originalBattery);
  });

  it.each(["takeoff", "land", "confirm-landing", "return-home", "stop-takeoff", "stop-auto-landing"] as const)("allows %s through a ready MSDK despite unfavorable or unavailable local device facts", (action) => {
    const input: FlightActionPreflightInput = {
      relayConnected: true,
      payload: {
        sdkAvailability: "READY",
        remoteController: "DISCONNECTED",
        flightController: "UNKNOWN",
        isFlying: true,
        motorsOn: true,
        batteryPercent: 1,
      },
      capabilities: {},
      action,
    };
    expect(PreflightCheck.evaluateFlightAction(input)).toEqual({ ok: true, blockers: [] });
  });

  it("only checks MSDK reachability before upload and leaves hardware acceptance to DJI", () => {
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
    expect(PreflightCheck.evaluateUpload({ ...input, payload: { ...input.payload, remoteControllerConnected: false, flightControllerConnected: false } })).toEqual({ ok: true, blockers: [] });
  });

  it("上传预检拒绝无效输入和不可达 MSDK，但不报告设备安全事实", () => {
    expect(PreflightCheck.evaluateUpload({} as never)).toMatchObject({
      ok: false,
      blockers: [{ code: "INVALID_INPUT" }],
    });
    expect(PreflightCheck.evaluateUpload({
      ...ready(),
      relayConnected: false,
      payload: { ...ready().payload, sdkRegistered: false, remoteControllerConnected: false, flightControllerConnected: true },
      capabilities: { waypointMission: true, waypointMissionSupport: "unsupported" },
    })).toMatchObject({
      ok: false,
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: "RELAY_DISCONNECTED" }),
        expect.objectContaining({ code: "SDK_NOT_READY" }),
      ]),
    });
  });

  it("rejects malformed direct-flight actions but ignores an unused local battery policy", () => {
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
  });

  it("reports only command delivery blockers before direct flight", () => {
    const result = PreflightCheck.evaluateFlightAction({
      relayConnected: false,
      payload: { sdkRegistered: false, remoteControllerConnected: false, flightControllerConnected: false, isFlying: false, motorsOn: false, batteryPercent: 80 },
      capabilities: {},
      action: "takeoff",
    });
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      "RELAY_DISCONNECTED",
      "SDK_NOT_READY",
    ]);
  });

  it("does not let missing or unfavorable local takeoff telemetry pre-judge DJI", () => {
    const action: FlightActionPreflightInput = {
      relayConnected: true,
      payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, isFlying: false, motorsOn: false, batteryPercent: 80 },
      capabilities: {},
      action: "takeoff",
    };
    expect(PreflightCheck.evaluateFlightAction({ ...action, payload: { ...action.payload, batteryPercent: undefined } })).toEqual({ ok: true, blockers: [] });
    expect(PreflightCheck.evaluateFlightAction({ ...action, payload: { ...action.payload, isFlying: undefined } })).toEqual({ ok: true, blockers: [] });
    expect(PreflightCheck.evaluateFlightAction({ ...action, payload: { ...action.payload, motorsOn: undefined } })).toEqual({ ok: true, blockers: [] });
  });

  it("does not read unrelated device observations while checking whether a command can enter MSDK", () => {
    const payload = Object.defineProperties({ sdkAvailability: "READY" }, {
      remoteController: { get: () => { throw new Error("unrelated remote controller observation"); } },
      flightController: { get: () => { throw new Error("unrelated flight controller observation"); } },
      batteryPercent: { get: () => { throw new Error("unrelated battery observation"); } },
    });
    const input = {
      relayConnected: true,
      payload,
      get capabilities(): never { throw new Error("unrelated capability observation"); },
      missionPhase: "uploaded",
    } as never;

    expect(PreflightCheck.evaluate(input)).toEqual({ ok: true, blockers: [] });
    expect(PreflightCheck.evaluateUpload(input)).toEqual({ ok: true, blockers: [] });
    expect(PreflightCheck.evaluateFlightAction({
      relayConnected: true,
      payload,
      get capabilities(): never { throw new Error("unrelated capability observation"); },
      action: "takeoff",
    } as never)).toEqual({ ok: true, blockers: [] });
  });

  it.each(["land", "confirm-landing", "return-home", "stop-takeoff", "stop-auto-landing"] as const)("allows recovery action %s through a ready MSDK despite stale or unavailable control telemetry", (action) => {
    const input: FlightActionPreflightInput = {
      relayConnected: true,
      payload: {
        sdkAvailability: "READY",
        remoteController: "DISCONNECTED",
        flightController: "UNKNOWN",
        isFlying: undefined,
        motorsOn: undefined,
        batteryPercent: undefined,
        flightMode: "GPS_NORMAL",
        landingConfirmationNeeded: false,
      },
      capabilities: {},
      action,
    };
    expect(PreflightCheck.evaluateFlightAction(input)).toEqual({ ok: true, blockers: [] });
  });

  it("keeps recovery actions blocked when the MSDK invocation boundary is unavailable", () => {
    const input: FlightActionPreflightInput = {
      relayConnected: true,
      payload: { sdkAvailability: "STARTING", remoteController: "CONNECTED", flightController: "CONNECTED", isFlying: true, landingConfirmationNeeded: true },
      capabilities: {},
      action: "confirm-landing" as never,
    };
    expect(PreflightCheck.evaluateFlightAction(input)).toMatchObject({
      ok: false,
      blockers: [{ code: "SDK_NOT_READY" }],
    });
  });
});
