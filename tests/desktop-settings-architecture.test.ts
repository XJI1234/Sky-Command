import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("desktop-settings root architecture contract", () => {
  it("forms the sole public seam over the settings store", async () => {
    const source = await readFile(new URL("../src/modules/desktop-settings/index.ts", import.meta.url), "utf8");

    expect(source).toMatch(/from ["']\.\/settings-store\/index\.js["']/u);
    expect(source).not.toMatch(/from ["'][^"']*(?:node:|electron|vue|websocket|cesium|dji|route-library)[^"']*["']/iu);
  });
});
