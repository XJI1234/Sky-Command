import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("media-pipeline video-player 架构契约", () => {
  it("只依赖语言标准能力和注入适配器，不触碰工作区或其他媒体模块", () => {
    const root = join(process.cwd(), "src/modules/media-pipeline/video-player");
    const source = readFileSync(join(root, "index.ts"), "utf8");
    const contract = readFileSync(join(root, "CONTRACT.md"), "utf8");
    expect(contract).toContain("唯一职责");
    expect(source).not.toMatch(/from\s+["'](?:node:|electron|vue|react|ws|ffmpeg)/i);
    expect(source).not.toMatch(/document|window|HTMLVideoElement|createServer|child_process|spawn\(|exec\(|readFile|writeFile|rtmp|hls-server|transcode-runner|stream-health|relay-link/i);
    expect(source).toContain("export const VideoPlayer");
  });
});
