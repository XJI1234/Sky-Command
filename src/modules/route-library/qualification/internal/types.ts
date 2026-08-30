import type { DomainResult, QualifiedRoute } from "../../domain/index.js";
import type { ParsedRouteDocument } from "../../importer/index.js";

export interface RouteQualificationLimits {
  readonly maxWaypoints: number;
}

export interface RouteQualificationInterface {
  qualify(document: ParsedRouteDocument, limits: RouteQualificationLimits): DomainResult<QualifiedRoute>;
}

export interface QualificationDocument {
  readonly fileName: string;
  readonly format: "kml" | "kmz";
  readonly sourceDocument: string;
  readonly sourceKind: "kml" | "waylines-wpml";
  readonly hasCompanionTemplate: boolean;
  readonly wpmlNamespace: string | null;
  readonly candidates: readonly unknown[];
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly originalBytes: Uint8Array;
}
