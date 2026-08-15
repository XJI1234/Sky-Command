import { createError, createWaypoint, type DomainResult, type RouteWaypoint } from "../../domain/index.js";
import { coordinateError, parseDecimal, parseSequence } from "./number.js";
import type { QualificationDocument } from "./types.js";

type Candidate = Readonly<{
  documentOrder: number;
  declaredSequenceText: string | null;
  longitudeText: string | null;
  latitudeText: string | null;
  altitudeText: string | null;
  altitudeSource: "coordinate" | "execute-height" | "ellipsoid-height" | "height" | "missing";
  malformed: boolean;
  rawSummary: string;
}>;

function invariant(field: string, reason: string, index: number): DomainResult<never> {
  return Object.freeze({ ok: false as const, error: createError("DOMAIN_INVARIANT_VIOLATION", { field, reason, index }) });
}

function readCandidate(value: unknown, index: number): DomainResult<Candidate> {
  if (typeof value !== "object" || value === null) return invariant("waypointCandidates", "invalid-candidate", index);
  try {
    const record = value as Record<string, unknown>;
    const documentOrder = record.documentOrder;
    const declaredSequenceText = record.declaredSequenceText;
    const longitudeText = record.longitudeText;
    const latitudeText = record.latitudeText;
    const altitudeText = record.altitudeText;
    const altitudeSource = record.altitudeSource;
    const malformed = record.malformed;
    const rawSummary = record.rawSummary;
    if (!Number.isSafeInteger(documentOrder) || documentOrder !== index) return invariant("documentOrder", "not-contiguous", index);
    if (declaredSequenceText !== null && typeof declaredSequenceText !== "string") return invariant("declaredSequenceText", "invalid-value", index);
    if (longitudeText !== null && typeof longitudeText !== "string") return invariant("longitudeText", "invalid-value", index);
    if (latitudeText !== null && typeof latitudeText !== "string") return invariant("latitudeText", "invalid-value", index);
    if (altitudeText !== null && typeof altitudeText !== "string") return invariant("altitudeText", "invalid-value", index);
    if (altitudeSource !== "coordinate" && altitudeSource !== "execute-height" && altitudeSource !== "ellipsoid-height" && altitudeSource !== "height" && altitudeSource !== "missing") {
      return invariant("altitudeSource", "unknown-value", index);
    }
    if ((altitudeText === null) !== (altitudeSource === "missing")) return invariant("altitudeSource", "text-mismatch", index);
    if (typeof malformed !== "boolean" || typeof rawSummary !== "string") return invariant("candidate", "invalid-shape", index);
    return Object.freeze({ ok: true as const, value: Object.freeze({ documentOrder, declaredSequenceText, longitudeText, latitudeText, altitudeText, altitudeSource, malformed, rawSummary }) });
  } catch {
    return invariant("candidate", "unreadable", index);
  }
}

export function qualifyCandidates(document: QualificationDocument): DomainResult<readonly RouteWaypoint[]> {
  const candidates: Candidate[] = [];
  for (let index = 0; index < document.candidates.length; index += 1) {
    const read = readCandidate(document.candidates[index], index);
    if (!read.ok) return read;
    candidates.push(read.value);
  }
  if (candidates.every((candidate) => candidate.longitudeText === null && candidate.latitudeText === null && candidate.rawSummary.length === 0)) {
    return Object.freeze({ ok: false as const, error: createError("INSUFFICIENT_WAYPOINTS", { count: 0 }) });
  }

  const waypoints: RouteWaypoint[] = [];
  for (const [index, candidate] of candidates.entries()) {
    if (candidate.malformed) return coordinateError("candidate", index, candidate.rawSummary, "malformed");
    if (candidate.longitudeText === null) return coordinateError("longitude", index, candidate.rawSummary, "missing");
    if (candidate.latitudeText === null) return coordinateError("latitude", index, candidate.rawSummary, "missing");
    if (document.sourceKind === "kml" && candidate.declaredSequenceText !== null) {
      return invariant("declaredSequenceText", "unexpected-kml-sequence", index);
    }
    const longitude = parseDecimal(candidate.longitudeText, "longitude", index, candidate.rawSummary);
    if (!longitude.ok) return longitude;
    const latitude = parseDecimal(candidate.latitudeText, "latitude", index, candidate.rawSummary);
    if (!latitude.ok) return latitude;
    const altitude = candidate.altitudeText === null
      ? Object.freeze({ ok: true as const, value: null })
      : parseDecimal(candidate.altitudeText, "altitude", index, candidate.rawSummary);
    if (!altitude.ok) return altitude;
    const sequence = document.sourceKind === "kml"
      ? Object.freeze({ ok: true as const, value: index })
      : parseSequence(candidate.declaredSequenceText, index, candidate.rawSummary);
    if (!sequence.ok) return sequence;
    if (sequence.value !== index) return coordinateError("sequence", index, candidate.rawSummary, "not-contiguous");
    const waypoint = createWaypoint({ longitude: longitude.value, latitude: latitude.value, altitude: altitude.value, sequence: sequence.value });
    if (!waypoint.ok) return coordinateError((waypoint.error.details as { readonly field: string }).field, index, candidate.rawSummary, "domain-rejected");
    waypoints.push(waypoint.value);
  }
  return Object.freeze({ ok: true as const, value: Object.freeze(waypoints) });
}
