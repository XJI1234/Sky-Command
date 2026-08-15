import { createError, type DomainResult, type RouteDetail } from "../domain/index.js";

export interface GeoPoint3D {
  readonly longitude: number;
  readonly latitude: number;
  readonly altitude: number | null;
}

export interface GeoBounds3D {
  readonly minLongitude: number;
  readonly maxLongitude: number;
  readonly minLatitude: number;
  readonly maxLatitude: number;
  readonly minAltitude: number | null;
  readonly maxAltitude: number | null;
}

export interface RoutePreview {
  readonly routeId: string;
  readonly polyline: readonly GeoPoint3D[];
  readonly startMarker: GeoPoint3D;
  readonly endMarker: GeoPoint3D;
  readonly cameraBounds: GeoBounds3D;
}

interface RawPreviewInput {
  readonly isCallable: boolean;
  readonly routeId: unknown;
  readonly waypointValues: unknown;
}

interface PreviewInput {
  readonly routeId: string;
  readonly waypoints: readonly unknown[];
}

interface RawPreviewWaypoint {
  readonly isCallable: boolean;
  readonly sequence: unknown;
  readonly longitude: unknown;
  readonly latitude: unknown;
  readonly altitude: unknown;
}

// Stryker disable all: these private sentinel payloads are never observable; only identity matters.
const unreadableDetail = Object.freeze({
  isCallable: false,
  routeId: "unreadable-detail",
  waypointValues: Object.freeze([
    Object.freeze({ sequence: 0, longitude: 0, latitude: 0, altitude: null }),
    Object.freeze({ sequence: 1, longitude: 0, latitude: 0, altitude: null })
  ])
});
const unreadableWaypoint = Object.freeze({ isCallable: false, sequence: 0, longitude: 0, latitude: 0, altitude: null });
// Stryker restore all

function invalid(): DomainResult<never> {
  return Object.freeze({
    ok: false as const,
    error: createError("DOMAIN_INVARIANT_VIOLATION", { field: "detail", reason: "invalid-preview-input" })
  });
}

function readRawDetail(value: unknown): RawPreviewInput | typeof unreadableDetail {
  try {
    const detail = Object(value) as { readonly routeId: unknown; readonly waypoints: unknown };
    return Object.freeze({ isCallable: typeof value === "function", routeId: detail.routeId, waypointValues: detail.waypoints });
  } catch {
    return unreadableDetail;
  }
}

function readDetail(value: unknown): PreviewInput | undefined {
  const raw = readRawDetail(value);
  if (raw === unreadableDetail) return undefined;
  if (raw.isCallable) return undefined;
  if (typeof raw.routeId !== "string") return undefined;

  if (!Array.isArray(raw.waypointValues)) return undefined;
  const waypoints = raw.waypointValues;
  if (waypoints.length < 2) return undefined;

  return Object.freeze({ routeId: raw.routeId, waypoints });
}

function readRawWaypoint(value: unknown): RawPreviewWaypoint | typeof unreadableWaypoint {
  try {
    const waypoint = Object(value) as Omit<RawPreviewWaypoint, "isCallable">;
    return Object.freeze({
      isCallable: typeof value === "function",
      sequence: waypoint.sequence,
      longitude: waypoint.longitude,
      latitude: waypoint.latitude,
      altitude: waypoint.altitude
    });
  } catch {
    return unreadableWaypoint;
  }
}

function readFiniteNumber(value: unknown): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return value as number;
}

function readAltitude(value: unknown): number | null | undefined {
  if (value === null) return null;
  return readFiniteNumber(value);
}

function readWaypoint(value: unknown, expectedSequence: number): GeoPoint3D | undefined {
  const raw = readRawWaypoint(value);
  if (raw === unreadableWaypoint) return undefined;
  if (raw.isCallable) return undefined;
  if (raw.sequence !== expectedSequence) return undefined;

  const longitude = readFiniteNumber(raw.longitude);
  if (longitude === undefined) return undefined;
  const latitude = readFiniteNumber(raw.latitude);
  if (latitude === undefined) return undefined;
  const altitude = readAltitude(raw.altitude);
  if (altitude === undefined) return undefined;

  return Object.freeze({ longitude, latitude, altitude });
}

function copyPoint(point: GeoPoint3D): GeoPoint3D {
  return Object.freeze({ longitude: point.longitude, latitude: point.latitude, altitude: point.altitude });
}

function createBounds(points: readonly GeoPoint3D[]): GeoBounds3D {
  const firstPoint = points[0]!;
  let minLongitude = firstPoint.longitude;
  let maxLongitude = firstPoint.longitude;
  let minLatitude = firstPoint.latitude;
  let maxLatitude = firstPoint.latitude;
  let minAltitude = firstPoint.altitude;
  let maxAltitude = firstPoint.altitude;

  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    minLongitude = Math.min(minLongitude, point.longitude);
    maxLongitude = Math.max(maxLongitude, point.longitude);
    minLatitude = Math.min(minLatitude, point.latitude);
    maxLatitude = Math.max(maxLatitude, point.latitude);

    if (point.altitude === null) {
      minAltitude = null;
      maxAltitude = null;
      continue;
    }

    if (minAltitude === null) continue;
    minAltitude = Math.min(minAltitude, point.altitude);
    maxAltitude = Math.max(maxAltitude!, point.altitude);
  }

  return Object.freeze({ minLongitude, maxLongitude, minLatitude, maxLatitude, minAltitude, maxAltitude });
}

function createPreview(detail: RouteDetail): DomainResult<RoutePreview> {
  const input = readDetail(detail);
  if (input === undefined) return invalid();

  const points: GeoPoint3D[] = [];
  for (let index = 0; index < input.waypoints.length; index += 1) {
    const point = readWaypoint(input.waypoints[index], index);
    if (point === undefined) return invalid();
    points.push(point);
  }

  const polyline = Object.freeze(points);
  const startMarker = copyPoint(polyline[0]!);
  const endMarker = copyPoint(polyline[polyline.length - 1]!);
  const cameraBounds = createBounds(polyline);
  return Object.freeze({
    ok: true as const,
    value: Object.freeze({ routeId: input.routeId, polyline, startMarker, endMarker, cameraBounds })
  });
}

export const RoutePreviewModel = Object.freeze({ createPreview });
export type { RouteDetail } from "../domain/index.js";
