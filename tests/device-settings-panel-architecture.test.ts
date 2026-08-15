import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("设备设置核心不依赖中继、DJI、网络或界面实现", async () => {
  const source = await readFile(new URL("../src/modules/device-console/device-settings-panel/index.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/from ["'][^"']*(?:node:|electron|ws|dji|vue|relay-link)[^"']*["']/iu);
  expect(source).toContain("DeviceSettingsPort");
});
