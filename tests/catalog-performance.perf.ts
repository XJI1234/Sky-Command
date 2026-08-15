import { expect, it } from "vitest";
import { RouteCatalog } from "../src/modules/route-library/catalog/index.js";
import { createQualifiedRoute, createRouteAsset, createRouteId, createWaypoint } from "../src/modules/route-library/domain/index.js";

function asset(index: number) {
  const first = createWaypoint({ longitude: 120, latitude: 30, altitude: 1, sequence: 0 });
  const second = createWaypoint({ longitude: 121, latitude: 31, altitude: 2, sequence: 1 });
  if (!first.ok || !second.ok) throw new Error("setup");
  const id = `route-${index}`;
  const route = createQualifiedRoute({
    displayName: `${id}.kml`, format: "kml", classification: "preview-only", sourceDocument: `${id}.kml`,
    waypoints: [first.value, second.value], warnings: [], sha256: index.toString(16).padStart(64, "0"),
    sizeBytes: 1, originalBytes: new Uint8Array([1])
  });
  if (!route.ok) throw route.error;
  const routeId = createRouteId(id);
  if (!routeId.ok) throw routeId.error;
  const created = createRouteAsset({ qualifiedRoute: route.value, routeId: routeId.value, importedAt: "2026-08-10T00:00:00.000Z" });
  if (!created.ok) throw created.error;
  return created.value;
}

it("D3.4 catalog removes from a large ordered session without quadratic work", () => {
  const catalog = RouteCatalog.create();
  const size = 2_000;
  for (let index = 0; index < size; index += 1) catalog.add(asset(index));
  const start = performance.now();
  for (let index = 0; index < size; index += 2) catalog.remove(`route-${index}` as never);
  const elapsed = performance.now() - start;

  expect(catalog.snapshot().routes).toHaveLength(size / 2);
  expect(elapsed).toBeLessThan(1_500);
});
