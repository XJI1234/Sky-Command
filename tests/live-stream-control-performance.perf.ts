import { describe, expect, it } from "vitest";
import { LiveStreamControl } from "../src/modules/live-stream-control/index.js";

describe("live-stream-control 性能契约", () => {
  it("可同步创建一万个独立组合根", () => {
    let created = 0;
    for (let index = 0; index < 10_000; index += 1) {
      const control = LiveStreamControl.create({ media: { snapshot: () => null }, relay: { latestTelemetry: () => null, sendCommand: async () => ({ status: "succeeded" }) }, capabilityGate: { evaluate: () => ({ ok: true, value: { enabled: true } }) } });
      if (control.get(`device-${index}`).phase === "idle") created += 1;
    }
    expect(created).toBe(10_000);
  });
});
