import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("媒体管线 network-endpoint 架构契约", () => {
  it("保持纯端点判定，不导入运行时、网络或媒体实现", () => {
    const source = readFileSync(join(process.cwd(), "src/modules/media-pipeline/network-endpoint/index.ts"), "utf8");
    expect(source).not.toMatch(/from\s+["'](?:node:|electron|ws|ffmpeg|vue)/i);
    expect(source).not.toMatch(/listen\(|child_process|relay-link|live-stream-control/i);
    expect(readFileSync(join(process.cwd(), "src/modules/media-pipeline/network-endpoint/CONTRACT.md"), "utf8")).toContain("唯一职责");
  });
});
