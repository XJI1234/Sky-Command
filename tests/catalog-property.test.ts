import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { RouteCatalog } from "../src/modules/route-library/catalog/index.js";
import { createQualifiedRoute, createRouteAsset, createRouteId, createWaypoint } from "../src/modules/route-library/domain/index.js";

function makeAsset(id: string) {
  const first = createWaypoint({ longitude: 120, latitude: 30, altitude: 1, sequence: 0 });
  const second = createWaypoint({ longitude: 121, latitude: 31, altitude: 2, sequence: 1 });
  if (!first.ok || !second.ok) throw new Error("setup");
  const route = createQualifiedRoute({
    displayName: `${id}.kml`, format: "kml", classification: "preview-only", sourceDocument: `${id}.kml`,
    waypoints: [first.value, second.value], warnings: [], sha256: id.replace("route-", "").padStart(64, "0").slice(-64),
    sizeBytes: 1, originalBytes: new Uint8Array([1])
  });
  if (!route.ok) throw route.error;
  const routeId = createRouteId(id);
  if (!routeId.ok) throw routeId.error;
  const asset = createRouteAsset({ qualifiedRoute: route.value, routeId: routeId.value, importedAt: "2026-08-10T00:00:00.000Z" });
  if (!asset.ok) throw asset.error;
  return asset.value;
}

describe("D3.4 route catalog properties", () => {
  it("preserves selection and ordering invariants through arbitrary operation sequences", () => {
    const operation = fc.oneof(
      fc.record({ kind: fc.constant("add" as const), id: fc.integer({ min: 1, max: 8 }) }),
      fc.record({ kind: fc.constant("select" as const), id: fc.integer({ min: 1, max: 10 }) }),
      fc.record({ kind: fc.constant("remove" as const), id: fc.integer({ min: 1, max: 10 }) }),
      fc.constant({ kind: "clear" as const })
    );

    fc.assert(fc.property(fc.array(operation, { maxLength: 80 }), (operations) => {
      const catalog = RouteCatalog.create();
      for (const current of operations) {
        if (current.kind === "add") catalog.add(makeAsset(`route-${current.id}`));
        if (current.kind === "select") catalog.select(`route-${current.id}` as never);
        if (current.kind === "remove") catalog.remove(`route-${current.id}` as never);
        if (current.kind === "clear") catalog.clear();

        const snapshot = catalog.snapshot();
        expect(snapshot.selectedRouteId === null).toBe(snapshot.routes.length === 0);
        if (snapshot.selectedRouteId !== null) {
          expect(snapshot.routes.some((asset) => catalog.get(snapshot.selectedRouteId as never) === asset)).toBe(true);
          expect(catalog.getSelected()).toBe(catalog.get(snapshot.selectedRouteId as never));
        }
        expect(new Set(snapshot.routes.map((asset) => asset))).toHaveProperty("size", snapshot.routes.length);
      }
    }), { numRuns: 100 });
  });
});
