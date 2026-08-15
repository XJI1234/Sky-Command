import { describe, expect, it } from "vitest";
import { RouteLibrary } from "../src/modules/route-library/index.js";

const validKml = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><LineString><coordinates>120,30,10 121,31,20</coordinates></LineString></Placemark></Document></kml>`);

async function importOne(
  options: Parameters<typeof RouteLibrary.create>[0] = {},
  fileName = "route.kml",
  bytes = validKml
) {
  const created = RouteLibrary.create(options);
  if (!created.ok) throw created.error;
  const result = await created.value.importFile({ fileName, bytes });
  return { library: created.value, result };
}

describe("D3 route-library composition defensive coverage", () => {
  it("rejects non-object configuration containers", () => {
    expect(RouteLibrary.create(null as never)).toMatchObject({ ok: false, error: { code: "INVALID_CONFIGURATION" } });
    expect(RouteLibrary.create("limits" as never)).toMatchObject({ ok: false, error: { code: "INVALID_CONFIGURATION" } });
  });

  it.each([
    { maxArchiveEntries: 0 },
    { maxExpandedBytes: 0 },
    { maxWaypoints: 0 },
    { maxFileBytes: Number.POSITIVE_INFINITY },
    { maxArchiveEntries: 1.5 },
    { maxWaypoints: Number.NaN }
  ])("rejects every invalid import limit: %j", (options) => {
    expect(RouteLibrary.create(options)).toMatchObject({ ok: false, error: { code: "INVALID_CONFIGURATION" } });
  });

  it("accepts every configurable limit when their values form a valid boundary", async () => {
    const { library, result } = await importOne({
      maxFileBytes: validKml.byteLength,
      maxArchiveEntries: 1,
      maxExpandedBytes: validKml.byteLength,
      maxWaypoints: 2,
      idProvider: () => "custom-route",
      clock: () => "2026-08-10T00:00:00.000Z"
    });
    expect(result).toMatchObject({ status: "imported", route: { routeId: "custom-route" } });
    expect(library.list()).toHaveLength(1);
  });

  it("uses isolated default identity services for each library instance", async () => {
    const first = await importOne();
    const second = await importOne();
    expect(first.result).toMatchObject({ status: "imported", route: { routeId: "route-1", importedAt: expect.any(String) } });
    expect(second.result).toMatchObject({ status: "imported", route: { routeId: "route-1", importedAt: expect.any(String) } });
  });

  it("rejects an importer failure without altering an existing catalog", async () => {
    const { library, result } = await importOne({ idProvider: () => "route-1", clock: () => "2026-08-10T00:00:00.000Z" });
    expect(result).toMatchObject({ status: "imported" });
    expect(await library.importFile({ fileName: "invalid.kml", bytes: new TextEncoder().encode("not xml") })).toMatchObject({
      status: "rejected"
    });
    expect(library.list()).toMatchObject([{ routeId: "route-1" }]);
    expect(library.getSelected()).toMatchObject({ routeId: "route-1" });
  });

  it("rejects a parsed route when qualification finds more waypoints than allowed", async () => {
    const { library, result } = await importOne({
      maxWaypoints: 1,
      idProvider: () => "route-1",
      clock: () => "2026-08-10T00:00:00.000Z"
    });
    expect(result).toMatchObject({ status: "rejected", error: { code: "TOO_MANY_WAYPOINTS" } });
    expect(library.list()).toEqual([]);
  });

  it("rejects a parsed route when qualification finds a malformed coordinate tuple", async () => {
    const malformedKml = new TextEncoder().encode(`<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><LineString><coordinates>120,30,10,20 121,31,20</coordinates></LineString></Placemark></kml>`);
    const { library, result } = await importOne({ idProvider: () => "route-1", clock: () => "2026-08-10T00:00:00.000Z" }, "malformed.kml", malformedKml);
    expect(result).toMatchObject({
      status: "rejected",
      error: { code: "INVALID_COORDINATE", details: { field: "candidate", index: 0, reason: "malformed" } }
    });
    expect(library.list()).toEqual([]);
  });

  it("rejects a second distinct route when the identity service reuses its route ID", async () => {
    const { library, result } = await importOne({ idProvider: () => "route-1", clock: () => "2026-08-10T00:00:00.000Z" });
    expect(result).toMatchObject({ status: "imported" });
    const otherBytes = new TextEncoder().encode(`<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><LineString><coordinates>122,32,30 123,33,40</coordinates></LineString></Placemark></kml>`);
    expect(await library.importFile({ fileName: "another.kml", bytes: otherBytes })).toMatchObject({
      status: "rejected",
      error: { code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "routeId", reason: "duplicate-id" } }
    });
    expect(library.list()).toMatchObject([{ routeId: "route-1" }]);
  });

  it("rejects identity-service exceptions before mutating the catalog", async () => {
    const fromIdProvider = await importOne({
      idProvider: () => { throw new Error("unavailable"); },
      clock: () => "2026-08-10T00:00:00.000Z"
    });
    expect(fromIdProvider.result).toMatchObject({ status: "rejected", error: { code: "DOMAIN_INVARIANT_VIOLATION", details: { phase: "identity" } } });
    expect(fromIdProvider.library.list()).toHaveLength(0);

    const fromClock = await importOne({
      idProvider: () => "route-1",
      clock: () => { throw new Error("unavailable"); }
    });
    expect(fromClock.result).toMatchObject({ status: "rejected", error: { code: "DOMAIN_INVARIANT_VIOLATION", details: { phase: "identity" } } });
    expect(fromClock.library.list()).toHaveLength(0);
  });

  it("rejects a non-canonical clock value before adding the route", async () => {
    const { library, result } = await importOne({ idProvider: () => "route-1", clock: () => "2026-08-10" });
    expect(result).toMatchObject({ status: "rejected", error: { code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "importedAt" } } });
    expect(library.list()).toEqual([]);
  });

  it("rejects malformed route identifiers through every route-facing command", async () => {
    const { library } = await importOne({ idProvider: () => "route-1", clock: () => "2026-08-10T00:00:00.000Z" });
    for (const command of [library.get, library.select, library.remove, library.getPreview, library.getMissionPayload]) {
      expect(command("not a route id")).toMatchObject({ ok: false, error: { code: "ROUTE_NOT_FOUND", details: { routeId: "not a route id" } } });
    }
  });

  it("returns fresh summaries and details and clears a populated session", async () => {
    const ids = ["route-1", "route-2"];
    const { library } = await importOne({ idProvider: () => ids.shift() as string, clock: () => "2026-08-10T00:00:00.000Z" });
    const otherBytes = new TextEncoder().encode(`<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><LineString><coordinates>122,32,30 123,33,40</coordinates></LineString></Placemark></kml>`);
    expect(await library.importFile({ fileName: "other.kml", bytes: otherBytes })).toMatchObject({ status: "imported", route: { routeId: "route-2" } });
    expect(library.select("route-1")).toMatchObject({ ok: true, value: { routeId: "route-1" } });
    expect(library.getSelected()).toMatchObject({ routeId: "route-1" });
    expect(library.remove("route-2")).toMatchObject({ ok: true, value: { routeId: "route-1" } });
    expect(library.list()).not.toBe(library.list());
    expect(library.get("route-1")).not.toBe(library.get("route-1"));
    library.clear();
    expect(library.list()).toEqual([]);
    expect(library.getSelected()).toBeNull();
  });
});
