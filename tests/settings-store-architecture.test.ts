import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../src/modules/desktop-settings/settings-store/", import.meta.url);

describe("desktop-settings settings-store architecture contract", () => {
  it("depends only on settings seams and has no platform imports", async () => {
    const source = await readFile(new URL("index.ts", root), "utf8");

    expect(source).toContain("DesktopSettings");
    expect(source).not.toMatch(/from ["'][^"']*(?:node:|electron|vue|websocket|cesium|dji|relay-link|geo-map|mission-control)[^"']*["']/iu);
  });
});
