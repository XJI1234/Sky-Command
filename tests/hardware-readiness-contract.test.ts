import { describe, expect, it } from "vitest";
import { HardwareReadiness, type HardwareReadinessInput } from "../src/modules/hardware-readiness/index.js";

const ready = (): HardwareReadinessInput => ({
  desktop: { lanAddressAvailable: true, legacyMediaAvailable: true },
  relayConnected: true,
  payload: {
    sdkRegistered: true,
    remoteControllerConnected: true,
    flightControllerConnected: true,
  },
});

describe("hardware readiness contract", () => {
  it("does not accept an elapsed-session proxy as an MSDK hardware fact", () => {
    expect(HardwareReadiness.evaluate(ready(), "legacy-video")).toEqual({ ok: true, blockers: [] });
  });

  it("allows legacy video with MSDK ready even when controller and flight telemetry are unavailable", () => {
    const result = HardwareReadiness.evaluate(ready(), "legacy-video");

    expect(result).toEqual({ ok: true, blockers: [] });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.blockers)).toBe(true);
    expect(HardwareReadiness.evaluate({
      ...ready(),
      payload: { ...ready().payload, remoteControllerConnected: false, flightControllerConnected: false, connected: false },
    }, "legacy-video")).toEqual({ ok: true, blockers: [] });
  });

  it("reports every independent legacy-video risk in its stable priority order", () => {
    const result = HardwareReadiness.evaluate({
      desktop: { lanAddressAvailable: false, legacyMediaAvailable: false },
      relayConnected: false,
      payload: {
        sdkRegistered: false,
        remoteControllerConnected: false,
        flightControllerConnected: false,
      },
    }, "legacy-video");

    expect(result).toMatchObject({ ok: false });
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      "DESKTOP_NETWORK_UNAVAILABLE",
      "LEGACY_MEDIA_UNAVAILABLE",
      "PHONE_DISCONNECTED",
      "SDK_NOT_READY",
    ]);
    expect(result.blockers.every((blocker) => blocker.message.length > 0 && Object.isFrozen(blocker))).toBe(true);
  });

  it("requires the fly-controller fact for flight-control readiness", () => {
    const result = HardwareReadiness.evaluate({
      ...ready(),
      payload: { ...ready().payload, flightControllerConnected: false },
    }, "flight-control");
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      "FLIGHT_CONTROLLER_DISCONNECTED",
    ]);
  });

  it("keeps desktop legacy-media requirements out of flight-control readiness", () => {
    const result = HardwareReadiness.evaluate({
      ...ready(),
      desktop: { lanAddressAvailable: false, legacyMediaAvailable: false },
    }, "flight-control");

    expect(result).toEqual({ ok: true, blockers: [] });
  });

  it("ignores the retained ProductKey compatibility field for flight-control readiness", () => {
    expect(HardwareReadiness.evaluate({
      ...ready(),
      payload: { ...ready().payload, connected: false },
    }, "flight-control")).toEqual({ ok: true, blockers: [] });
  });

  it("uses raw MSDK states when compatibility booleans disagree", () => {
    expect(HardwareReadiness.evaluate({ ...ready(), payload: { ...ready().payload, sdkAvailability: "STARTING", sdkRegistered: true } as never }, "legacy-video")).toEqual({ ok: false, blockers: [{ code: "SDK_NOT_READY", message: "手机端 DJI 尚未就绪，请在手机上确认已启动。" }] });
    expect(HardwareReadiness.evaluate({ ...ready(), payload: { ...ready().payload, sdkAvailability: "READY", remoteController: "CONNECTED", flightController: "DISCONNECTED", remoteControllerConnected: true, flightControllerConnected: true } as never }, "flight-control")).toEqual({ ok: false, blockers: [{ code: "FLIGHT_CONTROLLER_DISCONNECTED", message: "飞机飞控未连接，请确认飞机已开机。" }] });
  });
});
