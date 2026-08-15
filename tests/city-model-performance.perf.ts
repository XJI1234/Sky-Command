import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { CityModelCatalog } from "../src/modules/geo-map/city-model/index.js";

it("城市模型目录在界面刷新预算内完成批量检索", () => {
  const created = CityModelCatalog.create(Array.from({ length: 32 }, (_, index) => ({ id: `model-${index}`, displayName: `模型 ${index}`, tilesetUrl: `/models/${index}/tileset.json` })));
  if (!created.ok) throw created.error;
  const started = performance.now();
  for (let index = 0; index < 10_000; index += 1) created.value.resolve(`model-${index % 32}`);
  expect(performance.now() - started).toBeLessThan(250);
});
