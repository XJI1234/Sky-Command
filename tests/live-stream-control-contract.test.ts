import { describe, expect, it } from "vitest";
import { LiveStreamControl } from "../src/modules/live-stream-control/index.js";

describe("LiveStreamControl", () => {
  it("only composes the public RTMP configuration and dispatcher seams", async () => {
    const sent: unknown[] = [];
    const control = LiveStreamControl.create({
      media: { snapshot: () => ({ phase: "running", endpoint: { host: "192.168.1.20", port: 1935 } }) },
      relay: { latestTelemetry: () => ({ payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true }, capabilities: { liveVideo: true } }), sendCommand: async (_deviceId, request) => { sent.push(request); return { status: "succeeded" }; } },
      capabilityGate: { evaluate: () => ({ ok: true, value: { enabled: true, reason: null } }) }
    });
    await expect(control.start("phone-1")).resolves.toMatchObject({ ok: true, state: { phase: "streaming" } });
    expect(sent).toEqual([{ name: "live-stream.start", fields: { rtmpUrl: "rtmp://192.168.1.20:1935/live/phone-1" } }]);
  });
});
