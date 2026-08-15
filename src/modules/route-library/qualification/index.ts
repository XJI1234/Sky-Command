import { createQualifiedRoute, type DomainResult, type QualifiedRoute } from "../domain/index.js";
import type { ParsedRouteDocument } from "../importer/index.js";
import { qualifyCandidates } from "./internal/candidates.js";
import { classify } from "./internal/classify.js";
import { readDocument, validateLimits } from "./internal/input.js";
import type { RouteQualificationInterface, RouteQualificationLimits } from "./internal/types.js";

function qualify(document: ParsedRouteDocument, limits: RouteQualificationLimits): DomainResult<QualifiedRoute> {
  const validatedLimits = validateLimits(limits);
  if (!validatedLimits.ok) return validatedLimits;
  const parsed = readDocument(document, validatedLimits.value);
  if (!parsed.ok) return parsed;
  const waypoints = qualifyCandidates(parsed.value);
  if (!waypoints.ok) return waypoints;
  const classification = classify(parsed.value, waypoints.value.some((waypoint) => waypoint.altitude === null));
  return createQualifiedRoute({
    displayName: parsed.value.fileName,
    format: parsed.value.format,
    classification: classification.classification,
    sourceDocument: parsed.value.sourceDocument,
    waypoints: waypoints.value,
    warnings: classification.warnings,
    sha256: parsed.value.sha256,
    sizeBytes: parsed.value.sizeBytes,
    originalBytes: parsed.value.originalBytes
  });
}

export const RouteQualification: RouteQualificationInterface = Object.freeze({ qualify });

export type { RouteQualificationInterface, RouteQualificationLimits } from "./internal/types.js";
