import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("whep-playback 架构契约", () => {
  it("拥有契约且不直接依赖浏览器、Electron 或网络实现", () => {
    const root = join(process.cwd(), "src/modules/webrtc-media/whep-playback");
    const source = readFileSync(join(root, "index.ts"), "utf8");
    const contract = readFileSync(join(root, "CONTRACT.md"), "utf8");
    expect(contract).toContain("唯一职责");
    expect(source).toContain("export const WhepPlayback");
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/node:|electron|document|window|RTCPeerConnection|fetch\(/i);
  });
});
