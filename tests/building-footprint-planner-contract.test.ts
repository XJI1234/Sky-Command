import { describe, expect, it } from "vitest";
import { RoutePlanningBuildingFootprint } from "../src/modules/route-planning/building-footprint-planner/index.js";

const EARTH_RADIUS_METERS = 6_378_137;
const metresToDegrees = (metres: number): number => metres / EARTH_RADIUS_METERS * 180 / Math.PI;
const squareFootprint = () => {
  const delta = metresToDegrees(10);
  return [
    { longitude: 0, latitude: 0 },
    { longitude: delta, latitude: 0 },
    { longitude: delta, latitude: delta },
    { longitude: 0, latitude: delta }
  ];
};

describe("building-footprint-planner contract", () => {
  it("offsets a square outward and samples each facade at the configured maximum spacing", () => {
    const delta = metresToDegrees(10);
    const result = RoutePlanningBuildingFootprint.plan({ footprint: squareFootprint(), altitudeMeters: 80, standOffMeters: 5, maxSegmentLengthMeters: 10 });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected a building footprint plan");

    expect(result.value).toMatchObject({ kind: "building-footprint", altitudeMeters: 80, standOffMeters: 5 });
    expect(result.value.envelope).toHaveLength(4);
    expect(result.value.waypoints).toHaveLength(8);
    expect(result.value.waypoints.map((waypoint) => waypoint.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(result.value.envelope[0]!.longitude).toBeCloseTo(-delta / 2, 10);
    expect(result.value.envelope[0]!.latitude).toBeCloseTo(-delta / 2, 10);
    expect(result.value.envelope[2]!.longitude).toBeCloseTo(delta * 1.5, 10);
    expect(result.value.envelope[2]!.latitude).toBeCloseTo(delta * 1.5, 10);
    expect(result.value.waypoints[0]).toMatchObject({ facadeIndex: 0, facadeFraction: 0.25, altitudeMeters: 80 });
    expect(result.value.waypoints[1]).toMatchObject({ facadeIndex: 0, facadeFraction: 0.75, altitudeMeters: 80 });
    expect(result.value.waypoints[2]).toMatchObject({ facadeIndex: 1, facadeFraction: 0.25, altitudeMeters: 80 });
    expect(result.value.waypoints[0]!.longitude).toBeCloseTo(0, 10);
    expect(result.value.waypoints[0]!.latitude).toBeCloseTo(-delta / 2, 10);
    expect(result.value.waypoints[1]!.longitude).toBeCloseTo(delta, 10);
    expect(result.value.waypoints[2]!.longitude).toBeCloseTo(delta * 1.5, 10);
    expect(result.value.waypoints[2]!.latitude).toBeCloseTo(0, 10);
    expect(result.value.waypoints[3]!.latitude).toBeCloseTo(delta, 10);
  });

  it("canonicalizes input winding and start vertex while preserving a source copy", () => {
    const footprint = squareFootprint();
    const forward = RoutePlanningBuildingFootprint.plan({ footprint, altitudeMeters: 80, standOffMeters: 5, maxSegmentLengthMeters: 10 });
    const reverseShifted = RoutePlanningBuildingFootprint.plan({ footprint: [footprint[2]!, footprint[1]!, footprint[0]!, footprint[3]!], altitudeMeters: 80, standOffMeters: 5, maxSegmentLengthMeters: 10 });
    if (!forward.ok || !reverseShifted.ok) throw new Error("expected valid plans");
    expect(reverseShifted.value.envelope).toEqual(forward.value.envelope);
    expect(reverseShifted.value.waypoints).toEqual(forward.value.waypoints);
    footprint[0]!.longitude = 123;
    expect(forward.value.sourceFootprint[0]!.longitude).toBe(0);
  });

  it("uses the convex hull as a safe envelope for a concave footprint", () => {
    const delta = metresToDegrees(10);
    const result = RoutePlanningBuildingFootprint.plan({
      footprint: [
        { longitude: 0, latitude: 0 },
        { longitude: delta * 2, latitude: 0 },
        { longitude: delta * 2, latitude: delta * 2 },
        { longitude: delta, latitude: delta },
        { longitude: 0, latitude: delta * 2 }
      ],
      altitudeMeters: 80,
      standOffMeters: 5,
      maxSegmentLengthMeters: 10
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected a concave footprint plan");
    expect(result.value.sourceFootprint).toHaveLength(5);
    expect(result.value.envelope).toHaveLength(4);
    expect(result.value.waypoints.every((waypoint) => Number.isFinite(waypoint.longitude) && Number.isFinite(waypoint.latitude))).toBe(true);
  });

  it("normalizes output longitudes around the international date line", () => {
    const delta = metresToDegrees(10);
    const result = RoutePlanningBuildingFootprint.plan({
      footprint: [
        { longitude: 179.9999, latitude: 0 },
        { longitude: -179.9999, latitude: 0 },
        { longitude: -179.9999, latitude: delta },
        { longitude: 179.9999, latitude: delta }
      ],
      altitudeMeters: 80,
      standOffMeters: 2,
      maxSegmentLengthMeters: 10
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected a date-line footprint plan");
    expect(result.value.envelope.every((point) => point.longitude >= -180 && point.longitude <= 180)).toBe(true);
    expect(result.value.waypoints.every((point) => point.longitude >= -180 && point.longitude <= 180)).toBe(true);
  });

  it("keeps an offset distance stable for a footprint away from the equator", () => {
    const delta = metresToDegrees(10);
    const result = RoutePlanningBuildingFootprint.plan({
      footprint: [
        { longitude: 120, latitude: 30 },
        { longitude: 120 + delta, latitude: 30 },
        { longitude: 120 + delta, latitude: 30 + delta },
        { longitude: 120, latitude: 30 + delta }
      ],
      altitudeMeters: 80,
      standOffMeters: 5,
      maxSegmentLengthMeters: 10
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected a non-equatorial plan");
    expect(result.value.envelope[0]!.longitude).toBeCloseTo(119.99994813571948, 10);
    expect(result.value.envelope[0]!.latitude).toBeCloseTo(29.999955084235794, 10);
    expect(result.value.envelope[2]!.longitude).toBeCloseTo(120.0001416958089, 10);
    expect(result.value.envelope[2]!.latitude).toBeCloseTo(30.00013474729262, 10);
  });

  it("creates a deterministic offset envelope for a rotated triangle", () => {
    const result = RoutePlanningBuildingFootprint.plan({
      footprint: [
        { longitude: metresToDegrees(0), latitude: metresToDegrees(0) },
        { longitude: metresToDegrees(20), latitude: metresToDegrees(5) },
        { longitude: metresToDegrees(5), latitude: metresToDegrees(15) }
      ],
      altitudeMeters: 80,
      standOffMeters: 3,
      maxSegmentLengthMeters: 10
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected a rotated triangle plan");
    expect(result.value.envelope).toEqual([
      { longitude: -0.00004109110420813522, latitude: -0.00003805164207361338 },
      { longitude: 0.0002453009667533479, latitude: 0.000033546375702883104 },
      { longitude: 0.00003050691350381385, latitude: 0.00017674241125587608 }
    ]);
  });

  it.each([
    [null, { code: "INVALID_INPUT", field: "input", reason: "invalid-container" }],
    [{ footprint: [], altitudeMeters: 80, standOffMeters: 5, maxSegmentLengthMeters: 10 }, { code: "INVALID_FOOTPRINT", field: "footprint", reason: "too-few-points" }],
    [{ footprint: [{ longitude: 0, latitude: 0 }, { longitude: 1, latitude: 1 }, { longitude: 2, latitude: 2 }], altitudeMeters: 80, standOffMeters: 5, maxSegmentLengthMeters: 10 }, { code: "INVALID_FOOTPRINT", field: "footprint", reason: "degenerate" }],
    [{ footprint: squareFootprint(), altitudeMeters: 0, standOffMeters: 5, maxSegmentLengthMeters: 10 }, { code: "INVALID_ALTITUDE", field: "altitudeMeters", reason: "out-of-range" }],
    [{ footprint: squareFootprint(), altitudeMeters: 80, standOffMeters: 0, maxSegmentLengthMeters: 10 }, { code: "INVALID_STANDOFF", field: "standOffMeters", reason: "out-of-range" }],
    [{ footprint: squareFootprint(), altitudeMeters: 80, standOffMeters: 5, maxSegmentLengthMeters: 0 }, { code: "INVALID_SEGMENT_LENGTH", field: "maxSegmentLengthMeters", reason: "out-of-range" }]
  ])("returns stable errors for invalid inputs", (input, error) => {
    expect(RoutePlanningBuildingFootprint.plan(input)).toEqual({ ok: false, error: { code: error.code, details: { field: error.field, reason: error.reason } } });
  });

  it.each([
    [undefined, "INVALID_INPUT", "input", "invalid-container"],
    [{ footprint: null, altitudeMeters: 80, standOffMeters: 5, maxSegmentLengthMeters: 10 }, "INVALID_FOOTPRINT", "footprint", "invalid-container"],
    [{ footprint: [{ longitude: 0, latitude: 0 }, { longitude: Number.NaN, latitude: 0 }, { longitude: 0, latitude: 1 }], altitudeMeters: 80, standOffMeters: 5, maxSegmentLengthMeters: 10 }, "INVALID_FOOTPRINT", "footprint", "invalid-coordinate"],
    [{ footprint: [{ longitude: 0, latitude: 90 }, { longitude: 1, latitude: 0 }, { longitude: 0, latitude: 1 }], altitudeMeters: 80, standOffMeters: 5, maxSegmentLengthMeters: 10 }, "INVALID_FOOTPRINT", "footprint", "invalid-coordinate"],
    [{ footprint: squareFootprint(), altitudeMeters: "80", standOffMeters: 5, maxSegmentLengthMeters: 10 }, "INVALID_ALTITUDE", "altitudeMeters", "invalid-type"],
    [{ footprint: squareFootprint(), altitudeMeters: Number.NaN, standOffMeters: 5, maxSegmentLengthMeters: 10 }, "INVALID_ALTITUDE", "altitudeMeters", "not-finite"],
    [{ footprint: squareFootprint(), altitudeMeters: 80, standOffMeters: "5", maxSegmentLengthMeters: 10 }, "INVALID_STANDOFF", "standOffMeters", "invalid-type"],
    [{ footprint: squareFootprint(), altitudeMeters: 80, standOffMeters: Number.POSITIVE_INFINITY, maxSegmentLengthMeters: 10 }, "INVALID_STANDOFF", "standOffMeters", "not-finite"],
    [{ footprint: squareFootprint(), altitudeMeters: 80, standOffMeters: 5, maxSegmentLengthMeters: "10" }, "INVALID_SEGMENT_LENGTH", "maxSegmentLengthMeters", "invalid-type"],
    [{ footprint: squareFootprint(), altitudeMeters: 80, standOffMeters: 5, maxSegmentLengthMeters: Number.NEGATIVE_INFINITY }, "INVALID_SEGMENT_LENGTH", "maxSegmentLengthMeters", "not-finite"]
  ])("distinguishes invalid field types and non-finite values", (input, code, field, reason) => {
    expect(RoutePlanningBuildingFootprint.plan(input)).toEqual({ ok: false, error: { code, details: { field, reason } } });
  });

  it.each([
    [500, "success"],
    [500.000001, "failure"]
  ])("enforces the altitude upper boundary: %d metres", (altitudeMeters, expected) => {
    const result = RoutePlanningBuildingFootprint.plan({ footprint: squareFootprint(), altitudeMeters, standOffMeters: 5, maxSegmentLengthMeters: 10 });
    if (expected === "success") {
      expect(result).toMatchObject({ ok: true });
      return;
    }
    expect(result).toEqual({ ok: false, error: { code: "INVALID_ALTITUDE", details: { field: "altitudeMeters", reason: "out-of-range" } } });
  });

  it.each([
    [[{ longitude: 180, latitude: 0 }, { longitude: 179.999, latitude: 0 }, { longitude: 179.999, latitude: 0.001 }]],
    [[{ longitude: -180, latitude: 0 }, { longitude: -179.999, latitude: 0 }, { longitude: -179.999, latitude: 0.001 }]],
    [[{ longitude: 0, latitude: 89.999 }, { longitude: 0.001, latitude: 89.999 }, { longitude: 0, latitude: 89.998 }]],
    [[{ longitude: 0, latitude: -89.999 }, { longitude: 0.001, latitude: -89.999 }, { longitude: 0, latitude: -89.998 }]]
  ])("accepts each inclusive coordinate boundary", (footprint) => {
    const result = RoutePlanningBuildingFootprint.plan({ footprint, altitudeMeters: 80, standOffMeters: 1, maxSegmentLengthMeters: 2_000 });
    expect(result).toMatchObject({ ok: true });
  });

  it("accepts exact standoff and segment-length upper boundaries", () => {
    expect(RoutePlanningBuildingFootprint.plan({ footprint: squareFootprint(), altitudeMeters: 80, standOffMeters: 2_000, maxSegmentLengthMeters: 2_000 })).toMatchObject({ ok: true });
  });

  it.each([
    { longitude: -180.000001, latitude: 0 },
    { longitude: 180.000001, latitude: 0 },
    { longitude: 0, latitude: -89.999001 },
    { longitude: 0, latitude: 89.999001 },
    { longitude: 0, latitude: Number.NaN }
  ])("rejects each coordinate outside the documented footprint range", (invalidPoint) => {
    const footprint = squareFootprint();
    footprint[0] = invalidPoint;
    expect(RoutePlanningBuildingFootprint.plan({ footprint, altitudeMeters: 80, standOffMeters: 5, maxSegmentLengthMeters: 10 })).toEqual({ ok: false, error: { code: "INVALID_FOOTPRINT", details: { field: "footprint", reason: "invalid-coordinate" } } });
  });

  it("accepts exactly one thousand valid footprint points", () => {
    const radiusDegrees = metresToDegrees(20);
    const footprint = Array.from({ length: 1_000 }, (_, index) => {
      const angle = index * 2 * Math.PI / 1_000;
      return { longitude: Math.cos(angle) * radiusDegrees, latitude: Math.sin(angle) * radiusDegrees };
    });
    const result = RoutePlanningBuildingFootprint.plan({ footprint, altitudeMeters: 80, standOffMeters: 1, maxSegmentLengthMeters: 2_000 });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected the point-count boundary to be accepted");
    expect(result.value.sourceFootprint).toHaveLength(1_000);
  });

  it("removes a collinear hull point instead of creating an extra facade", () => {
    const delta = metresToDegrees(10);
    const result = RoutePlanningBuildingFootprint.plan({
      footprint: [{ longitude: 0, latitude: 0 }, { longitude: delta, latitude: 0 }, { longitude: delta * 2, latitude: 0 }, { longitude: delta * 2, latitude: delta * 2 }, { longitude: 0, latitude: delta * 2 }],
      altitudeMeters: 80,
      standOffMeters: 5,
      maxSegmentLengthMeters: 10
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected a valid collinear footprint plan");
    expect(result.value.envelope).toHaveLength(4);
  });

  it("removes adjacent duplicates and an explicit closing point from the source footprint", () => {
    const footprint = squareFootprint();
    const result = RoutePlanningBuildingFootprint.plan({
      footprint: [footprint[0]!, footprint[0]!, footprint[1]!, footprint[2]!, footprint[3]!, footprint[0]!],
      altitudeMeters: 80,
      standOffMeters: 5,
      maxSegmentLengthMeters: 10
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected a valid de-duplicated plan");
    expect(result.value.sourceFootprint).toEqual(squareFootprint());
  });

  it("rejects a footprint with too many points before doing geometry work", () => {
    const result = RoutePlanningBuildingFootprint.plan({
      footprint: Array.from({ length: 1_001 }, () => ({ longitude: 0, latitude: 0 })),
      altitudeMeters: 80,
      standOffMeters: 5,
      maxSegmentLengthMeters: 10
    });
    expect(result).toEqual({ ok: false, error: { code: "INVALID_FOOTPRINT", details: { field: "footprint", reason: "too-many-points" } } });
  });

  it("rejects a non-consecutive duplicate footprint with fewer than three unique geometry points", () => {
    const result = RoutePlanningBuildingFootprint.plan({
      footprint: [{ longitude: 0, latitude: 0 }, { longitude: 0.001, latitude: 0 }, { longitude: 0, latitude: 0 }, { longitude: 0.001, latitude: 0 }],
      altitudeMeters: 80,
      standOffMeters: 5,
      maxSegmentLengthMeters: 10
    });
    expect(result).toEqual({ ok: false, error: { code: "INVALID_FOOTPRINT", details: { field: "footprint", reason: "degenerate" } } });
  });

  it("returns a frozen failure for a hostile getter without exposing its exception", () => {
    const hostile = new Proxy({}, { get() { throw new Error("secret"); } });
    const result = RoutePlanningBuildingFootprint.plan(hostile);
    expect(result).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "input", reason: "unreadable" } } });
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("将原始轮廓元素视为无效坐标", () => {
    expect(RoutePlanningBuildingFootprint.plan({ footprint: ["invalid", { longitude: 0, latitude: 0 }, { longitude: 0.001, latitude: 0 }], altitudeMeters: 80, standOffMeters: 5, maxSegmentLengthMeters: 10 })).toEqual({ ok: false, error: { code: "INVALID_FOOTPRINT", details: { field: "footprint", reason: "invalid-coordinate" } } });
  });

  it("contains a hostile footprint iterator as an unreadable input", () => {
    const hostileFootprint = new Proxy([], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) throw new Error("secret-iterator");
        return Reflect.get(target, property, receiver);
      }
    });
    expect(RoutePlanningBuildingFootprint.plan({ footprint: hostileFootprint, altitudeMeters: 80, standOffMeters: 5, maxSegmentLengthMeters: 10 })).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "input", reason: "unreadable" } } });
  });

  it("rejects a footprint point with an unreadable coordinate getter", () => {
    const hostilePoint = new Proxy({}, { get() { throw new Error("secret-coordinate"); } });
    expect(RoutePlanningBuildingFootprint.plan({ footprint: [hostilePoint, { longitude: 0, latitude: 0 }, { longitude: 0.001, latitude: 0 }], altitudeMeters: 80, standOffMeters: 5, maxSegmentLengthMeters: 10 })).toEqual({ ok: false, error: { code: "INVALID_FOOTPRINT", details: { field: "footprint", reason: "invalid-coordinate" } } });
  });

  it("freezes all successful result containers", () => {
    const result = RoutePlanningBuildingFootprint.plan({ footprint: squareFootprint(), altitudeMeters: 80, standOffMeters: 5, maxSegmentLengthMeters: 10 });
    if (!result.ok) throw new Error("expected a valid plan");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.sourceFootprint)).toBe(true);
    expect(Object.isFrozen(result.value.sourceFootprint[0]!)).toBe(true);
    expect(Object.isFrozen(result.value.envelope)).toBe(true);
    expect(Object.isFrozen(result.value.envelope[0]!)).toBe(true);
    expect(Object.isFrozen(result.value.waypoints)).toBe(true);
    expect(Object.isFrozen(result.value.waypoints[0]!)).toBe(true);
  });

  it("exposes only an immutable enumerable planning operation", () => {
    expect(Object.getPrototypeOf(RoutePlanningBuildingFootprint)).toBe(null);
    expect(Object.isFrozen(RoutePlanningBuildingFootprint)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(RoutePlanningBuildingFootprint, "plan")).toEqual({ value: RoutePlanningBuildingFootprint.plan, enumerable: true, writable: false, configurable: false });
  });

  it("rejects a plan that would exceed the waypoint safety limit", () => {
    const delta = metresToDegrees(3_000);
    const result = RoutePlanningBuildingFootprint.plan({
      footprint: [{ longitude: -delta / 2, latitude: -delta / 2 }, { longitude: delta / 2, latitude: -delta / 2 }, { longitude: delta / 2, latitude: delta / 2 }, { longitude: -delta / 2, latitude: delta / 2 }],
      altitudeMeters: 80,
      standOffMeters: 1,
      maxSegmentLengthMeters: 1
    });
    expect(result).toEqual({ ok: false, error: { code: "WAYPOINT_LIMIT_EXCEEDED", details: { field: "waypoints", reason: "too-many-waypoints" } } });
  });
});
