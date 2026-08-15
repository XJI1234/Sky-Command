import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("城市模型目录架构契约", () => {
  it("不读取资源或依赖具体地图、平台和业务模块", async () => {
    const source = await readFile(new URL("../src/modules/geo-map/city-model/index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["'][^"']*(?:cesium|3d-tiles|tianditu|electron|node:|desktop-settings|route-library|mission-control|relay-link|vue|react)[^"']*["']/iu);
    expect(source).toContain("CityModelCatalog");
  });
});
