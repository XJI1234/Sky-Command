import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("live-stream-control 架构契约", () => {
  it("组合根仅组合两个公开二级模块，不依赖平台或其他一级模块实现", () => {
    const source = readFileSync(join(process.cwd(), "src/modules/live-stream-control/index.ts"), "utf8");
    const contract = readFileSync(join(process.cwd(), "src/modules/live-stream-control/CONTRACT.md"), "utf8");
    expect(contract).toContain("唯一职责");
    expect(source).toContain("StreamProtocolConfig");
    expect(source).toContain("StreamDispatcher");
    expect(source).not.toMatch(/node:|electron|ffmpeg|websocket|dji|media-pipeline|relay-link/i);
  });
});
