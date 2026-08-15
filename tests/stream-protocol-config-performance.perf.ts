import { describe, expect, it } from "vitest";
import { StreamProtocolConfig } from "../src/modules/live-stream-control/stream-protocol-config/index.js";

describe("stream-protocol-config 性能契约", () => {
  it("在一万次目标构造中保持纯同步处理", () => {
    let accepted = 0;
    for (let index = 0; index < 10_000; index += 1) {
      const result = StreamProtocolConfig.createRtmpTarget({ deviceId: `device-${index}`, endpoint: { host: "192.168.1.20", port: 1935 } });
      if (result.ok) accepted += 1;
    }
    expect(accepted).toBe(10_000);
  });
});
