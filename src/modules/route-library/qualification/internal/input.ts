import { createError, type DomainResult } from "../../domain/index.js";
import type { QualificationDocument, RouteQualificationLimits } from "./types.js";

const CONTROL = /\p{Cc}/u;
const DJI_WPML_HTTP_PREFIX = "http://www.dji.com/wpmz/";
const DJI_WPML_HTTPS_PREFIX = "https://www.dji.com/wpmz/";

function invariant(field: string, reason: string): DomainResult<never> {
  return Object.freeze({ ok: false as const, error: createError("DOMAIN_INVARIANT_VIOLATION", { field, reason }) });
}

function safeName(value: unknown): string | undefined {
  const name = value as string;
  if (name.length === 0) return "empty";
  if (name.trim() !== name) return "edge-whitespace";
  if (/[\\/\0]/u.test(name) || CONTROL.test(name)) return "unsafe-character";
  if (/^[A-Za-z]:/u.test(name)) return "drive-prefix";
  if (!/\.(?:kml|kmz)$/iu.test(name)) return "extension";
  return undefined;
}

function safeSource(value: unknown): string | undefined {
  const source = value as string;
  if (source.length === 0) return "empty";
  if (source.trim() !== source) return "edge-whitespace";
  if (/[\\\0]/u.test(source) || CONTROL.test(source)) return "unsafe-character";
  if (/^(?:\/|[A-Za-z]:)/u.test(source)) return "absolute-path";
  const segments = source.split("/");
  if (segments.some((segment) => segment === "..")) return "parent-segment";
  if (segments.some((segment) => segment.length === 0)) return "empty-segment";
  if (segments.some((segment) => segment === ".")) return "dot-segment";
  return undefined;
}

function isDjiWpmlNamespace(value: string): boolean {
  return (value.startsWith(DJI_WPML_HTTP_PREFIX) && value.length > DJI_WPML_HTTP_PREFIX.length)
    || (value.startsWith(DJI_WPML_HTTPS_PREFIX) && value.length > DJI_WPML_HTTPS_PREFIX.length);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  return value as Record<string, unknown>;
}

function readLimits(limits: unknown): DomainResult<RouteQualificationLimits> {
  const record = readRecord(limits);
  if (record === undefined) return invariant("limits", "invalid-container");
  try {
    if (!Number.isSafeInteger(record.maxWaypoints) || (record.maxWaypoints as number) <= 0) {
      return invariant("maxWaypoints", "not-positive-safe-integer");
    }
    return Object.freeze({ ok: true as const, value: Object.freeze({ maxWaypoints: record.maxWaypoints as number }) });
  } catch {
    return invariant("limits", "unreadable");
  }
}

export function validateLimits(limits: unknown): DomainResult<RouteQualificationLimits> {
  return readLimits(limits);
}

export function readDocument(value: unknown, limits: RouteQualificationLimits): DomainResult<QualificationDocument> {
  const record = readRecord(value);
  if (record === undefined) return invariant("document", "invalid-container");
  try {
    const fileName = record.fileName;
    const format = record.format;
    const sourceDocument = record.sourceDocument;
    const sourceKind = record.sourceKind;
    const wpmlNamespace = record.wpmlNamespace;
    const candidates = record.waypointCandidates;
    const sha256 = record.sha256;
    const sizeBytes = record.sizeBytes;
    const originalBytes = record.originalBytes;

    if (typeof fileName !== "string") return invariant("fileName", "not-string");
    const fileNameReason = safeName(fileName);
    if (fileNameReason !== undefined) return invariant("fileName", fileNameReason);
    if (typeof sourceDocument !== "string") return invariant("sourceDocument", "not-string");
    const sourceReason = safeSource(sourceDocument);
    if (sourceReason !== undefined) return invariant("sourceDocument", sourceReason);
    if (sourceKind !== "kml" && sourceKind !== "waylines-wpml") return invariant("sourceKind", "unknown-value");
    if (wpmlNamespace !== null && typeof wpmlNamespace !== "string") return invariant("wpmlNamespace", "invalid-value");
    if (!Array.isArray(candidates)) return invariant("waypointCandidates", "not-array");
    if (candidates.length > limits.maxWaypoints) {
      return Object.freeze({ ok: false as const, error: createError("TOO_MANY_WAYPOINTS", { count: candidates.length, maxWaypoints: limits.maxWaypoints }) });
    }
    const sourceExtension = sourceDocument.toLowerCase();
    if (format === "kml" && (sourceKind !== "kml" || !sourceExtension.endsWith(".kml"))) {
      return invariant("sourceKind", "invalid-kml-combination");
    }
    if (sourceKind === "kml" && !sourceExtension.endsWith(".kml")) {
      return invariant("sourceDocument", "invalid-kmz-kml-source");
    }
    if (sourceKind === "waylines-wpml") {
      if (!sourceExtension.endsWith(".wpml") || wpmlNamespace === null || !isDjiWpmlNamespace(wpmlNamespace)) {
        return invariant("sourceKind", "invalid-wpml-combination");
      }
    }

    return Object.freeze({
      ok: true as const,
      value: Object.freeze({
        fileName,
        format: format as "kml" | "kmz",
        sourceDocument,
        sourceKind,
        wpmlNamespace,
        candidates: Object.freeze([...candidates]),
        // D3.1 owns final immutable route metadata validation.
        sha256: sha256 as string,
        sizeBytes: sizeBytes as number,
        originalBytes: originalBytes as Uint8Array
      })
    });
  } catch {
    return invariant("document", "unreadable");
  }
}
