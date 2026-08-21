import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("media-path-monitor 架构契约", () => {
  it("拥有契约并只依赖注入端口", () => {
    const root = join(process.cwd(), "src/modules/webrtc-media/media-path-monitor");
    const source = readFileSync(join(root, "index.ts"), "utf8");
    const contract = readFileSync(join(root, "CONTRACT.md"), "utf8");
    expect(contract).toContain("唯一职责");
    expect(source).toContain("export const MediaPathMonitor");
    expect(source).not.toMatch(/from\s+["'](?:node:|electron|ws|http)/i);
    expect(source).not.toMatch(/child_process|document|window|live-stream-control/i);
  });
});
