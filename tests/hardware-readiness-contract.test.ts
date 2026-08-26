import { describe, expect, it } from "vitest";
import { HardwareReadiness, type HardwareReadinessInput } from "../src/modules/hardware-readiness/index.js";

const ready = (): HardwareReadinessInput => ({
  desktop: { lanAddressAvailable: true, legacyMediaAvailable: true },
  relayConnected: true,
  relayStable: true,
  payload: {
    sdkRegistered: true,
    remoteControllerConnected: true,
    flightControllerConnected: true,
    connected: true,
  },
});

describe("hardware readiness contract", () => {
  it("allows legacy video when phone/SDK/remote are ready even if aircraft telemetry is down", () => {
    const result = HardwareReadiness.evaluate(ready(), "legacy-video");

    expect(result).toEqual({ ok: true, blockers: [] });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.blockers)).toBe(true);
    expect(HardwareReadiness.evaluate({
      ...ready(),
      payload: { ...ready().payload, flightControllerConnected: false, connected: false },
    }, "legacy-video")).toEqual({ ok: true, blockers: [] });
  });

  it("reports every independent legacy-video risk in its stable priority order", () => {
    const result = HardwareReadiness.evaluate({
      desktop: { lanAddressAvailable: false, legacyMediaAvailable: false },
      relayConnected: false,
      relayStable: false,
      payload: {
        sdkRegistered: false,
        remoteControllerConnected: false,
        flightControllerConnected: false,
        connected: false,
      },
    }, "legacy-video");

    expect(result).toMatchObject({ ok: false });
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      "DESKTOP_NETWORK_UNAVAILABLE",
      "LEGACY_MEDIA_UNAVAILABLE",
      "PHONE_DISCONNECTED",
      "PHONE_SESSION_UNSTABLE",
      "SDK_NOT_READY",
      "REMOTE_CONTROLLER_DISCONNECTED",
    ]);
    expect(result.blockers.every((blocker) => blocker.message.length > 0 && Object.isFrozen(blocker))).toBe(true);
  });

  it("still requires aircraft facts for flight-control readiness", () => {
    const result = HardwareReadiness.evaluate({
      ...ready(),
      payload: { ...ready().payload, flightControllerConnected: false, connected: false },
    }, "flight-control");
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      "FLIGHT_CONTROLLER_DISCONNECTED",
      "AIRCRAFT_DISCONNECTED",
    ]);
  });

  it("keeps desktop legacy-media requirements out of flight-control readiness", () => {
    const result = HardwareReadiness.evaluate({
      ...ready(),
      desktop: { lanAddressAvailable: false, legacyMediaAvailable: false },
    }, "flight-control");

    expect(result).toEqual({ ok: true, blockers: [] });
  });
});
