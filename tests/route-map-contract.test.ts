import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("航线地图显示契约", () => {
  it("为折线中的每个内部航点创建独立点标记，同时保留首尾标记", async () => {
    const source = await readFile(new URL("../src/production/operator-console/renderer/route-map.ts", import.meta.url), "utf8");

    expect(source).toContain("preview.polyline.slice(1, -1)");
    expect(source).toContain("viewer.entities.add({");
    expect(source).toContain('name: `航点${index + 2}`');
    expect(source).toContain("point:");
  });

  it("默认加载南京白模并保留杭州白模", async () => {
    const source = await readFile(new URL("../src/production/operator-console/renderer/route-map.ts", import.meta.url), "utf8");

    expect(source).toContain("setNanjingCamera");
    expect(source).toContain("loadNanjingCityModel");
    expect(source).toContain("loadHangzhouCityModel");
    expect(source).toContain("南京三维白模");
  });

  it("航线页不可见时停止默认渲染循环，可见时按需渲染", async () => {
    const map = await readFile(new URL("../src/production/operator-console/renderer/route-map.ts", import.meta.url), "utf8");
    const config = await readFile(new URL("../src/production/operator-console/renderer/cesium-config.ts", import.meta.url), "utf8");

    expect(config).toContain("requestRenderMode: true");
    expect(map).toContain("export function setRouteMapVisible");
    expect(map).toContain("useDefaultRenderLoop = visible");
    expect(map).toContain("requestRender()");
  });
});
