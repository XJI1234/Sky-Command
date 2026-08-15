import { describe, expect, it } from "vitest";
import { RouteCatalog, type CatalogSnapshot } from "../src/modules/route-library/catalog/index.js";
import { createQualifiedRoute, createRouteAsset, createRouteId, createWaypoint } from "../src/modules/route-library/domain/index.js";

function asset(id: string, sha256: string) {
  const first = createWaypoint({ longitude: 120, latitude: 30, altitude: 10, sequence: 0 });
  const second = createWaypoint({ longitude: 121, latitude: 31, altitude: 11, sequence: 1 });
  if (!first.ok || !second.ok) throw new Error("test waypoint creation failed");
  const qualified = createQualifiedRoute({
    displayName: `${id}.kml`,
    format: "kml",
    classification: "preview-only",
    sourceDocument: `${id}.kml`,
    waypoints: [first.value, second.value],
    warnings: [],
    sha256,
    sizeBytes: 2,
    originalBytes: new Uint8Array([1, 2])
  });
  if (!qualified.ok) throw qualified.error;
  const routeId = createRouteId(id);
  if (!routeId.ok) throw routeId.error;
  const created = createRouteAsset({ qualifiedRoute: qualified.value, routeId: routeId.value, importedAt: "2026-08-10T00:00:00.000Z" });
  if (!created.ok) throw created.error;
  return created.value;
}

describe("D3.4 route catalog public contract", () => {
  it("starts empty with no selected route", () => {
    const catalog = RouteCatalog.create();

    expect(catalog.snapshot()).toEqual({ routes: [], selectedRouteId: null });
    expect(catalog.getSelected()).toBeNull();
    expect(catalog.get("missing-route" as never)).toBeNull();
    expect(catalog.findBySha256("a".repeat(64))).toBeNull();
  });

  it("adds an asset in import order and selects it", () => {
    const catalog = RouteCatalog.create();
    const first = asset("route-one", "a".repeat(64));

    const added = catalog.add(first);

    expect(added).toMatchObject({ ok: true, value: { kind: "added", asset: first } });
    expect(catalog.snapshot()).toEqual({ routes: [first], selectedRouteId: "route-one" });
    expect(catalog.getSelected()).toBe(first);
    expect(catalog.get("route-one" as never)).toBe(first);
    expect(catalog.findBySha256("a".repeat(64))).toBe(first);
  });

  it("selects an existing route and preserves state when the route is unknown", () => {
    const catalog = RouteCatalog.create();
    const first = asset("route-one", "a".repeat(64));
    const second = asset("route-two", "b".repeat(64));
    catalog.add(first);
    catalog.add(second);

    expect(catalog.select("route-one" as never)).toMatchObject({ ok: true, value: { selectedRouteId: "route-one" } });
    expect(catalog.getSelected()).toBe(first);
    expect(catalog.select("missing-route" as never)).toMatchObject({
      ok: false, error: { code: "ROUTE_NOT_FOUND", details: { routeId: "missing-route" } }
    });
    expect(catalog.getSelected()).toBe(first);
  });

  it("repairs selected route to the next route, then the previous route, on removal", () => {
    const catalog = RouteCatalog.create();
    const first = asset("route-one", "a".repeat(64));
    const second = asset("route-two", "b".repeat(64));
    const third = asset("route-three", "c".repeat(64));
    catalog.add(first);
    catalog.add(second);
    catalog.add(third);
    catalog.select("route-two" as never);

    expect(catalog.remove("route-two" as never)).toMatchObject({ ok: true, value: { selectedRouteId: "route-three" } });
    expect(catalog.getSelected()).toBe(third);
    expect(catalog.remove("route-three" as never)).toMatchObject({ ok: true, value: { selectedRouteId: "route-one" } });
    expect(catalog.getSelected()).toBe(first);
    expect(catalog.remove("route-one" as never)).toMatchObject({ ok: true, value: { routes: [], selectedRouteId: null } });
    expect(catalog.getSelected()).toBeNull();
  });

  it("de-duplicates by SHA-256 and selects the original asset", () => {
    const catalog = RouteCatalog.create();
    const first = asset("route-one", "a".repeat(64));
    const sameContent = asset("route-copy", "a".repeat(64));
    catalog.add(first);

    const duplicate = catalog.add(sameContent);

    expect(duplicate).toMatchObject({ ok: true, value: { kind: "duplicate", asset: first } });
    expect(catalog.snapshot()).toEqual({ routes: [first], selectedRouteId: "route-one" });
    expect(catalog.get("route-copy" as never)).toBeNull();
  });

  it("does not mutate state for a duplicate route id with different content", () => {
    const catalog = RouteCatalog.create();
    const first = asset("route-one", "a".repeat(64));
    const conflicting = asset("route-one", "b".repeat(64));
    catalog.add(first);

    expect(catalog.add(conflicting)).toMatchObject({
      ok: false, error: { code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "routeId", reason: "duplicate-id" } }
    });
    expect(catalog.snapshot()).toEqual({ routes: [first], selectedRouteId: "route-one" });
  });

  it("clears all routes and treats repeated clear as a no-op", () => {
    const catalog = RouteCatalog.create();
    catalog.add(asset("route-one", "a".repeat(64)));
    const firstClear = catalog.clear();

    expect(firstClear).toEqual({ routes: [], selectedRouteId: null });
    expect(catalog.clear()).toEqual(firstClear);
    expect(catalog.getSelected()).toBeNull();
  });

  it("notifies listeners after committed changes and contains listener failures", () => {
    const catalog = RouteCatalog.create();
    const received: CatalogSnapshot[] = [];
    const unsubscribe = catalog.subscribe((snapshot) => received.push(snapshot));
    catalog.subscribe(() => { throw new Error("listener failure"); });
    const first = asset("route-one", "a".repeat(64));

    expect(() => catalog.add(first)).not.toThrow();
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ routes: [first], selectedRouteId: "route-one" });
    unsubscribe();
    unsubscribe();
    catalog.clear();
    expect(received).toHaveLength(1);
  });

  it("returns the unchanged snapshot when selecting the current route", () => {
    const catalog = RouteCatalog.create();
    catalog.add(asset("route-one", "a".repeat(64)));
    const before = catalog.snapshot();

    expect(catalog.select("route-one" as never)).toEqual({ ok: true, value: before });
  });
});
