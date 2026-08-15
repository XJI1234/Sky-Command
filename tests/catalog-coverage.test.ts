import { describe, expect, it } from "vitest";
import { RouteCatalog, type CatalogSnapshot } from "../src/modules/route-library/catalog/index.js";
import { createQualifiedRoute, createRouteAsset, createRouteId, createWaypoint, type RouteAsset } from "../src/modules/route-library/domain/index.js";

const bytes = new Uint8Array([1, 2]);

function makeAsset(id: string, sha256: string) {
  const points = [
    createWaypoint({ longitude: 120, latitude: 30, altitude: 10, sequence: 0 }),
    createWaypoint({ longitude: 121, latitude: 31, altitude: 11, sequence: 1 })
  ];
  if (!points[0].ok || !points[1].ok) throw new Error("waypoint setup failed");
  const route = createQualifiedRoute({
    displayName: `${id}.kml`, format: "kml", classification: "preview-only",
    sourceDocument: `${id}.kml`, waypoints: [points[0].value, points[1].value], warnings: [],
    sha256, sizeBytes: bytes.byteLength, originalBytes: bytes
  });
  if (!route.ok) throw route.error;
  const routeId = createRouteId(id);
  if (!routeId.ok) throw routeId.error;
  const asset = createRouteAsset({ qualifiedRoute: route.value, routeId: routeId.value, importedAt: "2026-08-10T00:00:00.000Z" });
  if (!asset.ok) throw asset.error;
  return asset.value;
}

describe("D3.4 route catalog defensive contract", () => {
  it("rejects forged assets and preserves the exact prior snapshot", () => {
    const catalog = RouteCatalog.create();
    const first = makeAsset("first", "a".repeat(64));
    catalog.add(first);
    const before = catalog.snapshot();

    expect(catalog.add({} as never)).toMatchObject({
      ok: false, error: { code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "asset", reason: "untrusted-asset" } }
    });
    expect(catalog.snapshot()).toBe(before);
  });

  it("keeps snapshots and returned arrays immutable and catalog instances isolated", () => {
    const firstCatalog = RouteCatalog.create();
    const secondCatalog = RouteCatalog.create();
    const first = makeAsset("first", "a".repeat(64));
    firstCatalog.add(first);
    const snap = firstCatalog.snapshot();

    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.routes)).toBe(true);
    expect(() => (snap.routes as RouteAsset[]).push(first)).toThrow();
    expect(secondCatalog.snapshot()).toEqual({ routes: [], selectedRouteId: null });
  });

  it("does not notify for failed operations or selecting the current route", () => {
    const catalog = RouteCatalog.create();
    const snapshots: CatalogSnapshot[] = [];
    catalog.subscribe((snapshot) => snapshots.push(snapshot));
    const first = makeAsset("first", "a".repeat(64));
    catalog.add(first);
    const count = snapshots.length;

    catalog.select("first" as never);
    catalog.select("missing" as never);
    expect(catalog.remove("missing" as never)).toMatchObject({
      ok: false, error: { code: "ROUTE_NOT_FOUND", details: { routeId: "missing" } }
    });
    expect(snapshots).toHaveLength(count);
  });

  it("keeps non-selected removal from changing selection and does not notify a selected duplicate", () => {
    const catalog = RouteCatalog.create();
    const snapshots: CatalogSnapshot[] = [];
    catalog.subscribe((snapshot) => snapshots.push(snapshot));
    const first = makeAsset("first", "a".repeat(64));
    const second = makeAsset("second", "b".repeat(64));
    catalog.add(first);
    catalog.add(second);
    catalog.select("second" as never);
    const beforeDuplicate = snapshots.length;

    catalog.add(makeAsset("copy", "a".repeat(64)));
    catalog.remove("second" as never);

    expect(catalog.getSelected()).toBe(first);
    expect(snapshots).toHaveLength(beforeDuplicate + 2);
  });

  it("preserves a later selection when removing an earlier non-selected route", () => {
    const catalog = RouteCatalog.create();
    const first = makeAsset("first", "a".repeat(64));
    const second = makeAsset("second", "b".repeat(64));
    const third = makeAsset("third", "c".repeat(64));
    catalog.add(first);
    catalog.add(second);
    catalog.add(third);

    catalog.remove("first" as never);

    expect(catalog.getSelected()).toBe(third);
  });

  it("does not notify when clearing an already empty catalog", () => {
    const catalog = RouteCatalog.create();
    let notifications = 0;
    catalog.subscribe(() => { notifications += 1; });

    catalog.clear();

    expect(notifications).toBe(0);
  });

  it("does not notify when a duplicate already is selected", () => {
    const catalog = RouteCatalog.create();
    let notifications = 0;
    catalog.subscribe(() => { notifications += 1; });
    catalog.add(makeAsset("first", "a".repeat(64)));
    const before = notifications;

    catalog.add(makeAsset("copy", "a".repeat(64)));

    expect(notifications).toBe(before);
  });

  it("commits before reentrant listeners observe or mutate the catalog", () => {
    const catalog = RouteCatalog.create();
    const observed: string[] = [];
    let nested = false;
    catalog.subscribe((snapshot) => {
      observed.push(snapshot.selectedRouteId ?? "none");
      if (!nested) {
        nested = true;
        catalog.add(makeAsset("nested", "b".repeat(64)));
      }
    });

    catalog.add(makeAsset("first", "a".repeat(64)));

    expect(observed).toEqual(["first", "nested"]);
    expect(catalog.snapshot().routes.map((route) => route === catalog.get("first" as never) ? "first" : "nested")).toEqual(["first", "nested"]);
  });
});
