import { cloneStrictJson, createError } from "./errors.js";
import {
  failure,
  success,
  type CreateQualifiedRouteInput,
  type DomainResult,
  type JsonValue,
  type QualifiedRoute,
  type QualifiedRouteData,
  type RouteClassification,
  type RouteFileFormat,
  type RouteWarning,
  type RouteWarningCode,
  type RouteWaypoint,
  qualifiedRouteBrand
} from "./types.js";
import { InternalWaypoint } from "./values.js";

const CONTROL_CHARACTER = /\p{Cc}/u;
const SHA256 = /^[a-f0-9]{64}$/;
const FORMAT_VALUES: readonly RouteFileFormat[] = ["kml", "kmz"];
const CLASSIFICATION_VALUES: readonly RouteClassification[] = ["preview-only", "upload-candidate"];
const WARNING_ORDER: Readonly<Record<RouteWarningCode, number>> = {
  WPML_MISSING: 0,
  ALTITUDE_MISSING: 1
};

function invariant(field: string, reason: string): DomainResult<never> {
  return failure(createError("DOMAIN_INVARIANT_VIOLATION", { field, reason }));
}

function validDisplayName(value: unknown): value is string {
  return typeof value === "string"
    && value.trim() === value
    && !/[\\/\0]/.test(value)
    && !CONTROL_CHARACTER.test(value)
    && !/^[A-Za-z]:/.test(value)
    && /\.(?:kml|kmz)$/i.test(value);
}

function validSourceDocument(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() !== value) return false;
  if (/[\\\0]/.test(value) || CONTROL_CHARACTER.test(value) || /^(?:\/|[A-Za-z]:)/.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isFormat(value: unknown): value is RouteFileFormat {
  return FORMAT_VALUES.includes(value as RouteFileFormat);
}

function isClassification(value: unknown): value is RouteClassification {
  return CLASSIFICATION_VALUES.includes(value as RouteClassification);
}

function snapshotQualifiedRouteInput(input: unknown): CreateQualifiedRouteInput | undefined {
  try {
    const value = input as CreateQualifiedRouteInput;
    return {
      displayName: value.displayName,
      format: value.format,
      classification: value.classification,
      sourceDocument: value.sourceDocument,
      waypoints: value.waypoints,
      warnings: value.warnings,
      sha256: value.sha256,
      sizeBytes: value.sizeBytes,
      originalBytes: value.originalBytes
    };
  } catch {}
}

function normalizeWarnings(value: unknown): DomainResult<readonly RouteWarning[]> {
  if (!Array.isArray(value)) return invariant("warnings", "not-array");
  const seen = new Set<RouteWarningCode>();
  const normalized: RouteWarning[] = [];

  for (const candidate of value) {
    if (candidate === null || candidate === undefined) return invariant("warnings", "invalid-warning");
    const record = candidate as Record<string, unknown>;
    if (record.code !== "WPML_MISSING" && record.code !== "ALTITUDE_MISSING") {
      return invariant("warnings", "unknown-code");
    }
    if (seen.has(record.code)) return invariant("warnings", "duplicate-code");
    if (typeof record.message !== "string" || record.message.trim().length === 0) {
      return invariant("warnings", "empty-message");
    }

    let details: JsonValue | undefined;
    if (record.details !== undefined) {
      details = cloneStrictJson(record.details);
      if (details === undefined) return invariant("warnings", "unsafe-details");
    }
    seen.add(record.code);
    normalized.push(Object.freeze({
      code: record.code,
      message: record.message,
      ...(details === undefined ? {} : { details })
    }));
  }

  normalized.sort((left, right) => WARNING_ORDER[left.code] - WARNING_ORDER[right.code]);
  return success(Object.freeze(normalized));
}

export class InternalQualifiedRoute implements QualifiedRoute {
  readonly #authentic: undefined = undefined;
  declare readonly [qualifiedRouteBrand]: true;
  readonly #data: QualifiedRouteData;

  constructor(data: QualifiedRouteData) {
    Object.defineProperty(this, qualifiedRouteBrand, { value: true });
    this.#data = data;
    Object.freeze(this);
  }

  static is(value: unknown): value is InternalQualifiedRoute {
    return typeof value === "object" && value !== null && #authentic in value;
  }

  static read(value: InternalQualifiedRoute): QualifiedRouteData {
    return value.#data;
  }
}

export function readQualifiedRoute(value: QualifiedRoute): QualifiedRouteData {
  return InternalQualifiedRoute.read(value as InternalQualifiedRoute);
}

export function createQualifiedRoute(input: CreateQualifiedRouteInput): DomainResult<QualifiedRoute> {
  const value = snapshotQualifiedRouteInput(input);
  if (value === undefined) return invariant("input", "invalid-container");

  if (!validDisplayName(value.displayName)) {
    return failure(createError("INVALID_FILE_NAME", { field: "displayName", reason: "invalid-format" }));
  }
  if (!isFormat(value.format)) return invariant("format", "unknown-value");
  if (!isClassification(value.classification)) return invariant("classification", "unknown-value");
  if (value.displayName.toLowerCase().endsWith(`.${value.format}`) === false) {
    return invariant("format", "extension-mismatch");
  }
  if (!validSourceDocument(value.sourceDocument)) return invariant("sourceDocument", "unsafe-path");
  if (typeof value.sha256 !== "string" || !SHA256.test(value.sha256)) return invariant("sha256", "invalid-format");
  if (!(value.originalBytes instanceof Uint8Array) || value.originalBytes.length === 0) {
    return invariant("originalBytes", "empty-or-invalid");
  }
  if (value.sizeBytes !== value.originalBytes.length) {
    return invariant("sizeBytes", "length-mismatch");
  }
  if (!Array.isArray(value.waypoints) || value.waypoints.length < 2) {
    return failure(createError("INSUFFICIENT_WAYPOINTS", { count: Array.isArray(value.waypoints) ? value.waypoints.length : 0 }));
  }

  for (let index = 0; index < value.waypoints.length; index += 1) {
    const point = value.waypoints[index];
    if (!InternalWaypoint.is(point)) {
      return failure(createError("INVALID_COORDINATE", { field: "waypoints", sequence: index, reason: "untrusted-waypoint" }));
    }
    if (point.sequence !== index) return invariant("waypoints", "non-contiguous-sequence");
  }

  const warningResult = normalizeWarnings(value.warnings);
  if (!warningResult.ok) return warningResult;
  const warnings = warningResult.value;
  const hasWpmlMissing = warnings.some((warning) => warning.code === "WPML_MISSING");
  const hasAltitudeMissing = warnings.some((warning) => warning.code === "ALTITUDE_MISSING");
  const altitudeMissing = value.waypoints.some((point) => point.altitude === null);

  if (hasAltitudeMissing !== altitudeMissing) return invariant("warnings", "altitude-warning-mismatch");
  if (value.format === "kml") {
    if (value.classification !== "preview-only" || hasWpmlMissing) return invariant("classification", "invalid-kml-combination");
  } else if (value.classification === "upload-candidate") {
    if (!value.sourceDocument.toLowerCase().endsWith(".wpml") || hasWpmlMissing) {
      return invariant("classification", "invalid-upload-combination");
    }
  } else if (!hasWpmlMissing || value.sourceDocument.toLowerCase().endsWith(".wpml")) {
    return invariant("classification", "invalid-preview-combination");
  }

  const data: QualifiedRouteData = Object.freeze({
    displayName: value.displayName,
    format: value.format,
    classification: value.classification,
    sourceDocument: value.sourceDocument,
    waypoints: Object.freeze([...value.waypoints]),
    warnings,
    sha256: value.sha256,
    sizeBytes: value.sizeBytes as number,
    originalBytes: new Uint8Array(value.originalBytes)
  });
  return success(new InternalQualifiedRoute(data));
}
