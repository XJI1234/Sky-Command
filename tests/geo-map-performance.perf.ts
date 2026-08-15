import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { GeoMap } from "../src/modules/geo-map/index.js";

it("地图组合模块在界面刷新预算内切换底图", () => {
  const map = GeoMap.create({ factory: { create: () => ({ replaceLayer: () => undefined, removeLayer: () => undefined, focus: () => undefined, dispose: () => undefined }) } });
  map.initialize({ identity: "host" });
  const started = performance.now();
  for (let index = 0; index < 10_000; index += 1) map.applyBasemap({ basemap: index % 2 === 0 ? "tianditu-vector" : "tianditu-image", credential: "key" });
  expect(performance.now() - started).toBeLessThan(250);
});
