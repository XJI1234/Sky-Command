import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import type { ParsedRouteDocument, RawWaypointCandidate } from "../src/modules/route-library/importer/index.js";
import { RouteQualification } from "../src/modules/route-library/qualification/index.js";

const bytes = new Uint8Array([1, 2, 3]);

function largeDocument(count: number): ParsedRouteDocument {
  const candidates: RawWaypointCandidate[] = Array.from({ length: count }, (_, index) => Object.freeze({
    documentOrder: index,
    declaredSequenceText: null,
    longitudeText: `${120 + index / 1_000_000}`,
    latitudeText: "30.2",
    altitudeText: "50",
    altitudeSource: "coordinate" as const,
    malformed: false,
    rawSummary: "coordinate"
  }));
  return Object.freeze({
    fileName: "large.kml",
    format: "kml" as const,
    sourceDocument: "large.kml",
    sourceKind: "kml" as const,
    hasCompanionTemplate: false,
    wpmlNamespace: null,
    waypointCandidates: Object.freeze(candidates),
    sha256: "d".repeat(64),
    sizeBytes: bytes.byteLength,
    originalBytes: bytes
  });
}

describe("D3.3 route qualification performance", () => {
  it("qualifies 100,000 candidates with linear work and rejects the next candidate", () => {
    const limits = Object.freeze({ maxWaypoints: 100_000 });
    const startedAt = performance.now();
    const qualified = RouteQualification.qualify(largeDocument(100_000), limits);
    const duration = performance.now() - startedAt;

    expect(qualified.ok).toBe(true);
    expect(duration).toBeLessThan(10_000);
    expect(RouteQualification.qualify(largeDocument(100_001), limits)).toMatchObject({
      ok: false,
      error: { code: "TOO_MANY_WAYPOINTS" }
    });
  }, 30_000);
});
