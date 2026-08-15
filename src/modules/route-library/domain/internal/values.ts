import { createError } from "./errors.js";
import {
  failure,
  success,
  type CreateWaypointInput,
  type DomainResult,
  type RouteId,
  type RouteWaypoint,
  waypointBrand
} from "./types.js";

const ROUTE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function createRouteId(raw: unknown): DomainResult<RouteId> {
  if (typeof raw !== "string" || !ROUTE_ID.test(raw)) {
    return failure(createError("DOMAIN_INVARIANT_VIOLATION", {
      field: "routeId",
      reason: "invalid-format"
    }));
  }
  return success(raw as RouteId);
}

function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function invalid(field: string, reason: string, sequence?: number): DomainResult<never> {
  return failure(createError("INVALID_COORDINATE", {
    field,
    reason,
    sequence
  }));
}

function validFiniteNumber(value: unknown): value is number {
  return Number.isFinite(value as number);
}

function snapshotWaypointInput(input: unknown): CreateWaypointInput | undefined {
  try {
    const value = input as CreateWaypointInput;
    return {
      longitude: value.longitude,
      latitude: value.latitude,
      altitude: value.altitude,
      sequence: value.sequence
    };
  } catch {}
}

export class InternalWaypoint implements RouteWaypoint {
  readonly #authentic: undefined = undefined;
  declare readonly [waypointBrand]: true;
  readonly longitude: number;
  readonly latitude: number;
  readonly altitude: number | null;
  readonly sequence: number;
  constructor(longitude: number, latitude: number, altitude: number | null, sequence: number) {
    Object.defineProperty(this, waypointBrand, { value: true });
    this.longitude = longitude;
    this.latitude = latitude;
    this.altitude = altitude;
    this.sequence = sequence;
    Object.freeze(this);
  }

  static is(value: unknown): value is InternalWaypoint {
    return typeof value === "object" && value !== null && #authentic in value;
  }
}

export function createWaypoint(input: CreateWaypointInput): DomainResult<RouteWaypoint> {
  const value = snapshotWaypointInput(input);
  if (value === undefined) return invalid("input", "invalid-container");

  const sequence = validFiniteNumber(value.sequence) ? value.sequence : undefined;
  if (!validFiniteNumber(value.longitude)) return invalid("longitude", "not-finite-number", sequence);
  if (value.longitude < -180 || value.longitude > 180) return invalid("longitude", "out-of-range", sequence);
  if (!validFiniteNumber(value.latitude)) return invalid("latitude", "not-finite-number", sequence);
  if (value.latitude < -90 || value.latitude > 90) return invalid("latitude", "out-of-range", sequence);
  if (value.altitude !== null && !validFiniteNumber(value.altitude)) return invalid("altitude", "not-finite-number", sequence);
  if (!validFiniteNumber(value.sequence) || !Number.isSafeInteger(value.sequence) || value.sequence < 0) {
    return invalid("sequence", "not-nonnegative-safe-integer", sequence);
  }
  return success(new InternalWaypoint(
    normalizeZero(value.longitude),
    normalizeZero(value.latitude),
    value.altitude === null ? null : normalizeZero(value.altitude),
    normalizeZero(value.sequence)
  ));
}
