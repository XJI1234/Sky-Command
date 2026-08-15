import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("telemetry-intake architecture contract", () => {
  it("uses protocol validation without network or telemetry business dependencies", async () => {
    const source = await readFile(new URL("../src/modules/relay-link/telemetry-intake/index.ts", import.meta.url), "utf8");
    expect(source).toContain("validate");
    expect(source).not.toMatch(/from ["'][^"']*(?:node:|electron|websocket|dji|android|route-library|desktop-settings)["']/iu);
    expect(source).not.toMatch(/WebSocket|fetch\(|setTimeout|battery|gps|camera|mission/iu);
  });
});
