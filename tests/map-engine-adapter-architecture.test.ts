import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("地图引擎适配器架构契约", () => {
  it("不导入具体地图、平台或业务模块", async () => {
    const source = await readFile(new URL("../src/modules/geo-map/map-engine-adapter/index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["'][^"']*(?:cesium|tianditu|electron|node:fs|route-library|mission-control|vue|react)[^"']*["']/iu);
    expect(source).toContain("MapEngineFactory");
  });
});
