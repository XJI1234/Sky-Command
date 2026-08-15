import { expect, it } from "vitest";
import { RoutePreviewModel } from "../src/modules/route-library/preview/index.js";

it("D3.5 preview model processes a large complete polyline without argument expansion", () => {
  const count = 200_000;
  const waypoints = Array.from({ length: count }, (_, sequence) => ({
    longitude: 120 + sequence / count,
    latitude: 30 - sequence / count,
    altitude: sequence % 400,
    sequence
  }));
  const detail = { routeId: "large-route", waypoints } as never;

  const startedAt = performance.now();
  const result = RoutePreviewModel.createPreview(detail);
  const elapsed = performance.now() - startedAt;

  expect(result).toMatchObject({
    ok: true,
    value: {
      routeId: "large-route",
      polyline: { length: count },
      cameraBounds: { minAltitude: 0, maxAltitude: 399 }
    }
  });
  expect(elapsed).toBeLessThan(1_500);
});
