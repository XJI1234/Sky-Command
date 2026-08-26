import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("媒体管线 http-flv-server 架构契约", () => {
  it("只管理注入服务端口和本地播放地址，不读写文件、不创建网络实现、不触碰其他媒体模块", () => {
    const root = join(process.cwd(), "src/modules/media-pipeline/http-flv-server");
    const source = readFileSync(join(root, "index.ts"), "utf8");
    const contract = readFileSync(join(root, "CONTRACT.md"), "utf8");

    expect(contract).toContain("唯一职责");
    expect(source).not.toMatch(/from\s+["'](?:node:|electron|ws|ffmpeg|vue|react)/i);
    expect(source).not.toMatch(/child_process|spawn\(|exec\(|readFile|writeFile|createServer|rtmp|stream-health|transcode-runner|relay-link/i);
    expect(source).toContain("export const HttpFlvServer");
  });
});
