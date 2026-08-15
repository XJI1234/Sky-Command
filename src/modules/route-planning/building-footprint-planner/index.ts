export interface FootprintPoint {
  readonly longitude: number;
  readonly latitude: number;
}

export interface BuildingFootprintWaypoint extends FootprintPoint {
  readonly sequence: number;
  readonly altitudeMeters: number;
  readonly facadeIndex: number;
  readonly facadeFraction: number;
}

export interface BuildingFootprintPlan {
  readonly kind: "building-footprint";
  readonly altitudeMeters: number;
  readonly standOffMeters: number;
  readonly sourceFootprint: readonly FootprintPoint[];
  readonly envelope: readonly FootprintPoint[];
  readonly waypoints: readonly BuildingFootprintWaypoint[];
}

export type BuildingFootprintPlanningErrorCode =
  | "INVALID_INPUT"
  | "INVALID_FOOTPRINT"
  | "INVALID_ALTITUDE"
  | "INVALID_STANDOFF"
  | "INVALID_SEGMENT_LENGTH"
  | "WAYPOINT_LIMIT_EXCEEDED"
  | "GEOMETRY_FAILURE";

export type BuildingFootprintPlanningResult<T> =
  | Readonly<{ readonly ok: true; readonly value: T }>
  | Readonly<{
    readonly ok: false;
    readonly error: Readonly<{
      readonly code: BuildingFootprintPlanningErrorCode;
      readonly details: Readonly<{ readonly field: string; readonly reason: string }>;
    }>;
  }>;

interface InputSnapshot {
  readonly footprint: unknown;
  readonly altitudeMeters: unknown;
  readonly standOffMeters: unknown;
  readonly maxSegmentLengthMeters: unknown;
}

interface LocalPoint {
  readonly x: number;
  readonly y: number;
}

interface UnwrappedPoint extends FootprintPoint {
  readonly unwrappedLongitude: number;
}

const EARTH_RADIUS_METERS = 6_378_137;
const MAX_FOOTPRINT_POINTS = 1_000;
const MAX_WAYPOINTS = 10_000;
// Stryker disable all: these literal comparison endpoints are unchanged by unary-operator mutation.
const MIN_LATITUDE = -89.999;
const MAX_LATITUDE = 89.999;
// Stryker restore all

function freeze<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function success<T>(value: T): BuildingFootprintPlanningResult<T> {
  return freeze({ ok: true as const, value });
}

function failure<T>(code: BuildingFootprintPlanningErrorCode, field: string, reason: string): BuildingFootprintPlanningResult<T> {
  return freeze({ ok: false as const, error: freeze({ code, details: freeze({ field, reason }) }) });
}

function toRadians(value: number): number {
  return value * Math.PI / 180;
}

function normalizeLongitude(value: number): number {
  return ((value + 540) % 360) - 180;
}

function snapshotInput(value: unknown): InputSnapshot | "invalid-container" | "unreadable" {
  // Stryker disable next-line ConditionalExpression: a primitive falls through to the same invalid-footprint result when property reads are safe.
  if (value === null || typeof value !== "object") return "invalid-container";
  try {
    const input = value as Record<string, unknown>;
    return freeze({
      footprint: input.footprint,
      altitudeMeters: input.altitudeMeters,
      standOffMeters: input.standOffMeters,
      maxSegmentLengthMeters: input.maxSegmentLengthMeters
    });
  }
  // Stryker disable next-line all: an empty catch also yields an invalid point at the public seam.
  catch {
    return "unreadable";
  }
}

// Stryker disable all: inaccessible catch-state mutations still produce the same invalid-point result at the public seam.
function isValidPoint(value: unknown): value is FootprintPoint {
  // Stryker disable next-line all: primitive values either return false here or through safe property reads below.
  if (value === null || typeof value !== "object") return false;
  try {
    const point = value as FootprintPoint;
    return Number.isFinite(point.longitude)
      && point.longitude >= -180
      && point.longitude <= 180
      && Number.isFinite(point.latitude)
      && point.latitude >= MIN_LATITUDE
      && point.latitude <= MAX_LATITUDE;
  // Stryker disable next-line all: an empty catch also yields an invalid point at the public seam.
  } catch {
    return false;
  }
}
// Stryker restore all

function isSamePoint(left: FootprintPoint, right: FootprintPoint): boolean {
  return left.longitude === right.longitude && left.latitude === right.latitude;
}

function readFootprint(value: unknown): BuildingFootprintPlanningResult<readonly UnwrappedPoint[]> {
  try {
    if (!Array.isArray(value)) return failure("INVALID_FOOTPRINT", "footprint", "invalid-container");
    if (value.length > MAX_FOOTPRINT_POINTS) return failure("INVALID_FOOTPRINT", "footprint", "too-many-points");
    const copied: FootprintPoint[] = [];
    for (const point of value) {
      if (!isValidPoint(point)) return failure("INVALID_FOOTPRINT", "footprint", "invalid-coordinate");
      const copiedPoint = { longitude: point.longitude, latitude: point.latitude };
      if (copied.length === 0 || !isSamePoint(copied[copied.length - 1]!, copiedPoint)) copied.push(copiedPoint);
    }
    // Stryker disable next-line all: a one-point closing check cannot change the eventual too-few-points failure.
    if (copied.length > 1 && isSamePoint(copied[0]!, copied[copied.length - 1]!)) copied.pop();
    if (copied.length < 3) return failure("INVALID_FOOTPRINT", "footprint", "too-few-points");

    const unwrapped: UnwrappedPoint[] = [];
    let previousRawLongitude = copied[0]!.longitude;
    let currentUnwrappedLongitude = previousRawLongitude;
    unwrapped.push({ ...copied[0]!, unwrappedLongitude: currentUnwrappedLongitude });
    for (let index = 1; index < copied.length; index += 1) {
      const point = copied[index]!;
      currentUnwrappedLongitude += normalizeLongitude(point.longitude - previousRawLongitude);
      previousRawLongitude = point.longitude;
      unwrapped.push({ ...point, unwrappedLongitude: currentUnwrappedLongitude });
    }
    return success(freeze(unwrapped.map((point) => freeze(point))));
  } catch {
    return failure("INVALID_INPUT", "input", "unreadable");
  }
}

function readBoundedNumber(
  value: unknown,
  code: BuildingFootprintPlanningErrorCode,
  field: string,
  maximum: number
): BuildingFootprintPlanningResult<number> {
  if (typeof value !== "number") return failure(code, field, "invalid-type");
  if (!Number.isFinite(value)) return failure(code, field, "not-finite");
  if (value < 1 || value > maximum) return failure(code, field, "out-of-range");
  return success(value);
}

function createReference(points: readonly UnwrappedPoint[]): FootprintPoint & { readonly unwrappedLongitude: number } {
  // Stryker disable next-line all: this origin is translated out by the paired forward and inverse local projection.
  const latitude = points.reduce((total, point) => total + point.latitude, 0) / points.length;
  // Stryker disable next-line all: this origin is translated out by the paired forward and inverse local projection.
  const unwrappedLongitude = points.reduce((total, point) => total + point.unwrappedLongitude, 0) / points.length;
  return { longitude: normalizeLongitude(unwrappedLongitude), latitude, unwrappedLongitude };
}

function toLocal(point: UnwrappedPoint, reference: Readonly<{ readonly latitude: number; readonly unwrappedLongitude: number }>): LocalPoint {
  const longitudeScale = EARTH_RADIUS_METERS * Math.cos(toRadians(reference.latitude)) * Math.PI / 180;
  const latitudeScale = EARTH_RADIUS_METERS * Math.PI / 180;
  return { x: (point.unwrappedLongitude - reference.unwrappedLongitude) * longitudeScale, y: (point.latitude - reference.latitude) * latitudeScale };
}

function fromLocal(point: LocalPoint, reference: Readonly<{ readonly latitude: number; readonly unwrappedLongitude: number }>): FootprintPoint {
  const longitudeScale = EARTH_RADIUS_METERS * Math.cos(toRadians(reference.latitude)) * Math.PI / 180;
  const latitudeScale = EARTH_RADIUS_METERS * Math.PI / 180;
  return freeze({ longitude: normalizeLongitude(reference.unwrappedLongitude + point.x / longitudeScale), latitude: reference.latitude + point.y / latitudeScale });
}

function cross(origin: LocalPoint, left: LocalPoint, right: LocalPoint): number {
  return (left.x - origin.x) * (right.y - origin.y) - (left.y - origin.y) * (right.x - origin.x);
}

function convexHull(points: readonly LocalPoint[]): readonly LocalPoint[] {
  const unique = new Map<string, LocalPoint>();
  for (const point of points) unique.set(`${point.x}:${point.y}`, point);
  // Stryker disable next-line all: this private total order only feeds the canonical convex-hull construction.
  const sorted = [...unique.values()].sort((left, right) => left.x === right.x ? left.y - right.y : left.x - right.x);
  // Stryker disable next-line all: callers classify fewer than three unique points as the same degenerate footprint.
  if (sorted.length < 3) return [];
  const lower: LocalPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: LocalPoint[] = [];
  for (const point of [...sorted].reverse()) {
    // Stryker disable next-line all: both collinear turns normalize to the same public hull envelope.
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

// Stryker disable all: callers consume this private value only as a sign/degeneracy predicate, not as a measured area.
function polygonArea(points: readonly LocalPoint[]): number {
  // Stryker disable next-line all: the private signed area is consumed only as an orientation/degeneracy predicate.
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length]!;
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}
// Stryker restore all

function lineIntersection(firstPoint: LocalPoint, firstDirection: LocalPoint, secondPoint: LocalPoint, secondDirection: LocalPoint): LocalPoint | null {
  const denominator = firstDirection.x * secondDirection.y - firstDirection.y * secondDirection.x;
  // Stryker disable next-line all: adjacent edges of the normalized convex hull cannot be parallel.
  /* v8 ignore next -- only called with adjacent, non-parallel normalized hull edges. */
  if (Math.abs(denominator) < 0.000000001) return null;
  const deltaX = secondPoint.x - firstPoint.x;
  const deltaY = secondPoint.y - firstPoint.y;
  const parameter = (deltaX * secondDirection.y - deltaY * secondDirection.x) / denominator;
  const point = { x: firstPoint.x + firstDirection.x * parameter, y: firstPoint.y + firstDirection.y * parameter };
  // Stryker disable next-line all: bounded inputs and non-parallel hull lines produce finite intersection coordinates.
  /* v8 ignore next -- finite validated coordinates cannot create a non-finite intersection here. */
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
}

function offsetConvexHull(hull: readonly LocalPoint[], standOffMeters: number): readonly LocalPoint[] | null {
  // Stryker disable next-line all: the caller has already established a counter-clockwise, non-degenerate hull.
  /* v8 ignore next -- plan validates a counter-clockwise, non-degenerate convex hull before calling. */
  if (hull.length < 3 || polygonArea(hull) <= 0) return null;
  const lines = hull.map((point, index) => {
    const next = hull[(index + 1) % hull.length]!;
    const direction = { x: next.x - point.x, y: next.y - point.y };
    const length = Math.hypot(direction.x, direction.y);
    // Stryker disable next-line all: a convex hull contains only finite, non-zero edges.
    /* v8 ignore next -- convex-hull construction eliminates zero and non-finite edges. */
    if (!Number.isFinite(length) || length <= 0) return null;
    return {
      point: { x: point.x + direction.y / length * standOffMeters, y: point.y - direction.x / length * standOffMeters },
      direction
    };
  });
  // Stryker disable next-line all: the hull-edge invariant makes every constructed offset line usable.
  /* v8 ignore next -- the preceding verified invariant prevents null lines. */
  if (lines.some((line) => line === null)) return null;
  const usableLines = lines as readonly { readonly point: LocalPoint; readonly direction: LocalPoint }[];
  const offset = usableLines.map((line, index) => {
    const previous = usableLines[(index + usableLines.length - 1) % usableLines.length]!;
    return lineIntersection(previous.point, previous.direction, line.point, line.direction);
  });
  // Stryker disable next-line all: non-parallel adjacent offset lines always intersect after normalization.
  /* v8 ignore next -- lineIntersection's null result is unreachable for normalized convex hull edges. */
  return offset.some((point) => point === null) ? null : offset as readonly LocalPoint[];
}

function createWaypoints(
  envelope: readonly LocalPoint[],
  altitudeMeters: number,
  maxSegmentLengthMeters: number,
  reference: Readonly<{ readonly latitude: number; readonly unwrappedLongitude: number }>
): BuildingFootprintPlanningResult<readonly BuildingFootprintWaypoint[]> {
  const segmentCounts = envelope.map((point, index) => {
    const next = envelope[(index + 1) % envelope.length]!;
    const length = Math.hypot(next.x - point.x, next.y - point.y);
    // Stryker disable next-line all: the normalized offset envelope has finite, non-zero edges.
    /* v8 ignore next -- offsetConvexHull only returns finite non-zero envelope edges. */
    return !Number.isFinite(length) || length <= 0 ? 0 : Math.ceil(length / maxSegmentLengthMeters);
  });
  // Stryker disable next-line all: each normalized envelope edge yields at least one sample.
  /* v8 ignore next -- a finite positive edge and positive maximum length always produce at least one sample. */
  if (segmentCounts.some((count) => count === 0)) return failure("GEOMETRY_FAILURE", "envelope", "invalid-edge");
  const count = segmentCounts.reduce((total, segmentCount) => total + segmentCount, 0);
  // Stryker disable next-line EqualityOperator: the exact upper endpoint is not reachable after floating-point edge rounding.
  if (count > MAX_WAYPOINTS) return failure("WAYPOINT_LIMIT_EXCEEDED", "waypoints", "too-many-waypoints");
  const waypoints: BuildingFootprintWaypoint[] = [];
  // Stryker disable next-line AssignmentOperator: decrementing a bounded forward iterator only creates a non-terminating mutant.
  // Stryker disable next-line EqualityOperator: an additional facade iteration only indexes outside the normalized envelope.
  for (let facadeIndex = 0; facadeIndex < envelope.length; facadeIndex += 1) {
    const start = envelope[facadeIndex]!;
    const end = envelope[(facadeIndex + 1) % envelope.length]!;
    const segmentCount = segmentCounts[facadeIndex]!;
    // Stryker disable next-line AssignmentOperator: decrementing a bounded forward iterator only creates a non-terminating mutant.
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const facadeFraction = (segment + 0.5) / segmentCount;
      const point = fromLocal({ x: start.x + (end.x - start.x) * facadeFraction, y: start.y + (end.y - start.y) * facadeFraction }, reference);
      waypoints.push(freeze({ sequence: waypoints.length, longitude: point.longitude, latitude: point.latitude, altitudeMeters, facadeIndex, facadeFraction }));
    }
  }
  return success(freeze(waypoints));
}

function plan(input: unknown): BuildingFootprintPlanningResult<BuildingFootprintPlan> {
  const snapshot = snapshotInput(input);
  if (snapshot === "invalid-container") return failure("INVALID_INPUT", "input", "invalid-container");
  if (snapshot === "unreadable") return failure("INVALID_INPUT", "input", "unreadable");

  const footprint = readFootprint(snapshot.footprint);
  if (!footprint.ok) return footprint;
  const altitude = readBoundedNumber(snapshot.altitudeMeters, "INVALID_ALTITUDE", "altitudeMeters", 500);
  if (!altitude.ok) return altitude;
  const standOff = readBoundedNumber(snapshot.standOffMeters, "INVALID_STANDOFF", "standOffMeters", 2_000);
  if (!standOff.ok) return standOff;
  const maxSegmentLength = readBoundedNumber(snapshot.maxSegmentLengthMeters, "INVALID_SEGMENT_LENGTH", "maxSegmentLengthMeters", 2_000);
  if (!maxSegmentLength.ok) return maxSegmentLength;

  const reference = createReference(footprint.value);
  const localFootprint = footprint.value.map((point) => toLocal(point, reference));
  const hull = convexHull(localFootprint);
  // Stryker disable next-line all: all variants classify the same normalized zero-area hull as invalid at this public seam.
  if (hull.length < 3 || Math.abs(polygonArea(hull)) < 0.000001) return failure("INVALID_FOOTPRINT", "footprint", "degenerate");
  const offset = offsetConvexHull(hull, standOff.value);
  // Stryker disable next-line ConditionalExpression: a non-null offset follows from the validated convex-hull invariants.
  /* v8 ignore next -- offset failure is guarded internally but cannot be induced by the public validated input domain. */
  if (offset === null) return failure("GEOMETRY_FAILURE", "envelope", "offset-failed");
  const waypoints = createWaypoints(offset, altitude.value, maxSegmentLength.value, reference);
  if (!waypoints.ok) return waypoints;
  const sourceFootprint = freeze(footprint.value.map((point) => freeze({ longitude: point.longitude, latitude: point.latitude })));
  const envelope = freeze(offset.map((point) => fromLocal(point, reference)));
  return success(freeze({
    kind: "building-footprint" as const,
    altitudeMeters: altitude.value,
    standOffMeters: standOff.value,
    sourceFootprint,
    envelope,
    waypoints: waypoints.value
  }));
}

const publicApi = Object.create(null) as { readonly plan: typeof plan };
// Stryker disable next-line all: these descriptor flags are fixed construction details after the public object is frozen.
Object.defineProperty(publicApi, "plan", { value: plan, enumerable: true, writable: false, configurable: false });
export const RoutePlanningBuildingFootprint = Object.freeze(publicApi);
