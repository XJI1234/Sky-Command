import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("底图提供者架构契约", () => {
  it("只生产数据描述，不依赖具体地图引擎、网络、设置或业务模块", async () => {
    const source = await readFile(new URL("../src/modules/geo-map/basemap-provider/index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["'][^"']*(?:cesium|tianditu|electron|node:|desktop-settings|route-library|mission-control|relay-link|vue|react)[^"']*["']/iu);
    expect(source).toContain("BasemapProvider");
  });
});
