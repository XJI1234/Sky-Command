import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { DeviceSettingsPanel, type DeviceSettingsPort } from "../src/modules/device-console/device-settings-panel/index.js";

it("设备设置面板可在界面交互预算内读取一千台设备", async () => {
  const transmission = { frequencyBand: "BAND_2_DOT_4G", channelSelectionMode: "AUTO", bandwidth: "BANDWIDTH_10MHZ", dynamicDataRateMbps: 1 };
  const camera = { autoExposureLockEnabled: false, focusMode: "AF", cameraIndex: "LEFT_OR_MAIN" };
  const port: DeviceSettingsPort = { readTransmission: async () => ({ ok: true, value: transmission }), writeTransmission: async () => ({ ok: true, value: transmission }), readCamera: async () => ({ ok: true, value: camera }), writeCamera: async () => ({ ok: true, value: camera }) };
  const panel = DeviceSettingsPanel.create({ port }); const started = performance.now();
  await Promise.all(Array.from({ length: 1_000 }, (_, index) => panel.readTransmission(`phone-${index}`)));
  expect(performance.now() - started).toBeLessThan(1_000);
});
