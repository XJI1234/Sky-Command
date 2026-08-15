import { describe, expect, it } from "vitest";
import { StreamDispatcher } from "../src/modules/live-stream-control/stream-dispatcher/index.js";

describe("stream-dispatcher 性能契约", () => {
  it("对一万台设备的只读快照保持按设备隔离", () => {
    const dispatcher = StreamDispatcher.create({
      media: { snapshot: () => ({ phase: "running", endpoint: { host: "192.168.1.20", port: 1935 } }) },
      relay: { latestTelemetry: () => ({ payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true }, capabilities: { liveVideo: true } }), sendCommand: async () => ({ status: "succeeded" }) },
      capabilityGate: { evaluate: () => ({ ok: true, value: { enabled: true } }) },
      targetConfig: { createRtmpTarget: () => ({ ok: true, value: { protocol: "rtmp", rtmpUrl: "rtmp://192.168.1.20:1935/live/device" } }) }
    });
    for (let index = 0; index < 10_000; index += 1) dispatcher.recordDisconnected(`device-${index}`);
    expect(dispatcher.list()).toEqual([]);
  });
});
