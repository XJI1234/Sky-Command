import { describe, expect, it } from "vitest";
import { RoutePreviewModel } from "../src/modules/route-library/preview/index.js";
import { createQualifiedRoute, createRouteAsset, createRouteId, createWaypoint, toDetail } from "../src/modules/route-library/domain/index.js";

function detail() {
  const first = createWaypoint({ longitude: 120, latitude: 30, altitude: 10, sequence: 0 });
  const second = createWaypoint({ longitude: 121, latitude: 31, altitude: null, sequence: 1 });
  if (!first.ok || !second.ok) throw new Error("setup");
  const route = createQualifiedRoute({
    displayName: "route.kml", format: "kml", classification: "preview-only", sourceDocument: "route.kml",
    waypoints: [first.value, second.value], warnings: [{ code: "ALTITUDE_MISSING", message: "missing altitude" }],
    sha256: "a".repeat(64), sizeBytes: 1, originalBytes: new Uint8Array([1])
  });
  if (!route.ok) throw route.error;
  const id = createRouteId("route-1");
  if (!id.ok) throw id.error;
  const asset = createRouteAsset({ qualifiedRoute: route.value, routeId: id.value, importedAt: "2026-08-10T00:00:00.000Z" });
  if (!asset.ok) throw asset.error;
  return toDetail(asset.value);
}

describe("D3.5 preview model public contract", () => {
  it("creates an engine-independent complete route preview with missing altitude preserved", () => {
    const result = RoutePreviewModel.createPreview(detail());

    expect(result).toMatchObject({
      ok: true,
      value: {
        routeId: "route-1",
        polyline: [
          { longitude: 120, latitude: 30, altitude: 10 },
          { longitude: 121, latitude: 31, altitude: null }
        ],
        startMarker: { longitude: 120, latitude: 30, altitude: 10 },
        endMarker: { longitude: 121, latitude: 31, altitude: null },
        cameraBounds: { minLongitude: 120, maxLongitude: 121, minLatitude: 30, maxLatitude: 31, minAltitude: null, maxAltitude: null }
      }
    });
  });
});
