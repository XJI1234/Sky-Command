import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("stream-dispatcher 架构契约", () => {
  it("有中文契约且不导入平台或其他一级模块实现", () => {
    const source = readFileSync(join(process.cwd(), "src/modules/live-stream-control/stream-dispatcher/index.ts"), "utf8");
    const contract = readFileSync(join(process.cwd(), "src/modules/live-stream-control/stream-dispatcher/CONTRACT.md"), "utf8");
    expect(contract).toContain("唯一职责");
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/node:|electron|ffmpeg|websocket|dji|child_process/i);
  });
});
