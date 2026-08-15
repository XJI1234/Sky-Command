import { describe, expect, it } from "vitest";
import { NodeRuntime } from "../src/production/node-runtime/index.js";

describe("node-runtime 性能契约", () => {
  it("可同步创建一万个未启动的独立中继", () => {
    let created = 0;
    for (let index = 0; index < 10_000; index += 1) {
      const relay = NodeRuntime.createRelay({ address: { host: "127.0.0.1", port: 0 }, handshakeTimeoutMs: 1_000, maxConnections: 1, commandTimeoutMs: 1_000, missionTimeoutMs: 1_000 });
      if (relay.devices().length === 0) created += 1;
    }
    expect(created).toBe(10_000);
  });
});
