import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("webrtc-health 架构契约", () => {
  it("是纯模块并拥有自身契约", () => {
    const root = join(process.cwd(), "src/modules/webrtc-media/webrtc-health");
    const source = readFileSync(join(root, "index.ts"), "utf8");
    const contract = readFileSync(join(root, "CONTRACT.md"), "utf8");
    expect(contract).toContain("唯一职责");
    expect(source).toContain("export const WebRtcHealth");
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/node:|electron|ffmpeg|websocket|media-pipeline|live-stream-control/i);
  });
});
