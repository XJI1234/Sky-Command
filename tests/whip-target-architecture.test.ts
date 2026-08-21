import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("whip-target 架构契约", () => {
  it("拥有中文契约并且是纯目标构造模块", () => {
    const root = join(process.cwd(), "src/modules/whip-stream-control/whip-target");
    const source = readFileSync(join(root, "index.ts"), "utf8");
    const contract = readFileSync(join(root, "CONTRACT.md"), "utf8");
    expect(contract).toContain("唯一职责");
    expect(source).toContain("export const WhipTarget");
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/node:|electron|ffmpeg|websocket|media-pipeline|relay-link/i);
  });
});
