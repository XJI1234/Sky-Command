import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("command-tracker architecture contract", () => {
  it("contains only command lifecycle state and an injected scheduler", async () => {
    const source = await readFile(new URL("../src/modules/relay-link/command-tracker/index.ts", import.meta.url), "utf8");
    expect(source).toContain("CommandTracker");
    expect(source).not.toMatch(/from ["'][^"']*(?:node:|electron|websocket|dji|android|route-library|desktop-settings)["']/iu);
    expect(source).not.toMatch(/send\(|RelayFrameCodec|telemetry|mission|WebSocket|fetch\(/iu);
  });
});
