import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("relay-link root architecture contract", () => {
  it("is a business-facing composition seam without transport or platform dependencies", async () => {
    const source = await readFile(new URL("../src/modules/relay-link/index.ts", import.meta.url), "utf8");
    expect(source).toContain("RelayServer.create");
    expect(source).toContain("DeviceRegistry.create");
    expect(source).toContain("CommandTracker.create");
    expect(source).toContain("TelemetryIntake.create");
    expect(source).toContain("MissionSender.create");
    expect(source).not.toMatch(/from ["'][^"']*(?:node:|electron|websocket|android|dji|route-library|desktop-settings)[^"']*["']/iu);
    expect(source).not.toMatch(/WebSocket|BrowserWindow|readFile|writeFile|fetch\(|console\./iu);
  });
});
