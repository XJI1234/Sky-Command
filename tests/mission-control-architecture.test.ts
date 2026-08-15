import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("飞行任务控制模块架构契约", () => {
  it("仅组合公开任务模块，不引入平台、协议或界面实现", async () => {
    const source = await readFile(new URL("../src/modules/mission-control/index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["'](?:electron|ws|node:net|node:fs|@dji|dji)/u);
    expect(source).not.toMatch(/from ["'][^"']*(?:protocol-core|relay-server|mission-sender|android|vue|react)[^"']*["']/iu);
    expect(source).toContain("MissionDispatcher");
  });
});
