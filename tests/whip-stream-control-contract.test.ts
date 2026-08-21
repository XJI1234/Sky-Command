import { describe, expect, it } from "vitest";
import { WhipStreamControl } from "../src/modules/whip-stream-control/index.js";

const telemetry = () => ({
  payload: {
    sdkRegistered: true,
    remoteControllerConnected: true,
    flightControllerConnected: true,
    connected: true,
  },
  capabilities: { liveVideo: true },
});

const media = (fixedTarget?: unknown, phase: string = "running") => ({
  snapshot: () => ({ phase }),
  publishTarget: (deviceId: unknown) => fixedTarget ?? {
    ok: true,
    value: { kind: "whip", deviceId, url: `http://192.168.1.20:8889/live/${encodeURIComponent(String(deviceId))}/whip` },
  },
});

const gate = () => ({ evaluate: () => ({ ok: true, value: { enabled: true, reason: null } }) });

describe("WhipStreamControl", () => {
  it("sends the exact WHIP start fields and records the confirmed state", async () => {
    const sent: unknown[] = [];
    const control = WhipStreamControl.create({
      media: media(),
      relay: {
        latestTelemetry: () => telemetry(),
        sendCommand: async (_deviceId, request) => { sent.push(request); return { status: "succeeded" }; },
      },
      capabilityGate: gate(),
    });

    await expect(control.start("phone-1")).resolves.toMatchObject({ ok: true, operation: "start", state: { phase: "streaming" } });
    expect(sent).toEqual([{ name: "live-stream-webrtc.start", fields: { whipUrl: "http://192.168.1.20:8889/live/phone-1/whip" } }]);
  });

  it("keeps the legacy command absent and rejects an unavailable WHIP target", async () => {
    const sent: unknown[] = [];
    const control = WhipStreamControl.create({
      media: media({ ok: false, code: "NOT_RUNNING" }, "idle"),
      relay: { latestTelemetry: () => telemetry(), sendCommand: async (_id, request) => { sent.push(request); return { status: "succeeded" }; } },
      capabilityGate: gate(),
    });

    await expect(control.start("phone-1")).resolves.toMatchObject({ ok: false, code: "WEBRTC_MEDIA_UNAVAILABLE" });
    expect(sent).toEqual([]);
  });

  it("sends an empty WHIP stop and isolates devices", async () => {
    const sent: unknown[] = [];
    const control = WhipStreamControl.create({
      media: media(),
      relay: { latestTelemetry: () => telemetry(), sendCommand: async (id, request) => { sent.push({ id, request }); return { status: "succeeded" }; } },
      capabilityGate: gate(),
    });

    await expect(control.start("phone-1")).resolves.toMatchObject({ ok: true });
    await expect(control.start("phone-2")).resolves.toMatchObject({ ok: true });
    await expect(control.stop("phone-1")).resolves.toMatchObject({ ok: true, operation: "stop", state: { deviceId: "phone-1", phase: "idle" } });
    expect(sent).toEqual([
      { id: "phone-1", request: { name: "live-stream-webrtc.start", fields: { whipUrl: "http://192.168.1.20:8889/live/phone-1/whip" } } },
      { id: "phone-2", request: { name: "live-stream-webrtc.start", fields: { whipUrl: "http://192.168.1.20:8889/live/phone-2/whip" } } },
      { id: "phone-1", request: { name: "live-stream-webrtc.stop", fields: {} } },
    ]);
    expect(control.list().map((item) => item.deviceId)).toEqual(["phone-1", "phone-2"]);
  });

  it("turns capability, relay and disconnect facts into stable failures", async () => {
    const gateBlocked = WhipStreamControl.create({
      media: media(),
      relay: { latestTelemetry: () => telemetry(), sendCommand: async () => ({ status: "succeeded" }) },
      capabilityGate: { evaluate: () => ({ ok: true, value: { enabled: false, reason: "LIVE_VIDEO_UNSUPPORTED" } }) },
    });
    await expect(gateBlocked.start("phone-1")).resolves.toMatchObject({ ok: false, code: "CAPABILITY_BLOCKED", reason: "LIVE_VIDEO_UNSUPPORTED" });

    const rejected = WhipStreamControl.create({
      media: media(),
      relay: { latestTelemetry: () => telemetry(), sendCommand: async () => ({ status: "rejected" }) },
      capabilityGate: gate(),
    });
    await expect(rejected.start("phone-1")).resolves.toMatchObject({ ok: false, code: "RELAY_REJECTED", state: { phase: "failed" } });
    expect(rejected.recordDisconnected("phone-1")?.phase).toBe("disconnected");
  });
});
