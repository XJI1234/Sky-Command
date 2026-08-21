import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("mediamtx-process 架构契约", () => {
  it("拥有契约且不直接依赖 Node、Electron 或具体进程实现", () => {
    const root = join(process.cwd(), "src/modules/webrtc-media/mediamtx-process");
    const source = readFileSync(join(root, "index.ts"), "utf8");
    const contract = readFileSync(join(root, "CONTRACT.md"), "utf8");
    expect(contract).toContain("唯一职责");
    expect(source).toContain("export const MediaMtxProcess");
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/node:|electron|child_process|spawn\(|exec\(|readFile|writeFile|createServer|RTCPeerConnection|fetch\(/i);
  });
});
