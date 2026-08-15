import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("mission-sender architecture contract", () => {
  it("keeps file, transport, and DJI concerns outside the module", async () => {
    const source = await readFile(new URL("../src/modules/relay-link/mission-sender/index.ts", import.meta.url), "utf8");
    expect(source).toContain("MissionSink");
    expect(source).toContain("mission-chunk");
    expect(source).not.toMatch(/from ["'][^"']*(?:node:|electron|websocket|dji|android|route-library|desktop-settings)["']/iu);
    expect(source).not.toMatch(/readFile|writeFile|WebSocket|fetch\(|BrowserWindow|Cesium/iu);
  });
});
