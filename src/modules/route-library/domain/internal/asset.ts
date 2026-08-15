import { createError } from "./errors.js";
import { InternalQualifiedRoute, readQualifiedRoute } from "./route.js";
import {
  failure,
  success,
  type CreateRouteAssetInput,
  type DomainResult,
  type RouteAsset,
  type RouteAssetData,
  type RouteDetail,
  type RouteSummary,
  type RouteWarning,
  type RouteWaypoint,
  routeAssetBrand
} from "./types.js";
import { createRouteId, InternalWaypoint } from "./values.js";

function copyWaypoint(point: RouteWaypoint): RouteWaypoint {
  return new InternalWaypoint(
    point.longitude,
    point.latitude,
    point.altitude,
    point.sequence
  );
}

function copyWarning(warning: RouteWarning): RouteWarning {
  return Object.freeze({
    code: warning.code,
    message: warning.message,
    ...(warning.details === undefined ? {} : { details: warning.details })
  });
}

function validImportedAt(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function snapshotRouteAssetInput(input: unknown): CreateRouteAssetInput | undefined {
  try {
    const value = input as CreateRouteAssetInput;
    return {
      qualifiedRoute: value.qualifiedRoute,
      routeId: value.routeId,
      importedAt: value.importedAt
    };
  } catch {}
}

class InternalRouteAsset implements RouteAsset {
  readonly #authentic: undefined = undefined;
  declare readonly [routeAssetBrand]: true;
  readonly #data: RouteAssetData;

  constructor(data: RouteAssetData) {
    Object.defineProperty(this, routeAssetBrand, { value: true });
    this.#data = data;
    Object.freeze(this);
  }

  static read(value: InternalRouteAsset): RouteAssetData {
    return value.#data;
  }
}

function readAsset(asset: RouteAsset): RouteAssetData {
  return InternalRouteAsset.read(asset as InternalRouteAsset);
}

export function createRouteAsset(input: CreateRouteAssetInput): DomainResult<RouteAsset> {
  const value = snapshotRouteAssetInput(input);
  if (value === undefined) {
    return failure(createError("DOMAIN_INVARIANT_VIOLATION", { field: "input", reason: "invalid-container" }));
  }
  if (!InternalQualifiedRoute.is(value.qualifiedRoute)) {
    return failure(createError("DOMAIN_INVARIANT_VIOLATION", { field: "qualifiedRoute", reason: "untrusted-route" }));
  }
  const routeId = createRouteId(value.routeId);
  if (!routeId.ok) return routeId;
  if (!validImportedAt(value.importedAt)) {
    return failure(createError("DOMAIN_INVARIANT_VIOLATION", { field: "importedAt", reason: "non-canonical-utc" }));
  }

  const route = readQualifiedRoute(value.qualifiedRoute);
  const data: RouteAssetData = Object.freeze({
    ...route,
    waypoints: Object.freeze([...route.waypoints]),
    warnings: Object.freeze([...route.warnings]),
    originalBytes: new Uint8Array(route.originalBytes),
    routeId: routeId.value,
    importedAt: value.importedAt
  });
  return success(new InternalRouteAsset(data));
}

export function toSummary(asset: RouteAsset): RouteSummary {
  const data = readAsset(asset);
  return Object.freeze({
    routeId: data.routeId,
    displayName: data.displayName,
    format: data.format,
    classification: data.classification,
    waypointCount: data.waypoints.length,
    sha256: data.sha256,
    sizeBytes: data.sizeBytes,
    importedAt: data.importedAt
  });
}

export function toDetail(asset: RouteAsset): RouteDetail {
  const data = readAsset(asset);
  return Object.freeze({
    ...toSummary(asset),
    sourceDocument: data.sourceDocument,
    waypoints: Object.freeze(data.waypoints.map(copyWaypoint)),
    warnings: Object.freeze(data.warnings.map(copyWarning))
  });
}

export function copyOriginalBytes(asset: RouteAsset): Uint8Array {
  return new Uint8Array(readAsset(asset).originalBytes);
}
