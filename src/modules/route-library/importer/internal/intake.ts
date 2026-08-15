import { createError, type RouteFileFormat } from "../../domain/index.js";
import { detectXmlEncoding, type DetectedXmlEncoding } from "./encoding.js";
import type {
  IntakeRejection,
  IntakeResult,
  RouteImportCancellation,
  RouteImportLimits
} from "./types.js";

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;
const PATH_SEPARATOR = /[\\/]/u;
const DRIVE_PATH = /^[A-Za-z]:/u;

function rejected(code: Parameters<typeof createError>[0], details?: unknown): IntakeRejection {
  return Object.freeze({ error: createError(code, details) });
}

type LimitsRead =
  | Readonly<{ ok: true; value: RouteImportLimits }>
  | Readonly<{ ok: false; reason: "invalid" | "unreadable" }>;

function readLimits(limits: RouteImportLimits): LimitsRead {
  let captured: RouteImportLimits;
  try {
    captured = {
      maxFileBytes: limits.maxFileBytes,
      maxArchiveEntries: limits.maxArchiveEntries,
      maxExpandedBytes: limits.maxExpandedBytes,
      maxWaypoints: limits.maxWaypoints
    };
  } catch {
    return Object.freeze({ ok: false, reason: "unreadable" });
  }
  const values = Object.values(captured);
  if (!values.every((value) => Number.isSafeInteger(value) && value > 0)) {
    return Object.freeze({ ok: false, reason: "invalid" });
  }
  if (captured.maxExpandedBytes < captured.maxFileBytes) {
    return Object.freeze({ ok: false, reason: "invalid" });
  }
  return Object.freeze({ ok: true, value: Object.freeze(captured) });
}

function readFileName(fileName: unknown): { fileName: string; format: RouteFileFormat } | IntakeRejection {
  if (typeof fileName !== "string") return rejected("INVALID_FILE_NAME");
  const normalized = fileName.trim();
  if (
    normalized.length === 0
    || normalized === "."
    || normalized === ".."
    || PATH_SEPARATOR.test(normalized)
    || DRIVE_PATH.test(normalized)
    || CONTROL_CHARACTER.test(normalized)
  ) return rejected("INVALID_FILE_NAME");

  const lower = normalized.toLowerCase();
  const format: RouteFileFormat | undefined = lower.endsWith(".kml") ? "kml" : lower.endsWith(".kmz") ? "kmz" : undefined;
  if (format === undefined) return rejected("UNSUPPORTED_FORMAT");
  if (normalized.length === 4) return rejected("INVALID_FILE_NAME");
  return Object.freeze({ fileName: normalized, format });
}

function snapshotBytes(bytes: unknown, maxFileBytes: number): Uint8Array | IntakeRejection {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) return rejected("EMPTY_FILE");
    if (bytes.byteLength > maxFileBytes) {
      return rejected("FILE_TOO_LARGE", { sizeBytes: bytes.byteLength, maxFileBytes });
    }
    const snapshot = new Uint8Array(bytes.byteLength);
    snapshot.set(bytes);
    return snapshot;
  } catch {
    return rejected("EMPTY_FILE");
  }
}

export function intakeFile(
  fileName: unknown,
  bytes: unknown,
  limits: RouteImportLimits
): IntakeResult {
  const limitsRead = readLimits(limits);
  if (!limitsRead.ok) {
    return rejected("DOMAIN_INVARIANT_VIOLATION", { phase: "limits", reason: limitsRead.reason });
  }
  const safeLimits = limitsRead.value;

  const safeName = readFileName(fileName);
  if ("error" in safeName) return safeName;

  const snapshot = snapshotBytes(bytes, safeLimits.maxFileBytes);
  if (!(snapshot instanceof Uint8Array)) return snapshot;

  return Object.freeze({
    snapshot: Object.freeze({ ...safeName, bytes: snapshot, limits: safeLimits })
  });
}

export type DetectedContainer =
  | Readonly<{ readonly kind: "xml"; readonly xmlEncoding: DetectedXmlEncoding }>
  | Readonly<{ readonly kind: "zip"; readonly xmlEncoding: undefined }>;

export async function detectContainer(
  bytes: Uint8Array,
  cancellation?: RouteImportCancellation
): Promise<DetectedContainer | null> {
  const hasPrefix = (prefix: readonly number[]): boolean =>
    prefix.every((value, index) => bytes[index] === value);
  if (
    hasPrefix([0x50, 0x4b, 0x03, 0x04])
    || hasPrefix([0x50, 0x4b, 0x05, 0x06])
    || hasPrefix([0x50, 0x4b, 0x07, 0x08])
  ) return Object.freeze({ kind: "zip", xmlEncoding: undefined });
  const xmlEncoding = await detectXmlEncoding(bytes, cancellation);
  return xmlEncoding === null ? null : Object.freeze({ kind: "xml", xmlEncoding });
}
