import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ParsedRouteDocument, RawWaypointCandidate } from "../src/modules/route-library/importer/index.js";
import { RouteQualification } from "../src/modules/route-library/qualification/index.js";

const bytes = new Uint8Array([1, 2, 3]);
const limits = Object.freeze({ maxWaypoints: 12 });

function document(candidates: readonly RawWaypointCandidate[]): ParsedRouteDocument {
  return Object.freeze({
    fileName: "property.kml",
    format: "kml" as const,
    sourceDocument: "property.kml",
    sourceKind: "kml" as const,
    wpmlNamespace: null,
    waypointCandidates: Object.freeze(candidates),
    sha256: "c".repeat(64),
    sizeBytes: bytes.byteLength,
    originalBytes: bytes
  });
}

function candidate(index: number, longitudeText: string, latitudeText: string, altitudeText: string | null): RawWaypointCandidate {
  return Object.freeze({
    documentOrder: index,
    declaredSequenceText: null,
    longitudeText,
    latitudeText,
    altitudeText,
    altitudeSource: altitudeText === null ? "missing" as const : "coordinate" as const,
    malformed: false,
    rawSummary: `${longitudeText},${latitudeText}${altitudeText === null ? "" : `,${altitudeText}`}`
  });
}

describe("D3.3 route qualification properties", () => {
  it("accepts arbitrary in-range finite KML coordinate sequences", () => {
    const point = fc.tuple(
      fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true }),
      fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true }),
      fc.option(fc.double({ min: -10_000, max: 10_000, noNaN: true, noDefaultInfinity: true }), { nil: null })
    );
    fc.assert(fc.property(fc.array(point, { minLength: 2, maxLength: 12 }), (points) => {
      const result = RouteQualification.qualify(document(points.map(([longitude, latitude, altitude], index) => candidate(index, `${longitude}`, `${latitude}`, altitude === null ? null : `${altitude}`))), limits);
      expect(result.ok).toBe(true);
    }), { numRuns: 100 });
  });

  it("never throws for arbitrary candidate lexical fields", () => {
    const text = fc.string({ maxLength: 180 });
    fc.assert(fc.property(text, text, text, (longitude, latitude, altitude) => {
      expect(() => RouteQualification.qualify(document([
        candidate(0, longitude, latitude, altitude),
        candidate(1, "120", "30", null)
      ]), limits)).not.toThrow();
    }), { numRuns: 200 });
  });
});
