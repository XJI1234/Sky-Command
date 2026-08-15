import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("device-registry architecture contract", () => {
  it("contains only immutable registry logic", async () => {
    const source = await readFile(new URL("../src/modules/relay-link/device-registry/index.ts", import.meta.url), "utf8");
    expect(source).toContain("DeviceRegistry");
    expect(source).not.toMatch(/from ["'][^"']*(?:node:|electron|websocket|dji|android|route-library|desktop-settings)[^"']*["']/iu);
    expect(source).not.toMatch(/WebSocket|setTimeout|fetch\(|fs\.|localStorage|telemetry|mission/iu);
  });
});
