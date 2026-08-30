import type { RouteFileFormat, RouteLibraryError } from "../../domain/index.js";

export interface RouteImportLimits {
  readonly maxFileBytes: number;
  readonly maxArchiveEntries: number;
  readonly maxExpandedBytes: number;
  readonly maxWaypoints: number;
}

export interface RouteImportCancellation {
  readonly aborted: boolean;
}

export type RawWaypointAltitudeSource =
  | "coordinate"
  | "execute-height"
  | "ellipsoid-height"
  | "height"
  | "missing";

export interface RawWaypointCandidate {
  readonly documentOrder: number;
  readonly declaredSequenceText: string | null;
  readonly longitudeText: string | null;
  readonly latitudeText: string | null;
  readonly altitudeText: string | null;
  readonly altitudeSource: RawWaypointAltitudeSource;
  readonly malformed: boolean;
  readonly rawSummary: string;
}

export interface ParsedRouteDocument {
  readonly fileName: string;
  readonly format: RouteFileFormat;
  readonly sourceDocument: string;
  readonly sourceKind: "kml" | "waylines-wpml";
  /** True only when the selected WPML has a sibling template.kml in the same KMZ directory. */
  readonly hasCompanionTemplate: boolean;
  readonly wpmlNamespace: string | null;
  readonly waypointCandidates: readonly RawWaypointCandidate[];
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly originalBytes: Uint8Array;
}

export type RouteIngestOutcome =
  | Readonly<{ status: "parsed"; document: ParsedRouteDocument }>
  | Readonly<{ status: "rejected"; error: RouteLibraryError }>
  | Readonly<{ status: "cancelled" }>;

export interface FileSnapshot {
  readonly fileName: string;
  readonly format: RouteFileFormat;
  readonly bytes: Uint8Array;
  readonly limits: RouteImportLimits;
}

export type IntakeRejection = Readonly<{ error: RouteLibraryError }>;

export type IntakeResult =
  | Readonly<{ snapshot: FileSnapshot }>
  | IntakeRejection;

export interface RouteImporterInterface {
  ingest(
    fileName: unknown,
    bytes: unknown,
    limits: RouteImportLimits,
    cancellation?: RouteImportCancellation
  ): Promise<RouteIngestOutcome>;
}
