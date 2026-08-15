import { describe, expect, it } from "vitest";
import { RouteLibrary } from "../src/modules/route-library/index.js";
import { makeKmz } from "./helpers/zip-fixture.js";

const bytes = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><LineString><coordinates>120,30,10 121,31,20</coordinates></LineString></Placemark></Document></kml>`);
const wpml = `<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wp="http://www.dji.com/wpmz/1.0.6"><Document><Folder>
<Placemark><Point><coordinates>120,30</coordinates></Point><wp:index>0</wp:index><wp:executeHeight>10</wp:executeHeight></Placemark>
<Placemark><Point><coordinates>121,31</coordinates></Point><wp:index>1</wp:index><wp:executeHeight>20</wp:executeHeight></Placemark>
</Folder></Document></kml>`;

describe("D3 route-library first-level contract", () => {
  it("imports a KML through the only public seam and makes it selectable and previewable", async () => {
    const created = RouteLibrary.create({ idProvider: () => "route-1", clock: () => "2026-08-10T00:00:00.000Z" });
    expect(created.ok).toBe(true);
    if (!created.ok) throw created.error;

    const imported = await created.value.importFile({ fileName: "route.kml", bytes });
    expect(imported).toMatchObject({ status: "imported", duplicate: false, route: { routeId: "route-1", format: "kml", classification: "preview-only", waypointCount: 2 } });
    expect(created.value.list()).toMatchObject([{ routeId: "route-1" }]);
    expect(created.value.getSelected()).toMatchObject({ routeId: "route-1" });
    expect(created.value.getPreview("route-1")).toMatchObject({ ok: true, value: { routeId: "route-1", polyline: [{ longitude: 120, latitude: 30 }, { longitude: 121, latitude: 31 }] } });
    expect(created.value.getMissionPayload("route-1")).toMatchObject({ ok: false, error: { code: "ROUTE_NOT_UPLOADABLE", details: { routeId: "route-1" } } });
  });

  it("rejects invalid configuration before creating a session", () => {
    expect(RouteLibrary.create({ maxFileBytes: 0 })).toMatchObject({ ok: false, error: { code: "INVALID_CONFIGURATION" } });
    expect(RouteLibrary.create({ maxExpandedBytes: 1, maxFileBytes: 2 })).toMatchObject({ ok: false, error: { code: "INVALID_CONFIGURATION" } });
  });

  it("deduplicates identical content and keeps independent output copies", async () => {
    const created = RouteLibrary.create({ idProvider: (() => { let count = 0; return () => `route-${++count}`; })(), clock: () => "2026-08-10T00:00:00.000Z" });
    if (!created.ok) throw created.error;
    const first = await created.value.importFile({ fileName: "first.kml", bytes });
    const second = await created.value.importFile({ fileName: "renamed.kml", bytes: new Uint8Array(bytes) });
    expect(first).toMatchObject({ status: "imported", duplicate: false });
    expect(second).toMatchObject({ status: "imported", duplicate: true, route: { routeId: "route-1" } });
    expect(created.value.list()).toHaveLength(1);
    const detail = created.value.get("route-1");
    if (!detail.ok) throw detail.error;
    expect(detail.value.waypoints).not.toBe((created.value.getSelected() as typeof detail.value).waypoints);
  });

  it("selects, removes, clears, and protects mission payload bytes", async () => {
    const created = RouteLibrary.create({ idProvider: (() => { let count = 0; return () => `route-${++count}`; })(), clock: () => "2026-08-10T00:00:00.000Z" });
    if (!created.ok) throw created.error;
    await created.value.importFile({ fileName: "route.kml", bytes });
    expect(created.value.select("missing")).toMatchObject({ ok: false, error: { code: "ROUTE_NOT_FOUND", details: { routeId: "missing" } } });
    expect(created.value.remove("missing")).toMatchObject({ ok: false, error: { code: "ROUTE_NOT_FOUND", details: { routeId: "missing" } } });
    expect(created.value.remove("route-1")).toMatchObject({ ok: true, value: null });
    expect(created.value.getSelected()).toBeNull();
    created.value.clear();
  });

  it("returns cancellation and identity failures without mutating the catalog", async () => {
    const cancelled = RouteLibrary.create();
    if (!cancelled.ok) throw cancelled.error;
    expect(await cancelled.value.importFile({ fileName: "route.kml", bytes }, { aborted: true })).toMatchObject({ status: "cancelled" });
    expect(cancelled.value.list()).toHaveLength(0);

    const failedIdentity = RouteLibrary.create({ idProvider: () => "bad id", clock: () => "2026-08-10T00:00:00.000Z" });
    if (!failedIdentity.ok) throw failedIdentity.error;
    expect(await failedIdentity.value.importFile({ fileName: "route.kml", bytes })).toMatchObject({ status: "rejected", error: { code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "routeId", reason: "invalid-format" } } });
    expect(failedIdentity.value.list()).toHaveLength(0);
  });

  it("hands upload-candidate KMZ bytes to mission control as an independent copy", async () => {
    const kmz = await makeKmz({ "waylines.wpml": wpml });
    const created = RouteLibrary.create({ idProvider: () => "route-1", clock: () => "2026-08-10T00:00:00.000Z" });
    if (!created.ok) throw created.error;
    expect(await created.value.importFile({ fileName: "mission.kmz", bytes: kmz })).toMatchObject({ status: "imported", route: { classification: "upload-candidate" } });
    const payload = created.value.getMissionPayload("route-1");
    expect(payload).toMatchObject({ ok: true, value: { routeId: "route-1", fileName: "mission.kmz", sizeBytes: kmz.byteLength } });
    if (!payload.ok) throw payload.error;
    expect(payload.value.bytes).not.toBe(kmz);
    payload.value.bytes[0] = 0;
    expect(created.value.getMissionPayload("route-1")).toMatchObject({ ok: true, value: { bytes: kmz } });
  });

  it("rejects missing routes and hostile input containers without an exception", async () => {
    const created = RouteLibrary.create();
    if (!created.ok) throw created.error;
    expect(created.value.get("missing")).toMatchObject({ ok: false, error: { code: "ROUTE_NOT_FOUND", details: { routeId: "missing" } } });
    expect(created.value.getPreview("missing")).toMatchObject({ ok: false, error: { code: "ROUTE_NOT_FOUND", details: { routeId: "missing" } } });
    expect(created.value.getMissionPayload("missing")).toMatchObject({ ok: false, error: { code: "ROUTE_NOT_FOUND", details: { routeId: "missing" } } });
    const hostile = Object.defineProperty({}, "fileName", { get() { throw new Error("untrusted"); } });
    expect(await created.value.importFile(hostile as never)).toMatchObject({ status: "rejected", error: { code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "input" } } });
  });
});
