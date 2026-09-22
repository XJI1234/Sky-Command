import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("camera-photo-control 架构契约", () => {
  it("组合根只组合两个公开二级模块，不导入 WebSocket、DJI 或 Electron", () => {
    const source = readFileSync(join(process.cwd(), "src/modules/camera-photo-control/index.ts"), "utf8");
    const contract = readFileSync(join(process.cwd(), "src/modules/camera-photo-control/CONTRACT.md"), "utf8");
    expect(contract).toContain("唯一职责");
    expect(source).toContain("PhotoDispatcher");
    expect(source).toContain("PhotoInbox");
    expect(source).not.toMatch(/node:|electron|ffmpeg|websocket|dji|media-pipeline|live-stream/i);
  });
});
