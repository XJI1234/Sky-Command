import { describe, expect, it } from "vitest";
import { RoutePlanningDomain } from "../src/modules/route-planning/planning-domain/index.js";

describe("planning-domain contract", () => {
  it("creates clockwise orbit waypoints starting due north", () => {
    const result = RoutePlanningDomain.planOrbit({ center: { longitude: 120, latitude: 30 }, edge: { longitude: 120, latitude: 30.001 }, altitudeMeters: 80, waypointCount: 4 });
    expect(result).toMatchObject({ ok: true, value: { kind: "orbit", altitudeMeters: 80, waypoints: [{ sequence: 0, longitude: 120 }, { sequence: 1 }, { sequence: 2 }, { sequence: 3 }] } });
    if (!result.ok) throw new Error("expected a valid orbit plan");
    expect(result.value.radiusMeters).toBeCloseTo(111.319, 3);
    expect(result.value.waypoints[0].latitude).toBeGreaterThan(30);
    expect(result.value.waypoints[1].longitude).toBeGreaterThan(120);
    expect(result.value.waypoints[0].latitude).toBeCloseTo(30.001, 6);
    expect(result.value.waypoints[1].longitude).toBeCloseTo(120.0011547, 6);
    expect(result.value.waypoints[2].latitude).toBeCloseTo(29.999, 6);
    expect(result.value.waypoints[3].longitude).toBeCloseTo(119.9988453, 6);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.waypoints)).toBe(true);
  });

  it.each([
    [null, { code: "INVALID_INPUT", field: "input", reason: "invalid-container" }],
    ["not-an-object", { code: "INVALID_INPUT", field: "input", reason: "invalid-container" }],
    [{ center: { longitude: 181, latitude: 0 }, edge: { longitude: 0, latitude: 0 }, altitudeMeters: 80, waypointCount: 4 }, { code: "INVALID_COORDINATE", field: "point", reason: "invalid-coordinate" }],
    [{ center: { longitude: 120, latitude: 30 }, edge: { longitude: 120, latitude: 30.001 }, altitudeMeters: 0, waypointCount: 4 }, { code: "INVALID_ALTITUDE", field: "altitudeMeters", reason: "out-of-range" }],
    [{ center: { longitude: 120, latitude: 30 }, edge: { longitude: 120, latitude: 30.001 }, altitudeMeters: 80, waypointCount: 3 }, { code: "INVALID_WAYPOINT_COUNT", field: "waypointCount", reason: "out-of-range" }]
  ])("returns the stable error shape for invalid input", (input, error) => {
    expect(RoutePlanningDomain.planOrbit(input)).toEqual({ ok: false, error: { code: error.code, details: { field: error.field, reason: error.reason } } });
  });

  it("rejects an invalid radius and isolates hostile getters", () => {
    expect(RoutePlanningDomain.planOrbit({ center: { longitude: 120, latitude: 30 }, edge: { longitude: 120, latitude: 30 }, altitudeMeters: 80, waypointCount: 4 })).toEqual({ ok: false, error: { code: "INVALID_RADIUS", details: { field: "radiusMeters", reason: "out-of-range" } } });
    const hostile = new Proxy({}, { get() { throw new Error("secret"); } });
    const result = RoutePlanningDomain.planOrbit(hostile);
    expect(result).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "input", reason: "unreadable" } } });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("normalizes antimeridian longitudes and isolates input copies", () => {
    const input = { center: { longitude: 179.999, latitude: 0 }, edge: { longitude: -179.991, latitude: 0 }, altitudeMeters: 1, waypointCount: 4 };
    const result = RoutePlanningDomain.planOrbit(input);
    if (!result.ok) throw new Error("expected a valid orbit plan");
    input.center.longitude = 0;
    expect(result.value.center.longitude).toBe(179.999);
    expect(result.value.waypoints.every((point) => point.longitude >= -180 && point.longitude <= 180)).toBe(true);
    expect(Object.isFrozen(result.value.center)).toBe(true);
    expect(Object.isFrozen(result.value.waypoints[0])).toBe(true);
  });

  it.each([
    [{ longitude: -180, latitude: -90 }, { longitude: -180, latitude: -89.999 }, 1, 4],
    [{ longitude: 180, latitude: 90 }, { longitude: 180, latitude: 89.999 }, 500, 360]
  ])("accepts inclusive coordinate, altitude, and waypoint bounds", (center, edge, altitudeMeters, waypointCount) => {
    expect(RoutePlanningDomain.planOrbit({ center, edge, altitudeMeters, waypointCount })).toMatchObject({ ok: true });
  });

  it.each([
    [{ longitude: -180.001, latitude: 0 }, { longitude: 0, latitude: 0 }],
    [{ longitude: 180.001, latitude: 0 }, { longitude: 0, latitude: 0 }],
    [{ longitude: 0, latitude: -90.001 }, { longitude: 0, latitude: 0 }],
    [{ longitude: 0, latitude: 90.001 }, { longitude: 0, latitude: 0 }],
    [{ longitude: Number.NaN, latitude: 0 }, { longitude: 0, latitude: 0 }]
  ])("rejects each non-finite or out-of-range coordinate", (center, edge) => {
    expect(RoutePlanningDomain.planOrbit({ center, edge, altitudeMeters: 80, waypointCount: 4 })).toEqual({ ok: false, error: { code: "INVALID_COORDINATE", details: { field: "point", reason: "invalid-coordinate" } } });
  });

  it.each([null, 7, "point", [], { longitude: 120 }, { latitude: 30 }])("rejects non-point containers and incomplete points", (center) => {
    expect(RoutePlanningDomain.planOrbit({ center, edge: { longitude: 120, latitude: 30.001 }, altitudeMeters: 80, waypointCount: 4 })).toEqual({ ok: false, error: { code: "INVALID_COORDINATE", details: { field: "point", reason: "invalid-coordinate" } } });
  });

  it.each([
    ["80", "invalid-type"],
    [Number.NaN, "not-finite"],
    [500.001, "out-of-range"]
  ])("rejects an invalid altitude with its diagnostic reason", (altitudeMeters, reason) => {
    expect(RoutePlanningDomain.planOrbit({ center: { longitude: 120, latitude: 30 }, edge: { longitude: 120, latitude: 30.001 }, altitudeMeters, waypointCount: 4 })).toEqual({ ok: false, error: { code: "INVALID_ALTITUDE", details: { field: "altitudeMeters", reason } } });
  });

  it.each([
    ["4", "invalid-type"],
    [4.5, "not-safe-integer"],
    [361, "out-of-range"]
  ])("rejects an invalid waypoint count with its diagnostic reason", (waypointCount, reason) => {
    expect(RoutePlanningDomain.planOrbit({ center: { longitude: 120, latitude: 30 }, edge: { longitude: 120, latitude: 30.001 }, altitudeMeters: 80, waypointCount })).toEqual({ ok: false, error: { code: "INVALID_WAYPOINT_COUNT", details: { field: "waypointCount", reason } } });
  });

  it("calculates a non-degenerate WGS84 equirectangular radius", () => {
    const result = RoutePlanningDomain.planOrbit({ center: { longitude: 120, latitude: 30 }, edge: { longitude: 120.001, latitude: 30.001 }, altitudeMeters: 80, waypointCount: 4 });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected a valid orbit plan");
    expect(result.value.radiusMeters).toBeCloseTo(147.26152637484657, 8);
    expect(result.value.waypoints[0].longitude).toBe(120);
    expect(result.value.waypoints[0].latitude).toBeCloseTo(30.001322872799037, 10);
    expect(result.value.waypoints[1].longitude).toBeCloseTo(120.00152752193321, 10);
    expect(result.value.waypoints[1].latitude).toBe(30);
  });

  it.each([1, 2_000])("accepts the exact radius boundary: %d metres", (meters) => {
    const latitudeOffset = meters / 6_378_137 * 180 / Math.PI;
    const result = RoutePlanningDomain.planOrbit({ center: { longitude: 0, latitude: 0 }, edge: { longitude: 0, latitude: latitudeOffset }, altitudeMeters: 80, waypointCount: 4 });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected a valid boundary radius");
    expect(result.value.radiusMeters).toBeCloseTo(meters, 9);
  });

  it.each([0.999, 2_000.001])("rejects a radius outside its inclusive boundary: %d metres", (meters) => {
    const latitudeOffset = meters / 6_378_137 * 180 / Math.PI;
    expect(RoutePlanningDomain.planOrbit({ center: { longitude: 0, latitude: 0 }, edge: { longitude: 0, latitude: latitudeOffset }, altitudeMeters: 80, waypointCount: 4 })).toEqual({ ok: false, error: { code: "INVALID_RADIUS", details: { field: "radiusMeters", reason: "out-of-range" } } });
  });

  it("accepts distances within its documented floating-point boundary tolerance", () => {
    const lowRadius = 1 - 0.000000001;
    const highRadius = 2_000 + 0.0000000005;
    for (const meters of [lowRadius, highRadius]) {
      const latitudeOffset = meters / 6_378_137 * 180 / Math.PI;
      expect(RoutePlanningDomain.planOrbit({ center: { longitude: 0, latitude: 0 }, edge: { longitude: 0, latitude: latitudeOffset }, altitudeMeters: 80, waypointCount: 4 })).toMatchObject({ ok: true });
    }
  });
});
