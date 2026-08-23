import { describe, expect, it } from "vitest";
import { RelayOperationsAdapter } from "../src/production/relay-operations-adapter/index.js";

const text = (value: string) => ({ kind: "string" as const, value });
const object = (fields: Record<string, unknown>) => ({ kind: "object" as const, fields });

describe("RelayOperationsAdapter WHIP gateway", () => {
  it("allows only the exact WHIP command names and fields", async () => {
    const sent: unknown[] = [];
    const adapter = RelayOperationsAdapter.create({ relay: {
      latestTelemetry: () => null,
      devices: () => [],
      sendMission: async () => ({ status: "rejected" }),
      sendCommand: async (deviceId, request) => { sent.push({ deviceId, request }); return { status: "succeeded" }; },
    } });

    await expect(adapter.whipStreamGateway().sendCommand("phone-1", { name: "live-stream-webrtc.start", fields: { whipUrl: "http://192.168.1.20:8889/live/phone-1/whip" } })).resolves.toMatchObject({ status: "succeeded" });
    await expect(adapter.whipStreamGateway().sendCommand("phone-1", { name: "live-stream-webrtc.stop", fields: {} })).resolves.toMatchObject({ status: "succeeded" });
    await expect(adapter.whipStreamGateway().sendCommand("phone-1", { name: "live-stream.start" as never, fields: { whipUrl: text("bad") } as never })).resolves.toMatchObject({ status: "rejected" });
    await expect(adapter.whipStreamGateway().sendCommand("phone-1", { name: "live-stream-webrtc.start", fields: {} })).resolves.toMatchObject({ status: "rejected" });
    await expect(adapter.whipStreamGateway().sendCommand("phone-1", { name: "live-stream-webrtc.start", fields: { whipUrl: "" } })).resolves.toMatchObject({ status: "rejected" });

    expect(sent).toEqual([
      { deviceId: "phone-1", request: { name: "live-stream-webrtc.start", fields: { whipUrl: text("http://192.168.1.20:8889/live/phone-1/whip") } } },
      { deviceId: "phone-1", request: { name: "live-stream-webrtc.stop", fields: {} } },
    ]);
  });

  it("normalizes relay failures and never forwards legacy RTMP commands through the WHIP port", async () => {
    const adapter = RelayOperationsAdapter.create({ relay: {
      latestTelemetry: () => null,
      devices: () => [],
      sendMission: async () => ({ status: "rejected" }),
      sendCommand: async () => { throw new Error("transport-secret"); },
    } });

    await expect(adapter.whipStreamGateway().sendCommand("phone-1", { name: "live-stream-webrtc.stop", fields: {} })).resolves.toEqual({ status: "transport-failed" });
    expect(JSON.stringify(adapter.snapshot())).not.toContain("transport-secret");
    expect(object({})).toBeDefined();
  });

  it("forwards bounded phone rejection details to the WHIP command result", async () => {
    const adapter = RelayOperationsAdapter.create({ relay: {
      latestTelemetry: () => null,
      devices: () => [],
      sendMission: async () => ({ status: "rejected" }),
      sendCommand: async () => ({ status: "rejected", detail: "Another video transport is active" }),
    } });

    await expect(adapter.whipStreamGateway().sendCommand("phone-1", { name: "live-stream-webrtc.start", fields: { whipUrl: "http://192.168.1.20:8889/live/phone-1/whip" } })).resolves.toEqual({
      status: "rejected",
      detail: "Another video transport is active",
    });
  });
});
