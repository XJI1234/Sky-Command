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

  it("reports only desktop media risks for legacy video; relay and MSDK reachability belong to the stream dispatcher", () => {
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
    ]);
    expect(result.blockers.every((blocker) => blocker.message.length > 0 && Object.isFrozen(blocker))).toBe(true);
  });

  it("treats flight-control readiness as the MSDK invocation boundary, not a device-safety decision", () => {
    const result = HardwareReadiness.evaluate({
      ...ready(),
      payload: { ...ready().payload, remoteControllerConnected: false, flightControllerConnected: false },
    }, "flight-control");
    expect(result).toEqual({ ok: true, blockers: [] });
  });

  it("does not read unrelated controller observations while checking the direct-flight invocation boundary", () => {
    const payload = Object.defineProperties({ sdkAvailability: "READY" }, {
      remoteController: { get: () => { throw new Error("unrelated remote-controller observation"); } },
      flightController: { get: () => { throw new Error("unrelated flight-controller observation"); } },
    });

    expect(HardwareReadiness.evaluate({
      desktop: { lanAddressAvailable: true, legacyMediaAvailable: true },
      relayConnected: true,
      payload,
    } as never, "flight-control")).toEqual({ ok: true, blockers: [] });
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

  it("uses raw MSDK lifecycle for flight control while legacy video stays desktop-only", () => {
    expect(HardwareReadiness.evaluate({ ...ready(), payload: { ...ready().payload, sdkAvailability: "STARTING", sdkRegistered: true } as never }, "legacy-video")).toEqual({ ok: true, blockers: [] });
    expect(HardwareReadiness.evaluate({ ...ready(), payload: { ...ready().payload, sdkAvailability: "STARTING", sdkRegistered: true } as never }, "flight-control")).toEqual({ ok: false, blockers: [{ code: "SDK_NOT_READY", message: "手机端 DJI 尚未就绪，请在手机上确认已启动。" }] });
    expect(HardwareReadiness.evaluate({ ...ready(), payload: { ...ready().payload, sdkAvailability: "READY", remoteController: "DISCONNECTED", flightController: "UNKNOWN", remoteControllerConnected: true, flightControllerConnected: true } as never }, "flight-control")).toEqual({ ok: true, blockers: [] });
  });
});
