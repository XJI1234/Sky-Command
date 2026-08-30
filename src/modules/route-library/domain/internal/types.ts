const routeIdBrand: unique symbol = Symbol("RouteId");
export const waypointBrand: unique symbol = Symbol("RouteWaypoint");
export const qualifiedRouteBrand: unique symbol = Symbol("QualifiedRoute");
export const routeAssetBrand: unique symbol = Symbol("RouteAsset");

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type RouteErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_FILE_NAME"
  | "UNSUPPORTED_FORMAT"
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "FORMAT_MISMATCH"
  | "INVALID_XML"
  | "EXTERNAL_ENTITY_FORBIDDEN"
  | "CORRUPT_KMZ"
  | "ENCRYPTED_KMZ"
  | "ARCHIVE_ENTRY_LIMIT"
  | "ARCHIVE_EXPANSION_LIMIT"
  | "UNSAFE_ARCHIVE_PATH"
  | "ROUTE_DOCUMENT_MISSING"
  | "INSUFFICIENT_WAYPOINTS"
  | "INVALID_COORDINATE"
  | "TOO_MANY_WAYPOINTS"
  | "DOMAIN_INVARIANT_VIOLATION"
  | "ROUTE_NOT_FOUND"
  | "ROUTE_NOT_UPLOADABLE"
  | "MAP_INITIALIZATION_FAILED"
  | "BASEMAP_LOAD_FAILED"
  | "CITY_MODEL_LOAD_FAILED";

export interface RouteLibraryError {
  readonly code: RouteErrorCode;
  readonly message: string;
  readonly recoverable: boolean;
  readonly details?: JsonValue;
}

export type DomainResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: RouteLibraryError }>;

export type RouteId = string & { readonly [routeIdBrand]: true };

export interface CreateWaypointInput {
  readonly longitude: unknown;
  readonly latitude: unknown;
  readonly altitude: unknown;
  readonly sequence: unknown;
}

export interface RouteWaypoint {
  readonly longitude: number;
  readonly latitude: number;
  readonly altitude: number | null;
  readonly sequence: number;
  readonly [waypointBrand]: true;
}

export type RouteFileFormat = "kml" | "kmz";
export type RouteClassification = "preview-only" | "upload-candidate";
export type RouteWarningCode = "WPML_MISSING" | "DJI_TEMPLATE_MISSING" | "ALTITUDE_MISSING";

export interface RouteWarning {
  readonly code: RouteWarningCode;
  readonly message: string;
  readonly details?: JsonValue;
}

export interface CreateQualifiedRouteInput {
  readonly displayName: unknown;
  readonly format: unknown;
  readonly classification: unknown;
  readonly sourceDocument: unknown;
  readonly waypoints: readonly RouteWaypoint[];
  readonly warnings: readonly RouteWarning[];
  readonly sha256: unknown;
  readonly sizeBytes: unknown;
  readonly originalBytes: Uint8Array;
}

export interface QualifiedRoute {
  readonly [qualifiedRouteBrand]: true;
}

export interface CreateRouteAssetInput {
  readonly qualifiedRoute: QualifiedRoute;
  readonly routeId: RouteId;
  readonly importedAt: unknown;
}

export interface RouteAsset {
  readonly [routeAssetBrand]: true;
}

export interface RouteSummary {
  readonly routeId: string;
  readonly displayName: string;
  readonly format: RouteFileFormat;
  readonly classification: RouteClassification;
  readonly waypointCount: number;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly importedAt: string;
}

export interface RouteDetail extends RouteSummary {
  readonly sourceDocument: string;
  readonly waypoints: readonly RouteWaypoint[];
  readonly warnings: readonly RouteWarning[];
}

export interface QualifiedRouteData {
  readonly displayName: string;
  readonly format: RouteFileFormat;
  readonly classification: RouteClassification;
  readonly sourceDocument: string;
  readonly waypoints: readonly RouteWaypoint[];
  readonly warnings: readonly RouteWarning[];
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly originalBytes: Uint8Array;
}

export interface RouteAssetData extends QualifiedRouteData {
  readonly routeId: RouteId;
  readonly importedAt: string;
}

export function success<T>(value: T): DomainResult<T> {
  return Object.freeze({ ok: true as const, value });
}

export function failure<T>(error: RouteLibraryError): DomainResult<T> {
  return Object.freeze({ ok: false as const, error });
}
