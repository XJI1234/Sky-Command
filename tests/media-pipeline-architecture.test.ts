import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("media-pipeline 一级组合根架构契约", () => {
  it("只作为二级模块组合根，不反向依赖控制、设备、地图或 UI", () => {
    const root = join(process.cwd(), "src/modules/media-pipeline");
    const source = readFileSync(join(root, "index.ts"), "utf8");
    const contract = readFileSync(join(root, "CONTRACT.md"), "utf8");
    expect(contract).toContain("组合根公开接口");
    expect(source).toContain("export const MediaPipeline");
    expect(source).not.toMatch(/from\s+["'](?:electron|vue|react|ws|node:|\.\.\/\.\.\/device|\.\.\/\.\.\/mission|\.\.\/\.\.\/geo|\.\.\/\.\.\/relay)/i);
    expect(source).not.toMatch(/live-stream-control|sendCommand|sendMission|wayline|GeoMap|document|window/i);
  });
});
