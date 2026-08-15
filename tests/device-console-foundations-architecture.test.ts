import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("设备控制台基础模块不依赖平台实现、网络或其他一级模块", async () => {
  const files = [
    "../src/modules/device-console/link-chain/index.ts",
    "../src/modules/device-console/capability-gate/index.ts",
    "../src/modules/device-console/pairing-controller/index.ts"
  ];
  const sources = await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), "utf8")));
  for (const source of sources) {
    expect(source).not.toMatch(/from ["'][^"']*(?:node:|electron|ws|dji|vue|relay-link|mission-control|geo-map|route-library|route-planning|desktop-settings)[^"']*["']/iu);
  }
  expect(sources[0]).toContain("LinkChain");
  expect(sources[1]).toContain("CapabilityGate");
  expect(sources[2]).toContain("PairingController");
});
