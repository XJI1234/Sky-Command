import { describe, expect, it } from "vitest";
import { createRouteAsset, createRouteId, toDetail } from "../src/modules/route-library/domain/index.js";
import type { ParsedRouteDocument, RawWaypointCandidate } from "../src/modules/route-library/importer/index.js";
import { RouteQualification } from "../src/modules/route-library/qualification/index.js";

const limits = Object.freeze({ maxWaypoints: 10 });
const sha256 = "a".repeat(64);
const originalBytes = new Uint8Array([1, 2, 3]);

function candidate(overrides: Partial<RawWaypointCandidate> = {}): RawWaypointCandidate {
  return Object.freeze({
    documentOrder: 0,
    declaredSequenceText: null,
    longitudeText: "120.1665",
    latitudeText: "30.3214",
    altitudeText: "80",
    altitudeSource: "coordinate",
    malformed: false,
    rawSummary: "120.1665,30.3214,80",
    ...overrides
  });
}

function parsedDocument(overrides: Partial<ParsedRouteDocument> = {}): ParsedRouteDocument {
  return Object.freeze({
    fileName: "route.kml",
    format: "kml" as const,
    sourceDocument: "route.kml",
    sourceKind: "kml" as const,
    hasCompanionTemplate: false,
    wpmlNamespace: null,
    waypointCandidates: Object.freeze([
      candidate(),
      candidate({
        documentOrder: 1,
        longitudeText: "120.1670",
        latitudeText: "30.3220",
        altitudeText: null,
        altitudeSource: "missing",
        rawSummary: "120.1670,30.3220"
      })
    ]),
    sha256,
    sizeBytes: originalBytes.byteLength,
    originalBytes,
    ...overrides
  });
}

function qualifiedDetail(document: ParsedRouteDocument) {
  const qualified = RouteQualification.qualify(document, limits);
  expect(qualified.ok).toBe(true);
  if (!qualified.ok) throw qualified.error;
  const routeId = createRouteId("route-1");
  expect(routeId.ok).toBe(true);
  if (!routeId.ok) throw routeId.error;
  const asset = createRouteAsset({
    qualifiedRoute: qualified.value,
    routeId: routeId.value,
    importedAt: "2026-08-10T00:00:00.000Z"
  });
  expect(asset.ok).toBe(true);
  if (!asset.ok) throw asset.error;
  return toDetail(asset.value);
}

describe("D3.3 route qualification public contract", () => {
  it("classifies KML as preview-only and warns about missing altitude", () => {
    const detail = qualifiedDetail(parsedDocument());

    expect(detail.classification).toBe("preview-only");
    expect(detail.warnings.map((warning) => warning.code)).toEqual(["ALTITUDE_MISSING"]);
    expect(detail.waypoints.map((waypoint) => waypoint.sequence)).toEqual([0, 1]);
    expect(detail.waypoints[1]?.altitude).toBeNull();
  });

  it("classifies a valid WPML document as an upload candidate", () => {
    const detail = qualifiedDetail(parsedDocument({
      fileName: "mission.kmz",
      format: "kmz",
      sourceDocument: "wpmz/waylines.wpml",
      sourceKind: "waylines-wpml",
      hasCompanionTemplate: true,
      wpmlNamespace: "http://www.dji.com/wpmz/1.0.6/",
      waypointCandidates: Object.freeze([
        candidate({ declaredSequenceText: "0" }),
        candidate({
          documentOrder: 1,
          declaredSequenceText: "1",
          longitudeText: "120.1670",
          latitudeText: "30.3220"
        })
      ])
    }));

    expect(detail.classification).toBe("upload-candidate");
    expect(detail.warnings).toEqual([]);
  });

  it("classifies a KMZ whose selected source is KML as preview-only with WPML_MISSING", () => {
    const detail = qualifiedDetail(parsedDocument({
      fileName: "preview.kmz",
      format: "kmz",
      sourceDocument: "wpmz/template.kml"
    }));

    expect(detail.classification).toBe("preview-only");
    expect(detail.warnings.map((warning) => warning.code)).toEqual(["WPML_MISSING", "ALTITUDE_MISSING"]);
  });

  it("reports the concrete coordinate field and a bounded summary for an out-of-range candidate", () => {
    const result = RouteQualification.qualify(parsedDocument({
      waypointCandidates: Object.freeze([
        candidate({ longitudeText: "181", rawSummary: "181,30.3214,80" }),
        candidate({ documentOrder: 1, longitudeText: "120.1670", latitudeText: "30.3220" })
      ])
    }), limits);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_COORDINATE",
        details: { field: "longitude", index: 0, reason: "domain-rejected", rawSummary: "181,30.3214,80" }
      }
    });
  });

  it("rejects malformed, incomplete, and non-contiguous WPML candidates without returning a route", () => {
    const wpml = (waypointCandidates: readonly RawWaypointCandidate[]) => RouteQualification.qualify(parsedDocument({
      fileName: "mission.kmz",
      format: "kmz",
      sourceDocument: "wpmz/waylines.wpml",
      sourceKind: "waylines-wpml",
      wpmlNamespace: "https://www.dji.com/wpmz/1.0.6/",
      waypointCandidates
    }), limits);

    expect(wpml(Object.freeze([
      candidate({ declaredSequenceText: "0", malformed: true }),
      candidate({ documentOrder: 1, declaredSequenceText: "1" })
    ]))).toMatchObject({ ok: false, error: { code: "INVALID_COORDINATE", details: { field: "candidate", index: 0, reason: "malformed" } } });
    expect(wpml(Object.freeze([
      candidate({ declaredSequenceText: "0" }),
      candidate({ documentOrder: 1, declaredSequenceText: "2" })
    ]))).toMatchObject({ ok: false, error: { code: "INVALID_COORDINATE", details: { field: "sequence", index: 1, reason: "not-contiguous" } } });
    expect(wpml(Object.freeze([
      candidate({ declaredSequenceText: "00" }),
      candidate({ documentOrder: 1, declaredSequenceText: "1" })
    ]))).toMatchObject({ ok: false, error: { code: "INVALID_COORDINATE", details: { field: "sequence", index: 0, reason: "invalid-sequence" } } });
  });

  it("treats empty candidate collections as insufficient waypoints", () => {
    const result = RouteQualification.qualify(parsedDocument({ waypointCandidates: Object.freeze([]) }), limits);

    expect(result).toMatchObject({ ok: false, error: { code: "INSUFFICIENT_WAYPOINTS", details: { count: 0 } } });
  });

  it("rejects a forged candidate whose altitude source is outside the importer contract", () => {
    const result = RouteQualification.qualify(parsedDocument({
      waypointCandidates: Object.freeze([
        candidate({ altitudeSource: "invented" as never }),
        candidate({ documentOrder: 1, longitudeText: "120.1670", latitudeText: "30.3220" })
      ])
    }), limits);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "altitudeSource", index: 0 } }
    });
  });
});
