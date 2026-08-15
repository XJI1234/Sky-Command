import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "src/modules/media-pipeline");

describe("媒体管线 stream-health 架构契约", () => {
  it("只从自身入口暴露纯健康判定，不携带网络、进程、文件系统、播放器或控制侧依赖", () => {
    const source = readFileSync(join(ROOT, "stream-health/index.ts"), "utf8");
    expect(readFileSync(join(ROOT, "CONTRACT.md"), "utf8")).toContain("stream-health");
    expect(readFileSync(join(ROOT, "stream-health/CONTRACT.md"), "utf8")).toContain("唯一职责");
    expect(source).not.toMatch(/from\s+["'](?:node:|electron|ws|ffmpeg|vue|react)/i);
    expect(source).not.toMatch(/child_process|listen\(|live-stream-control|relay-link/i);
    expect(source).toContain("export const StreamHealth");
  });
});
