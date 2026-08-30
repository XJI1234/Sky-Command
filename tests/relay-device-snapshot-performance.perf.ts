import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { RelayDeviceSnapshotReader } from "../src/modules/mission-control/relay-device-snapshot/index.js";

it("中继设备快照解析模块可在界面刷新预算内处理高频快照", () => {
  const snapshot = { devices: Array.from({ length: 16 }, (_value, index) => ({ deviceId: `phone-${index}` })) };
  const started = performance.now();
  let allSnapshotsValid = true;

  for (let index = 0; index < 10_000; index += 1) {
    allSnapshotsValid = RelayDeviceSnapshotReader.read(snapshot)?.size === 16 && allSnapshotsValid;
  }

  expect(allSnapshotsValid).toBe(true);
  expect(performance.now() - started).toBeLessThan(250);
});
