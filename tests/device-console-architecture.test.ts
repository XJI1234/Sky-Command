import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("设备控制台一级入口只导入本模块的公开二级入口", async () => {
  const source = await readFile(new URL("../src/modules/device-console/index.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/from ["'][^"']*(?:node:|electron|ws|dji|vue|relay-link|mission-control|geo-map|route-library|route-planning|desktop-settings)[^"']*["']/iu);
  expect(source).toContain("./link-chain/index.js");
  expect(source).toContain("./capability-gate/index.js");
  expect(source).toContain("./pairing-controller/index.js");
  expect(source).toContain("./device-guidance/index.js");
  expect(source).toContain("./device-settings-panel/index.js");
});
