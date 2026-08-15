import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("设备连接引导架构契约", () => {
  it("只消费归一化快照，不引入设备、传输、界面或平台实现", async () => {
    const source = await readFile(new URL("../src/modules/device-console/device-guidance/index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["'][^"']*(?:node:|electron|ws|dji|vue|link-chain|pairing-controller|capability-gate|relay-link)[^"']*["']/iu);
    expect(source).toContain("export const DeviceGuidance");
    expect(source).toContain("function evaluate");
  });
});
