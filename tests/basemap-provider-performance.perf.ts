import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { BasemapProvider } from "../src/modules/geo-map/basemap-provider/index.js";

it("底图提供者在界面刷新预算内批量生成描述", () => {
  const started = performance.now();
  for (let index = 0; index < 10_000; index += 1) {
    BasemapProvider.resolve({ basemap: index % 2 === 0 ? "tianditu-vector" : "tianditu-image", credential: "key" });
  }
  expect(performance.now() - started).toBeLessThan(250);
});
