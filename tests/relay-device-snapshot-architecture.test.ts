import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("中继设备快照解析模块架构契约", () => {
  it("保持为不依赖平台、传输或任务实现的纯模块", async () => {
    const source = await readFile(new URL("../src/modules/mission-control/relay-device-snapshot/index.ts", import.meta.url), "utf8");

    expect(source).not.toMatch(/from ["'](?:electron|ws|node:net|node:fs|@dji|dji)/u);
    expect(source).not.toMatch(/from ["'][^"']*(?:mission-dispatcher|relay-link|android|vue|react)[^"']*["']/iu);
    expect(source).toContain("function read");
  });
});
