import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("中继设备设置适配器只依赖两端公开接口，不依赖运行时平台", async () => {
  const source = await readFile(new URL("../src/adapters/relay-device-settings/index.ts", import.meta.url), "utf8");
  expect(source).toContain("DeviceSettingsPort");
  expect(source).toContain("JsonObject");
  expect(source).not.toMatch(/from ["'][^"']*(?:node:|electron|ws|dji|vue|\/internal\/)[^"']*["']/iu);
});
