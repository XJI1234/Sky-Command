import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("webrtc-media 架构契约", () => {
  it("只组合低延迟媒体子模块，不依赖旧媒体管线或平台全局对象", () => {
    const root = join(process.cwd(), "src/modules/webrtc-media");
    const source = readFileSync(join(root, "index.ts"), "utf8");
    const contract = readFileSync(join(root, "CONTRACT.md"), "utf8");
    expect(contract).toContain("唯一职责");
    expect(source).toContain("export const WebRtcMedia");
    expect(source).not.toMatch(/electron|window|document|child_process|spawn\(|exec\(|ffmpeg|hls|rtmp|WebSocket|RTCPeerConnection|fetch\(/i);
    expect(source).not.toMatch(/from\s+["'].*media-pipeline/i);
  });
});
