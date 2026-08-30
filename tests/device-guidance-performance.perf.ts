import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { DeviceGuidance } from "../src/modules/device-console/device-guidance/index.js";

it("设备连接引导可在界面交互预算内连续评估一万台设备", () => {
  const started = performance.now();
  for (let index = 0; index < 10_000; index += 1) {
    expect(DeviceGuidance.evaluate({
      link: {
        deviceId: `phone-${index}`,
        overall: "degraded",
        computerToPhone: "connected",
        phoneToRemoteController: "connected",
        remoteControllerToAircraft: "disconnected"
      },
      pairingState: "IDLE"
    })).toMatchObject({ ok: true, value: { code: "CONNECT_AIRCRAFT" } });
  }
  expect(performance.now() - started).toBeLessThan(1_000);
});
