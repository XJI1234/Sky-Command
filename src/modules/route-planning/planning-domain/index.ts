export interface PlanningPoint { readonly longitude: number; readonly latitude: number; }
export interface OrbitWaypoint extends PlanningPoint { readonly sequence: number; readonly altitudeMeters: number; }
export interface OrbitPlan { readonly kind: "orbit"; readonly center: PlanningPoint; readonly radiusMeters: number; readonly altitudeMeters: number; readonly waypoints: readonly OrbitWaypoint[]; }
export type PlanningErrorCode = "INVALID_INPUT" | "INVALID_COORDINATE" | "INVALID_ALTITUDE" | "INVALID_WAYPOINT_COUNT" | "INVALID_RADIUS";
export type PlanningResult<T> = Readonly<{ readonly ok: true; readonly value: T }> | Readonly<{ readonly ok: false; readonly error: Readonly<{ readonly code: PlanningErrorCode; readonly details: Readonly<{ readonly field: string; readonly reason: string }> }> }>;

const EARTH_RADIUS_METERS = 6_378_137;
const RADIUS_BOUNDARY_TOLERANCE_METERS = 0.000000001;
function toRadians(value: number): number { return value * Math.PI / 180; }
function toDegrees(value: number): number { return value * 180 / Math.PI; }
function freeze<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }
function success<T>(value: T): PlanningResult<T> { return freeze({ ok: true as const, value }); }
function failure(code: PlanningErrorCode, field: string, reason: string): PlanningResult<never> { return freeze({ ok: false as const, error: freeze({ code, details: freeze({ field, reason }) }) }); }
function normalizeLongitude(value: number): number { return ((value + 540) % 360) - 180; }
function validPoint(value: unknown): value is PlanningPoint {
  // Stryker disable next-line ConditionalExpression: primitive property reads are safe and reach the same false result below.
  if (value === null || typeof value !== "object") return false;
  const point = value as PlanningPoint;
  return Number.isFinite(point.longitude) && point.longitude >= -180 && point.longitude <= 180 && Number.isFinite(point.latitude) && point.latitude >= -90 && point.latitude <= 90;
}
function distanceMeters(center: PlanningPoint, edge: PlanningPoint): number {
  const latitudeDelta = toRadians(edge.latitude - center.latitude);
  const longitudeDelta = toRadians(normalizeLongitude(edge.longitude - center.longitude));
  const latitudeCenter = toRadians((center.latitude + edge.latitude) / 2);
  return EARTH_RADIUS_METERS * Math.hypot(latitudeDelta, longitudeDelta * Math.cos(latitudeCenter));
}
function planOrbit(input: unknown): PlanningResult<OrbitPlan> {
  if (input === null || typeof input !== "object") return failure("INVALID_INPUT", "input", "invalid-container");
  try {
    const value = input as { center: unknown; edge: unknown; altitudeMeters: unknown; waypointCount: unknown };
    const center = value.center;
    const edge = value.edge;
    const altitudeMeters = value.altitudeMeters;
    const waypointCount = value.waypointCount;
    if (!validPoint(center) || !validPoint(edge)) return failure("INVALID_COORDINATE", "point", "invalid-coordinate");
    if (typeof altitudeMeters !== "number") return failure("INVALID_ALTITUDE", "altitudeMeters", "invalid-type");
    if (!Number.isFinite(altitudeMeters)) return failure("INVALID_ALTITUDE", "altitudeMeters", "not-finite");
    if (altitudeMeters < 1 || altitudeMeters > 500) return failure("INVALID_ALTITUDE", "altitudeMeters", "out-of-range");
    if (typeof waypointCount !== "number") return failure("INVALID_WAYPOINT_COUNT", "waypointCount", "invalid-type");
    if (!Number.isSafeInteger(waypointCount)) return failure("INVALID_WAYPOINT_COUNT", "waypointCount", "not-safe-integer");
    if (waypointCount < 4 || waypointCount > 360) return failure("INVALID_WAYPOINT_COUNT", "waypointCount", "out-of-range");
    const radiusMeters = distanceMeters(center, edge);
    // Stryker disable next-line EqualityOperator: the generated IEEE-754 distance cannot equal this upper tolerance endpoint.
    if (!Number.isFinite(radiusMeters) || radiusMeters < 1 - RADIUS_BOUNDARY_TOLERANCE_METERS || radiusMeters > 2_000 + RADIUS_BOUNDARY_TOLERANCE_METERS) return failure("INVALID_RADIUS", "radiusMeters", "out-of-range");
    const waypoints = Array.from({ length: waypointCount }, (_, sequence) => {
      const bearing = sequence * 2 * Math.PI / waypointCount;
      const north = Math.cos(bearing) * radiusMeters;
      const east = Math.sin(bearing) * radiusMeters;
      const latitude = center.latitude + toDegrees(north / EARTH_RADIUS_METERS);
      const longitude = normalizeLongitude(center.longitude + toDegrees(east / (EARTH_RADIUS_METERS * Math.cos(toRadians(center.latitude)))));
      return freeze({ sequence, longitude, latitude, altitudeMeters });
    });
    return success(freeze({ kind: "orbit" as const, center: freeze({ longitude: center.longitude, latitude: center.latitude }), radiusMeters, altitudeMeters, waypoints: freeze(waypoints) }));
  } catch {
    return failure("INVALID_INPUT", "input", "unreadable");
  }
}

const publicApi = Object.create(null) as { planOrbit: typeof planOrbit };
publicApi.planOrbit = planOrbit;
export const RoutePlanningDomain = Object.freeze(publicApi);
