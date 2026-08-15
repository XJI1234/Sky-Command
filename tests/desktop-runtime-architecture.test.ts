import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop-runtime 架构契约", () => {
  it("有中文契约且不依赖平台、界面或一级模块内部实现", () => {
    const source = readFileSync(join(process.cwd(), "src/production/desktop-runtime/index.ts"), "utf8");
    const contract = readFileSync(join(process.cwd(), "src/production/desktop-runtime/CONTRACT.md"), "utf8");
    expect(contract).toContain("唯一职责");
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/node:|electron|window|ipc|websocket|dji|react|vue/i);
  });
});
