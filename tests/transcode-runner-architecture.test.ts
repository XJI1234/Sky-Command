import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("媒体管线 transcode-runner 架构契约", () => {
  it("只管理注入进程端口的单流生命周期，不接触进程实现、网络、文件或健康判定", () => {
    const root = join(process.cwd(), "src/modules/media-pipeline/transcode-runner");
    const source = readFileSync(join(root, "index.ts"), "utf8");
    const contract = readFileSync(join(root, "CONTRACT.md"), "utf8");

    expect(contract).toContain("唯一职责");
    expect(source).not.toMatch(/from\s+["'](?:node:|electron|ws|ffmpeg|vue|react)/i);
    expect(source).not.toMatch(/child_process|spawn\(|exec\(|readFile|writeFile|listen\(|rtmp|hls|stream-health|relay-link/i);
    expect(source).toContain("export const TranscodeRunner");
  });
});
