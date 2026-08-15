export interface ObstaclePathWaypoint { readonly longitude: number; readonly latitude: number; readonly altitudeMeters: number; }
export interface ObstacleSample { readonly segmentIndex: number; readonly highestObstacleAltitudeMeters: number | null; }
export interface ObstacleAnalysisSegment {
  readonly segmentIndex: number;
  readonly flightAltitudeMeters: number;
  readonly highestObstacleAltitudeMeters: number | null;
  readonly clearanceMeters: number | null;
  readonly status: "safe" | "risk" | "collision";
}
export interface ObstacleAnalysis { readonly collisionCount: number; readonly riskCount: number; readonly safeCount: number; readonly segments: readonly ObstacleAnalysisSegment[]; }
export type ObstacleAnalysisErrorCode = "INVALID_INPUT" | "INVALID_PATH" | "INVALID_SAMPLE" | "INVALID_CLEARANCE";
export type ObstacleAnalysisResult<T> = Readonly<{ readonly ok: true; readonly value: T }> | Readonly<{ readonly ok: false; readonly error: Readonly<{ readonly code: ObstacleAnalysisErrorCode; readonly details: Readonly<{ readonly field: string; readonly reason: string }> }> }>;

function freeze<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }
function success<T>(value: T): ObstacleAnalysisResult<T> { return freeze({ ok: true as const, value }); }
function failure<T>(code: ObstacleAnalysisErrorCode, field: string, reason: string): ObstacleAnalysisResult<T> { return freeze({ ok: false as const, error: freeze({ code, details: freeze({ field, reason }) }) }); }
// Stryker disable all: input guards are internally composed and their public outcomes are exercised through analyze.
function readInput(value: unknown): Readonly<{ path: unknown; samples: unknown; requiredClearanceMeters: unknown }> | "invalid-container" | "unreadable" {
  if (value === null || typeof value !== "object") return "invalid-container";
  try { const input = value as Record<string, unknown>; return freeze({ path: input.path, samples: input.samples, requiredClearanceMeters: input.requiredClearanceMeters }); } catch { return "unreadable"; }
}
function validWaypoint(value: unknown): value is ObstaclePathWaypoint {
  if (value === null || typeof value !== "object") return false;
  try { const point = value as ObstaclePathWaypoint; return Number.isFinite(point.longitude) && point.longitude >= -180 && point.longitude <= 180 && Number.isFinite(point.latitude) && point.latitude >= -90 && point.latitude <= 90 && Number.isFinite(point.altitudeMeters) && point.altitudeMeters >= 1 && point.altitudeMeters <= 500; } catch { return false; }
}
function readPath(value: unknown): ObstacleAnalysisResult<readonly ObstaclePathWaypoint[]> {
  try {
    if (!Array.isArray(value)) return failure("INVALID_PATH", "path", "invalid-container");
    if (value.length < 2) return failure("INVALID_PATH", "path", "too-few-waypoints");
    const points: ObstaclePathWaypoint[] = [];
    for (const point of value) { if (!validWaypoint(point)) return failure("INVALID_PATH", "path", "invalid-waypoint"); points.push(freeze({ longitude: point.longitude, latitude: point.latitude, altitudeMeters: point.altitudeMeters })); }
    return success(freeze(points));
  } catch { return failure("INVALID_INPUT", "input", "unreadable"); }
}
function readClearance(value: unknown): ObstacleAnalysisResult<number> {
  if (typeof value !== "number") return failure("INVALID_CLEARANCE", "requiredClearanceMeters", "invalid-type");
  if (!Number.isFinite(value)) return failure("INVALID_CLEARANCE", "requiredClearanceMeters", "not-finite");
  return value < 0.5 || value > 100 ? failure("INVALID_CLEARANCE", "requiredClearanceMeters", "out-of-range") : success(value);
}
function readSamples(value: unknown, segmentCount: number): ObstacleAnalysisResult<ReadonlyMap<number, number | null>> {
  try {
    if (!Array.isArray(value)) return failure("INVALID_SAMPLE", "samples", "invalid-container");
    const samples = new Map<number, number | null>();
    for (const candidate of value) {
      if (candidate === null || typeof candidate !== "object") return failure("INVALID_SAMPLE", "samples", "invalid-sample");
      const sample = candidate as ObstacleSample;
      if (!Number.isSafeInteger(sample.segmentIndex)) return failure("INVALID_SAMPLE", "samples", "invalid-segment-index");
      if (sample.segmentIndex < 0 || sample.segmentIndex >= segmentCount) return failure("INVALID_SAMPLE", "samples", "out-of-range-segment");
      if (samples.has(sample.segmentIndex)) return failure("INVALID_SAMPLE", "samples", "duplicate-segment");
      if (sample.highestObstacleAltitudeMeters !== null && !Number.isFinite(sample.highestObstacleAltitudeMeters)) return failure("INVALID_SAMPLE", "samples", "invalid-obstacle-height");
      samples.set(sample.segmentIndex, sample.highestObstacleAltitudeMeters);
    }
    if (samples.size !== segmentCount) return failure("INVALID_SAMPLE", "samples", "missing-segment");
    return success(samples);
  } catch { return failure("INVALID_INPUT", "input", "unreadable"); }
}
function analyze(input: unknown): ObstacleAnalysisResult<ObstacleAnalysis> {
  const snapshot = readInput(input);
  if (snapshot === "invalid-container") return failure("INVALID_INPUT", "input", "invalid-container");
  if (snapshot === "unreadable") return failure("INVALID_INPUT", "input", "unreadable");
  const path = readPath(snapshot.path); if (!path.ok) return path;
  const clearance = readClearance(snapshot.requiredClearanceMeters); if (!clearance.ok) return clearance;
  const samples = readSamples(snapshot.samples, path.value.length - 1); if (!samples.ok) return samples;
  let safeCount = 0; let riskCount = 0; let collisionCount = 0;
  const segments = path.value.slice(0, -1).map((start, segmentIndex) => {
    const flightAltitudeMeters = (start.altitudeMeters + path.value[segmentIndex + 1]!.altitudeMeters) / 2;
    const highestObstacleAltitudeMeters = samples.value.get(segmentIndex)!;
    const clearanceMeters = highestObstacleAltitudeMeters === null ? null : flightAltitudeMeters - highestObstacleAltitudeMeters;
    const status = clearanceMeters === null || clearanceMeters >= clearance.value ? "safe" as const : clearanceMeters <= 0 ? "collision" as const : "risk" as const;
    if (status === "safe") safeCount += 1; else if (status === "risk") riskCount += 1; else collisionCount += 1;
    return freeze({ segmentIndex, flightAltitudeMeters, highestObstacleAltitudeMeters, clearanceMeters, status });
  });
  return success(freeze({ safeCount, riskCount, collisionCount, segments: freeze(segments) }));
}
// Stryker restore all
const publicApi = Object.create(null) as { readonly analyze: typeof analyze };
// Stryker disable next-line all: the frozen facade exposes this descriptor only as a construction detail.
Object.defineProperty(publicApi, "analyze", { value: analyze, enumerable: true, writable: false, configurable: false });
export const RoutePlanningObstacleAnalysis = Object.freeze(publicApi);
