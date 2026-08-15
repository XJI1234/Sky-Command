import {
  RouteImporter,
  type ParsedRouteDocument,
  type RawWaypointCandidate,
  type RouteImportCancellation,
  type RouteImportLimits,
  type RouteIngestOutcome
} from "../src/modules/route-library/importer/index.js";

const limits: RouteImportLimits = {
  maxFileBytes: 1,
  maxArchiveEntries: 1,
  maxExpandedBytes: 1,
  maxWaypoints: 1
};
const cancellation: RouteImportCancellation = { aborted: false };
const pending: Promise<RouteIngestOutcome> = RouteImporter.ingest("route.kml", new Uint8Array([1]), limits, cancellation);

function consume(outcome: RouteIngestOutcome): ParsedRouteDocument | undefined {
  if (outcome.status === "parsed") return outcome.document;
  if (outcome.status === "rejected") return undefined;
  return undefined;
}

declare const candidate: RawWaypointCandidate;
// @ts-expect-error Candidate properties are read-only.
candidate.longitudeText = "1";

void pending;
void consume;
