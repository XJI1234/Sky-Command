import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("node-runtime 架构契约", () => {
  it("有中文契约且只组合 Node 传输与 relay-link 公开入口", () => {
    const source = readFileSync(join(process.cwd(), "src/production/node-runtime/index.ts"), "utf8");
    const contract = readFileSync(join(process.cwd(), "src/production/node-runtime/CONTRACT.md"), "utf8");
    expect(contract).toContain("唯一职责");
    expect(source).toContain("NodeWebSocketRelayTransport");
    expect(source).toContain("RelayLink");
    expect(source).not.toMatch(/electron|dji|ffmpeg|media-pipeline|route-|flight-control|react|vue/i);
  });
});
