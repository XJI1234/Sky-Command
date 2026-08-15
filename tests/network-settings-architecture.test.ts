import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../src/modules/desktop-settings/network-settings/", import.meta.url);

describe("desktop-settings network-settings architecture contract", () => {
  it("has one pure public seam with no platform or business-module dependency", async () => {
    const source = await readFile(new URL("index.ts", root), "utf8");

    expect(source).toContain("NetworkSettings");
    expect(source).not.toMatch(/from ["'][^"']*(?:node:|electron|vue|websocket|cesium|dji|relay-link|geo-map|mission-control)[^"']*["']/iu);
    expect(source).not.toMatch(/unsafeCreate|fromUnchecked|as unknown as/iu);
  });
});
