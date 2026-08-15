import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { MapEngineAdapter } from "../src/modules/geo-map/map-engine-adapter/index.js";

it("地图引擎适配器在界面刷新预算内处理频繁图层替换", () => {
  const adapter = MapEngineAdapter.create({ factory: { create: () => ({ replaceLayer: () => undefined, removeLayer: () => undefined, focus: () => undefined, dispose: () => undefined }) } });
  adapter.initialize({ identity: "host" });
  const started = performance.now();
  for (let index = 0; index < 10_000; index += 1) adapter.replaceLayer({ id: `layer-${index % 16}`, payload: null });
  expect(performance.now() - started).toBeLessThan(250);
});
