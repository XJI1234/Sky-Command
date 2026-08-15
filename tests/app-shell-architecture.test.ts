import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "src/modules/app-shell");
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("应用外壳架构契约", () => {
  it("每个二级模块只从根入口暴露，并且不携带业务、DJI、地图或媒体依赖", () => {
    const source = files(ROOT).map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).not.toMatch(/from\s+["'](?:electron|vue|cesium|ws|node:)/i);
    expect(source).not.toMatch(/wayline|telemetry|ffmpeg|dji|flight\.takeoff|live-stream/i);
    expect(readFileSync(join(ROOT, "index.ts"), "utf8")).toContain("./ipc-bridge/index.js");
    expect(readFileSync(join(ROOT, "index.ts"), "utf8")).toContain("./process-lifecycle/index.js");
    expect(readFileSync(join(ROOT, "index.ts"), "utf8")).toContain("./renderer-host/index.js");
    expect(readFileSync(join(ROOT, "index.ts"), "utf8")).toContain("./runtime-paths/index.js");
    expect(readFileSync(join(ROOT, "index.ts"), "utf8")).toContain("./window-manager/index.js");
  });
});
