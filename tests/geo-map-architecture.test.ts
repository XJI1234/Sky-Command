import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("地图模块架构契约", () => {
  it("只组合内部地图模块，不依赖具体引擎、平台或业务模块", async () => {
    const source = await readFile(new URL("../src/modules/geo-map/index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["'][^"']*(?:cesium|tianditu|electron|node:|desktop-settings|route-library|mission-control|relay-link|vue|react)[^"']*["']/iu);
    expect(source).toContain("MapEngineAdapter");
    expect(source).toContain("BasemapProvider");
    expect(source).toContain("CityModelCatalog");
  });
});
