import { describe, expect, it } from "vitest";
import { RoutePlanningObstacleAnalysis } from "../src/modules/route-planning/obstacle-analysis/index.js";

const path = [
  { longitude: 120, latitude: 30, altitudeMeters: 100 },
  { longitude: 120.001, latitude: 30, altitudeMeters: 120 },
  { longitude: 120.002, latitude: 30, altitudeMeters: 80 },
  { longitude: 120.003, latitude: 30, altitudeMeters: 80 }
];

describe("obstacle-analysis contract", () => {
  it("classifies safe, risk, and collision segments in index order", () => {
    const result = RoutePlanningObstacleAnalysis.analyze({
      path,
      samples: [
        { segmentIndex: 2, highestObstacleAltitudeMeters: 60 },
        { segmentIndex: 0, highestObstacleAltitudeMeters: 105 },
        { segmentIndex: 1, highestObstacleAltitudeMeters: 101 }
      ],
      requiredClearanceMeters: 10
    });
    expect(result).toEqual({
      ok: true,
      value: {
        safeCount: 1,
        riskCount: 1,
        collisionCount: 1,
        segments: [
          { segmentIndex: 0, flightAltitudeMeters: 110, highestObstacleAltitudeMeters: 105, clearanceMeters: 5, status: "risk" },
          { segmentIndex: 1, flightAltitudeMeters: 100, highestObstacleAltitudeMeters: 101, clearanceMeters: -1, status: "collision" },
          { segmentIndex: 2, flightAltitudeMeters: 80, highestObstacleAltitudeMeters: 60, clearanceMeters: 20, status: "safe" }
        ]
      }
    });
  });

  it("treats a null obstacle sample as a safe segment with no clearance value", () => {
    const result = RoutePlanningObstacleAnalysis.analyze({
      path: path.slice(0, 2),
      samples: [{ segmentIndex: 0, highestObstacleAltitudeMeters: null }],
      requiredClearanceMeters: 10
    });
    expect(result).toEqual({ ok: true, value: { safeCount: 1, riskCount: 0, collisionCount: 0, segments: [{ segmentIndex: 0, flightAltitudeMeters: 110, highestObstacleAltitudeMeters: null, clearanceMeters: null, status: "safe" }] } });
  });

  it.each([
    [null, { code: "INVALID_INPUT", field: "input", reason: "invalid-container" }],
    [{ path: [], samples: [], requiredClearanceMeters: 10 }, { code: "INVALID_PATH", field: "path", reason: "too-few-waypoints" }],
    [{ path, samples: [], requiredClearanceMeters: 10 }, { code: "INVALID_SAMPLE", field: "samples", reason: "missing-segment" }],
    [{ path: [{ longitude: 181, latitude: 0, altitudeMeters: 100 }, path[1]!], samples: [{ segmentIndex: 0, highestObstacleAltitudeMeters: null }], requiredClearanceMeters: 10 }, { code: "INVALID_PATH", field: "path", reason: "invalid-waypoint" }],
    [{ path: path.slice(0, 2), samples: [{ segmentIndex: 0, highestObstacleAltitudeMeters: null }, { segmentIndex: 0, highestObstacleAltitudeMeters: null }], requiredClearanceMeters: 10 }, { code: "INVALID_SAMPLE", field: "samples", reason: "duplicate-segment" }],
    [{ path: path.slice(0, 2), samples: [{ segmentIndex: 1, highestObstacleAltitudeMeters: null }], requiredClearanceMeters: 10 }, { code: "INVALID_SAMPLE", field: "samples", reason: "out-of-range-segment" }],
    [{ path: path.slice(0, 2), samples: [{ segmentIndex: 0, highestObstacleAltitudeMeters: Number.NaN }], requiredClearanceMeters: 10 }, { code: "INVALID_SAMPLE", field: "samples", reason: "invalid-obstacle-height" }],
    [{ path: path.slice(0, 2), samples: [{ segmentIndex: 0, highestObstacleAltitudeMeters: null }], requiredClearanceMeters: 0.49 }, { code: "INVALID_CLEARANCE", field: "requiredClearanceMeters", reason: "out-of-range" }]
  ])("returns stable errors for invalid analysis input", (input, error) => {
    expect(RoutePlanningObstacleAnalysis.analyze(input)).toEqual({ ok: false, error: { code: error.code, details: { field: error.field, reason: error.reason } } });
  });

  it("freezes output and contains hostile getters", () => {
    const success = RoutePlanningObstacleAnalysis.analyze({ path: path.slice(0, 2), samples: [{ segmentIndex: 0, highestObstacleAltitudeMeters: null }], requiredClearanceMeters: 10 });
    if (!success.ok) throw new Error("expected analysis");
    expect(Object.isFrozen(success)).toBe(true);
    expect(Object.isFrozen(success.value)).toBe(true);
    expect(Object.isFrozen(success.value.segments)).toBe(true);
    expect(Object.isFrozen(success.value.segments[0]!)).toBe(true);
    const hostile = new Proxy({}, { get() { throw new Error("secret"); } });
    expect(RoutePlanningObstacleAnalysis.analyze(hostile)).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "input", reason: "unreadable" } } });
  });

  it.each([
    [{ path: "invalid", samples: [], requiredClearanceMeters: 10 }, "INVALID_PATH", "path", "invalid-container"],
    [{ path: path.slice(0, 2), samples: "invalid", requiredClearanceMeters: 10 }, "INVALID_SAMPLE", "samples", "invalid-container"],
    [{ path: path.slice(0, 2), samples: [null], requiredClearanceMeters: 10 }, "INVALID_SAMPLE", "samples", "invalid-sample"],
    [{ path: path.slice(0, 2), samples: [{ segmentIndex: 0.5, highestObstacleAltitudeMeters: null }], requiredClearanceMeters: 10 }, "INVALID_SAMPLE", "samples", "invalid-segment-index"],
    [{ path: path.slice(0, 2), samples: [{ segmentIndex: 0, highestObstacleAltitudeMeters: null }], requiredClearanceMeters: "10" }, "INVALID_CLEARANCE", "requiredClearanceMeters", "invalid-type"],
    [{ path: path.slice(0, 2), samples: [{ segmentIndex: 0, highestObstacleAltitudeMeters: null }], requiredClearanceMeters: Number.NaN }, "INVALID_CLEARANCE", "requiredClearanceMeters", "not-finite"]
  ])("覆盖各个抽象输入容器与数值失败分支", (input, code, field, reason) => {
    expect(RoutePlanningObstacleAnalysis.analyze(input)).toEqual({ ok: false, error: { code, details: { field, reason } } });
  });

  it("将路径和样本中的恶意或原始值隔离为稳定失败", () => {
    expect(RoutePlanningObstacleAnalysis.analyze({ path: [null, path[1]!], samples: [{ segmentIndex: 0, highestObstacleAltitudeMeters: null }], requiredClearanceMeters: 10 })).toEqual({ ok: false, error: { code: "INVALID_PATH", details: { field: "path", reason: "invalid-waypoint" } } });
    expect(RoutePlanningObstacleAnalysis.analyze({ path: ["invalid", path[1]!], samples: [{ segmentIndex: 0, highestObstacleAltitudeMeters: null }], requiredClearanceMeters: 10 })).toEqual({ ok: false, error: { code: "INVALID_PATH", details: { field: "path", reason: "invalid-waypoint" } } });
    expect(RoutePlanningObstacleAnalysis.analyze({ path: [{ longitude: 0, latitude: 0, altitudeMeters: 501 }, path[1]!], samples: [{ segmentIndex: 0, highestObstacleAltitudeMeters: null }], requiredClearanceMeters: 10 })).toEqual({ ok: false, error: { code: "INVALID_PATH", details: { field: "path", reason: "invalid-waypoint" } } });
    const hostileWaypoint = new Proxy({}, { get() { throw new Error("waypoint secret"); } });
    expect(RoutePlanningObstacleAnalysis.analyze({ path: [hostileWaypoint, path[1]!], samples: [{ segmentIndex: 0, highestObstacleAltitudeMeters: null }], requiredClearanceMeters: 10 })).toEqual({ ok: false, error: { code: "INVALID_PATH", details: { field: "path", reason: "invalid-waypoint" } } });
    const hostilePath = new Proxy([path[0]!, path[1]!], { get(target, property, receiver) { if (property === Symbol.iterator) throw new Error("path secret"); return Reflect.get(target, property, receiver); } });
    expect(RoutePlanningObstacleAnalysis.analyze({ path: hostilePath, samples: [], requiredClearanceMeters: 10 })).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "input", reason: "unreadable" } } });
    const hostileSample = new Proxy({}, { get() { throw new Error("sample secret"); } });
    expect(RoutePlanningObstacleAnalysis.analyze({ path: path.slice(0, 2), samples: [hostileSample], requiredClearanceMeters: 10 })).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "input", reason: "unreadable" } } });
  });
});
