import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("媒体管线 rtmp-ingest 架构契约", () => {
  it("只管理注入接收端口与流事实，不实现网络、文件、转码或其他媒体模块", () => {
    const root = join(process.cwd(), "src/modules/media-pipeline/rtmp-ingest");
    const source = readFileSync(join(root, "index.ts"), "utf8");
    const contract = readFileSync(join(root, "CONTRACT.md"), "utf8");

    expect(contract).toContain("唯一职责");
    expect(source).not.toMatch(/from\s+["'](?:node:|electron|ws|ffmpeg|vue|react)/i);
    expect(source).not.toMatch(/child_process|spawn\(|(?:^|[^.])exec\(|readFile|writeFile|createServer|rtmp-server|hls-server|transcode-runner|stream-health|relay-link/i);
    expect(source).toContain("export const RtmpIngest");
  });
});
