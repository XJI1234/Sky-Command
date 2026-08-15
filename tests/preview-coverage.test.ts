import { describe, expect, it } from "vitest";
import { RoutePreviewModel } from "../src/modules/route-library/preview/index.js";

const valid = {
  routeId: "route-1", displayName: "route.kml", format: "kml", classification: "preview-only", sourceDocument: "route.kml",
  waypoints: Object.freeze([
    Object.freeze({ longitude: -1, latitude: -2, altitude: -5, sequence: 0 }),
    Object.freeze({ longitude: 3, latitude: 4, altitude: 0, sequence: 1 }),
    Object.freeze({ longitude: 2, latitude: 1, altitude: 9, sequence: 2 })
  ]), warnings: Object.freeze([]), sha256: "a".repeat(64), sizeBytes: 1, importedAt: "2026-08-10T00:00:00.000Z"
} as never;

describe("D3.5 preview model defensive contract", () => {
  it("calculates numeric bounds and freezes every output layer", () => {
    const result = RoutePreviewModel.createPreview(valid);
    expect(result).toMatchObject({ ok: true, value: { cameraBounds: { minLongitude: -1, maxLongitude: 3, minLatitude: -2, maxLatitude: 4, minAltitude: -5, maxAltitude: 9 } } });
    if (!result.ok) throw result.error;
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.polyline)).toBe(true);
    expect(Object.isFrozen(result.value.cameraBounds)).toBe(true);
  });

  it("rejects each malformed top-level detail shape with the stable invalid-input error", () => {
    const cases = [
      null,
      7,
      { routeId: 7, waypoints: valid.waypoints },
      { routeId: "route-1", waypoints: null },
      { routeId: "route-1", waypoints: [] },
      { routeId: "route-1", waypoints: [valid.waypoints[0]] }
    ];
    for (const input of cases) {
      expect(RoutePreviewModel.createPreview(input as never)).toMatchObject({
        ok: false,
        error: { code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "detail", reason: "invalid-preview-input" } }
      });
    }
  });

  it("rejects each malformed waypoint field without returning a partial preview", () => {
    const second = valid.waypoints[1];
    const malformedWaypoints = [
      null,
      7,
      { ...valid.waypoints[0], sequence: 7 },
      { ...valid.waypoints[0], longitude: "120" },
      { ...valid.waypoints[0], longitude: Number.POSITIVE_INFINITY },
      { ...valid.waypoints[0], latitude: "30" },
      { ...valid.waypoints[0], latitude: Number.NaN },
      { ...valid.waypoints[0], altitude: "10" },
      { ...valid.waypoints[0], altitude: Number.NEGATIVE_INFINITY }
    ];
    for (const first of malformedWaypoints) {
      expect(RoutePreviewModel.createPreview({ ...valid, waypoints: [first, second] } as never)).toMatchObject({
        ok: false,
        error: { code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "detail", reason: "invalid-preview-input" } }
      });
    }
  });

  it("turns throwing property access into the stable invalid-input error", () => {
    const throwingDetail = Object.defineProperty({}, "routeId", {
      get() { throw new Error("untrusted getter"); }
    });
    expect(RoutePreviewModel.createPreview(throwingDetail as never)).toMatchObject({
      ok: false,
      error: { code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "detail", reason: "invalid-preview-input" } }
    });
  });

  it("turns a throwing waypoint getter into the stable invalid-input error", () => {
    const throwingWaypoint = Object.defineProperty({}, "sequence", {
      get() { throw new Error("untrusted waypoint getter"); }
    });
    expect(RoutePreviewModel.createPreview({ ...valid, waypoints: [throwingWaypoint, valid.waypoints[1]] } as never)).toMatchObject({
      ok: false,
      error: { code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "detail", reason: "invalid-preview-input" } }
    });
  });

  it("rejects callable forged details and waypoints", () => {
    const forgedDetail = Object.assign(() => undefined, { routeId: "route-1", waypoints: valid.waypoints });
    const forgedWaypoint = Object.assign(() => undefined, valid.waypoints[0]);
    expect(RoutePreviewModel.createPreview(forgedDetail as never)).toMatchObject({ ok: false });
    expect(RoutePreviewModel.createPreview({ ...valid, waypoints: [forgedWaypoint, valid.waypoints[1]] } as never)).toMatchObject({ ok: false });
  });

  it("uses defensive frozen marker copies rather than aliases to polyline points", () => {
    const result = RoutePreviewModel.createPreview(valid);
    if (!result.ok) throw result.error;
    expect(result.value.startMarker).not.toBe(result.value.polyline[0]);
    expect(result.value.endMarker).not.toBe(result.value.polyline.at(-1));
    expect(Object.isFrozen(result.value.startMarker)).toBe(true);
    expect(Object.isFrozen(result.value.endMarker)).toBe(true);
  });

  it("keeps altitude bounds unknown when the first waypoint lacks altitude", () => {
    const input = {
      ...valid,
      waypoints: [
        { longitude: 10, latitude: 20, altitude: null, sequence: 0 },
        { longitude: 11, latitude: 21, altitude: -10, sequence: 1 },
        { longitude: 9, latitude: 19, altitude: 20, sequence: 2 }
      ]
    } as never;
    expect(RoutePreviewModel.createPreview(input)).toMatchObject({
      ok: true,
      value: { cameraBounds: { minLongitude: 9, maxLongitude: 11, minLatitude: 19, maxLatitude: 21, minAltitude: null, maxAltitude: null } }
    });
  });

  it("does not retain or mutate its input", () => {
    const input = structuredClone(valid);
    const result = RoutePreviewModel.createPreview(input as never);
    expect(result.ok).toBe(true);
    input.waypoints[0].longitude = 99;
    if (result.ok) expect(result.value.polyline[0]?.longitude).toBe(-1);
  });

  it("returns independent immutable previews for repeated calls", () => {
    const first = RoutePreviewModel.createPreview(valid);
    const second = RoutePreviewModel.createPreview(valid);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value).toEqual(first.value);
    expect(second.value).not.toBe(first.value);
    expect(second.value.polyline).not.toBe(first.value.polyline);
    expect(second.value.cameraBounds).not.toBe(first.value.cameraBounds);
  });
});
