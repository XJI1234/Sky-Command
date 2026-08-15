import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("媒体管线 ffmpeg-locator 架构契约", () => {
  it("只负责候选定位，不导入或创建进程、文件系统、网络和其他媒体实现", () => {
    const root = join(process.cwd(), "src/modules/media-pipeline/ffmpeg-locator");
    const source = readFileSync(join(root, "index.ts"), "utf8");
    const contract = readFileSync(join(root, "CONTRACT.md"), "utf8");

    expect(contract).toContain("唯一职责");
    expect(source).not.toMatch(/from\s+["'](?:node:|electron|ws|ffmpeg|vue|react)/i);
    expect(source).not.toMatch(/child_process|spawn\(|exec\(|readFile|writeFile|listen\(|rtmp|hls|relay-link|stream-health/i);
    expect(source).toContain("export const FfmpegLocator");
  });
});
