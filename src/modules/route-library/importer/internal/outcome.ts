import { createError, type RouteLibraryError } from "../../domain/index.js";
import type {
  ParsedRouteDocument,
  RawWaypointCandidate,
  RouteIngestOutcome
} from "./types.js";

export function rejectedOutcome(error: RouteLibraryError): RouteIngestOutcome {
  return Object.freeze({ status: "rejected", error });
}

interface ParsedOutcomeInput extends Omit<ParsedRouteDocument, "originalBytes" | "waypointCandidates"> {
  readonly waypointCandidates: readonly RawWaypointCandidate[];
  readonly snapshot: Uint8Array;
}

export function parsedOutcome(input: ParsedOutcomeInput): RouteIngestOutcome {
  const candidates = Object.freeze([...input.waypointCandidates]);
  const document = {
    fileName: input.fileName,
    format: input.format,
    sourceDocument: input.sourceDocument,
    sourceKind: input.sourceKind,
    wpmlNamespace: input.wpmlNamespace,
    waypointCandidates: candidates,
    sha256: input.sha256,
    sizeBytes: input.sizeBytes
  } as ParsedRouteDocument;
  Object.defineProperty(document, "originalBytes", {
    enumerable: true,
    get: () => input.snapshot.slice()
  });
  Object.freeze(document);
  return Object.freeze({ status: "parsed", document });
}
