import { createError } from "../domain/index.js";
import { calculateSha256 } from "./internal/digest.js";
import { readKmz } from "./internal/archive.js";
import { detectContainer, intakeFile } from "./internal/intake.js";
import { parsedOutcome, rejectedOutcome } from "./internal/outcome.js";
import { parseXmlDocument } from "./internal/xml.js";
import { ImporterCancelled, ImporterPhaseError } from "./internal/error-map.js";
import { throwIfCancelled } from "./internal/cancellation.js";
import type {
  RouteImportCancellation,
  RouteImportLimits,
  RouteIngestOutcome,
  RouteImporterInterface
} from "./internal/types.js";

async function ingest(
  fileName: unknown,
  bytes: unknown,
  limits: RouteImportLimits,
  cancellation?: RouteImportCancellation
): Promise<RouteIngestOutcome> {
  try {
    throwIfCancelled(cancellation);
    const intake = intakeFile(fileName, bytes, limits);
    if ("error" in intake) return rejectedOutcome(intake.error);
    const { snapshot } = intake;
    throwIfCancelled(cancellation);
    const detected = await detectContainer(snapshot.bytes, cancellation);
    if (
      detected === null
      || (snapshot.format === "kml" && detected.kind !== "xml")
      || (snapshot.format === "kmz" && detected.kind !== "zip")
    ) {
      return rejectedOutcome(createError("FORMAT_MISMATCH"));
    }
    const source = snapshot.format === "kmz"
      ? await readKmz(snapshot.bytes, snapshot.limits, cancellation)
      : Object.freeze({ ok: true as const, value: Object.freeze({ sourceDocument: snapshot.fileName, sourceKind: "kml" as const, xmlBytes: snapshot.bytes }) });
    if (!source.ok) return rejectedOutcome(source.error);
    const parsed = await parseXmlDocument(
      source.value.xmlBytes,
      source.value.sourceKind,
      snapshot.limits.maxWaypoints,
      cancellation,
      detected.xmlEncoding
    );
    if (!parsed.ok) return rejectedOutcome(parsed.error);
    const sha256 = await calculateSha256(snapshot.bytes, cancellation);
    throwIfCancelled(cancellation);
    return parsedOutcome({
      fileName: snapshot.fileName,
      format: snapshot.format,
      sourceDocument: source.value.sourceDocument,
      sourceKind: source.value.sourceKind,
      wpmlNamespace: parsed.value.wpmlNamespace,
      waypointCandidates: parsed.value.waypointCandidates,
      sha256,
      sizeBytes: snapshot.bytes.byteLength,
      snapshot: snapshot.bytes
    });
  } catch (error) {
    if (error instanceof ImporterCancelled) return Object.freeze({ status: "cancelled" });
    if (error instanceof ImporterPhaseError) return rejectedOutcome(createError(error.code, error.details));
    return rejectedOutcome(createError("DOMAIN_INVARIANT_VIOLATION", { phase: "ingest" }));
  }
}

export const RouteImporter: RouteImporterInterface = Object.freeze({
  ingest
});

export type {
  ParsedRouteDocument,
  RawWaypointAltitudeSource,
  RawWaypointCandidate,
  RouteImportCancellation,
  RouteImportLimits,
  RouteIngestOutcome,
  RouteImporterInterface
} from "./internal/types.js";
