import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { DeviceConsole } from "../src/modules/device-console/index.js";

it("设备控制台一级入口可在界面初始化预算内完成一万次稳定访问", () => {
  const started = performance.now();
  for (let index = 0; index < 10_000; index += 1) {
    void DeviceConsole.LinkChain;
    void DeviceConsole.CapabilityGate;
    void DeviceConsole.PairingController;
    void DeviceConsole.DeviceGuidance;
    void DeviceConsole.DeviceSettingsPanel;
  }
  expect(performance.now() - started).toBeLessThan(100);
});
