import { describe, expect, it } from "vitest";
import type { ParsedRouteDocument, RawWaypointCandidate } from "../src/modules/route-library/importer/index.js";
import { RouteQualification } from "../src/modules/route-library/qualification/index.js";

const bytes = new Uint8Array([1, 2, 3]);
const sha256 = "b".repeat(64);
const limits = Object.freeze({ maxWaypoints: 4 });

function candidate(overrides: Record<string, unknown> = {}): RawWaypointCandidate {
  return Object.freeze({
    documentOrder: 0,
    declaredSequenceText: null,
    longitudeText: "120",
    latitudeText: "30",
    altitudeText: "1",
    altitudeSource: "coordinate",
    malformed: false,
    rawSummary: "120,30,1",
    ...overrides
  }) as RawWaypointCandidate;
}

function document(overrides: Record<string, unknown> = {}): ParsedRouteDocument {
  return Object.freeze({
    fileName: "route.kml",
    format: "kml",
    sourceDocument: "route.kml",
    sourceKind: "kml",
    hasCompanionTemplate: false,
    wpmlNamespace: null,
    waypointCandidates: Object.freeze([
      candidate(),
      candidate({ documentOrder: 1, longitudeText: "121" })
    ]),
    sha256,
    sizeBytes: bytes.byteLength,
    originalBytes: bytes,
    ...overrides
  }) as ParsedRouteDocument;
}

function errorCode(input: unknown, inputLimits: unknown = limits) {
  const result = RouteQualification.qualify(input as ParsedRouteDocument, inputLimits as never);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected qualification rejection");
  return result.error;
}

describe("D3.3 route qualification defensive contract", () => {
  it("rejects invalid limits and unreadable documents as domain invariant violations", () => {
    expect(errorCode(document(), { maxWaypoints: 0 })).toMatchObject({ code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "maxWaypoints", reason: "not-positive-safe-integer" } });
    expect(errorCode(document(), null)).toMatchObject({ code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "limits", reason: "invalid-container" } });
    expect(errorCode(document(), 7)).toMatchObject({ code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "limits", reason: "invalid-container" } });
    const unreadableLimits = new Proxy({}, { get() { throw new Error("no read"); } });
    expect(errorCode(document(), unreadableLimits)).toMatchObject({ code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "limits", reason: "unreadable" } });
    expect(errorCode(null)).toMatchObject({ code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "document", reason: "invalid-container" } });
    expect(errorCode(7)).toMatchObject({ code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "document", reason: "invalid-container" } });
    const unreadable = new Proxy({}, { get() { throw new Error("no read"); } });
    expect(errorCode(unreadable)).toMatchObject({ code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "document", reason: "unreadable" } });
  });

  it("rejects invalid document metadata before creating a route", () => {
    const cases: readonly [Record<string, unknown>, string, string][] = [
      [{ fileName: null }, "fileName", "not-string"],
      [{ fileName: "" }, "fileName", "empty"],
      [{ fileName: " route.kml" }, "fileName", "edge-whitespace"],
      [{ fileName: "route.txt" }, "fileName", "extension"],
      [{ fileName: "route.kml.bak" }, "fileName", "extension"],
      [{ fileName: "C:route.kml" }, "fileName", "drive-prefix"],
      [{ fileName: "../route.kml" }, "fileName", "unsafe-character"],
      [{ format: "zip" }, "format", "unknown-value"],
      [{ fileName: "route.kmz" }, "format", "extension-mismatch"],
      [{ sourceDocument: "../route.kml" }, "sourceDocument", "parent-segment"],
      [{ sourceDocument: "" }, "sourceDocument", "empty"],
      [{ sourceDocument: " route.kml" }, "sourceDocument", "edge-whitespace"],
      [{ sourceDocument: "route\u0000.kml" }, "sourceDocument", "unsafe-character"],
      [{ sourceDocument: "folder/\u0001route.kml" }, "sourceDocument", "unsafe-character"],
      [{ sourceDocument: "/route.kml" }, "sourceDocument", "absolute-path"],
      [{ sourceDocument: "C:/route.kml" }, "sourceDocument", "absolute-path"],
      [{ sourceDocument: "folder//route.kml" }, "sourceDocument", "empty-segment"],
      [{ sourceDocument: "." }, "sourceDocument", "dot-segment"],
      [{ sourceDocument: "folder/./route.kml" }, "sourceDocument", "dot-segment"],
      [{ sourceDocument: null }, "sourceDocument", "not-string"],
      [{ sourceKind: "xml" }, "sourceKind", "unknown-value"],
      [{ wpmlNamespace: 9 }, "wpmlNamespace", "invalid-value"],
      [{ waypointCandidates: null }, "waypointCandidates", "not-array"],
      [{ sha256: "ABC" }, "sha256", "invalid-format"],
      [{ originalBytes: new Uint8Array() }, "originalBytes", "empty-or-invalid"],
      [{ sizeBytes: 2 }, "sizeBytes", "length-mismatch"],
      [{ sourceKind: "waylines-wpml" }, "sourceKind", "invalid-kml-combination"],
      [{ fileName: "route.kmz", format: "kmz", sourceDocument: "wpmz/template.wpml", sourceKind: "kml" }, "sourceDocument", "invalid-kmz-kml-source"],
      [{ fileName: "route.kmz", format: "kmz", sourceDocument: "wpmz/waylines.wpml", sourceKind: "waylines-wpml", wpmlNamespace: null }, "sourceKind", "invalid-wpml-combination"]
    ];
    for (const [overrides, field, reason] of cases) {
      expect(errorCode(document(overrides))).toMatchObject({ code: "DOMAIN_INVARIANT_VIOLATION", details: { field, reason } });
    }
    expect(errorCode(document({ waypointCandidates: Object.freeze([candidate(), candidate({ documentOrder: 1 }), candidate({ documentOrder: 2 }), candidate({ documentOrder: 3 }), candidate({ documentOrder: 4 })]) }))).toMatchObject({
      code: "TOO_MANY_WAYPOINTS", details: { count: 5, maxWaypoints: 4 }
    });
  });

  it("requires an explicit companion-template fact and only permits it for DJI WPML KMZ sources", () => {
    expect(errorCode(document({ hasCompanionTemplate: undefined }))).toMatchObject({
      code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "hasCompanionTemplate", reason: "not-boolean" }
    });
    expect(errorCode(document({ hasCompanionTemplate: true }))).toMatchObject({
      code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "hasCompanionTemplate", reason: "invalid-source-combination" }
    });
  });

  it("keeps accepted relative sources outside the path patterns that must be rejected", () => {
    expect(RouteQualification.qualify(document({ sourceDocument: "1:route.kml" }), limits)).toMatchObject({ ok: true });
  });

  it("rejects each invalid size shape even when it can equal the byte length after coercion", () => {
    for (const sizeBytes of [0, -1, 1.5, "3", Number.MAX_SAFE_INTEGER + 1] as const) {
      expect(errorCode(document({ sizeBytes }))).toMatchObject({
        code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "sizeBytes", reason: "length-mismatch" }
      });
    }
  });

  it("requires a fully anchored SHA-256 and a complete DJI WPML namespace URI", () => {
    expect(errorCode(document({ sha256: `x${"b".repeat(64)}` }))).toMatchObject({
      code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "sha256", reason: "invalid-format" }
    });
    expect(errorCode(document({ sha256: `${"b".repeat(64)}x` }))).toMatchObject({
      code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "sha256", reason: "invalid-format" }
    });
    const wpml = (wpmlNamespace: unknown) => document({
      fileName: "mission.kmz",
      format: "kmz",
      sourceDocument: "wpmz/waylines.wpml",
      sourceKind: "waylines-wpml",
      wpmlNamespace
    });
    expect(errorCode(wpml("xhttps://www.dji.com/wpmz/1.0.6/"))).toMatchObject({
      code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "sourceKind", reason: "invalid-wpml-combination" }
    });
    expect(errorCode(wpml("https://www.dji.com/wpmz/"))).toMatchObject({
      code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "sourceKind", reason: "invalid-wpml-combination" }
    });
    expect(errorCode(wpml("http://www.dji.com/wpmz/"))).toMatchObject({
      code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "sourceKind", reason: "invalid-wpml-combination" }
    });
  });

  it("rejects a source extension that conflicts with the selected KML or WPML source kind", () => {
    expect(errorCode(document({ sourceDocument: "route.wpml" }))).toMatchObject({
      code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "sourceKind", reason: "invalid-kml-combination" }
    });
    expect(errorCode(document({
      fileName: "mission.kmz",
      format: "kmz",
      sourceDocument: "wpmz/template.kml",
      sourceKind: "waylines-wpml",
      wpmlNamespace: "https://www.dji.com/wpmz/1.0.6/"
    }))).toMatchObject({
      code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "sourceKind", reason: "invalid-wpml-combination" }
    });
  });

  it("rejects forged candidate shapes and preserves the candidate index", () => {
    const withFirst = (first: unknown) => document({ waypointCandidates: Object.freeze([first, candidate({ documentOrder: 1 })]) });
    const cases: readonly [unknown, string, string][] = [
      [null, "waypointCandidates", "invalid-candidate"],
      [7, "waypointCandidates", "invalid-candidate"],
      [candidate({ documentOrder: 7 }), "documentOrder", "not-contiguous"],
      [candidate({ declaredSequenceText: 1 }), "declaredSequenceText", "invalid-value"],
      [candidate({ longitudeText: 1 }), "longitudeText", "invalid-value"],
      [candidate({ latitudeText: 1 }), "latitudeText", "invalid-value"],
      [candidate({ altitudeText: 1 }), "altitudeText", "invalid-value"],
      [candidate({ altitudeText: null, altitudeSource: "coordinate" }), "altitudeSource", "text-mismatch"],
      [candidate({ altitudeSource: "invented" }), "altitudeSource", "unknown-value"],
      [candidate({ malformed: "false" }), "candidate", "invalid-shape"],
      [candidate({ rawSummary: 9 }), "candidate", "invalid-shape"]
    ];
    for (const [first, field, reason] of cases) {
      expect(errorCode(withFirst(first))).toMatchObject({ code: "DOMAIN_INVARIANT_VIOLATION", details: { field, index: 0, reason } });
    }
    const unreadableCandidate = new Proxy({}, { get() { throw new Error("no read"); } });
    expect(errorCode(withFirst(unreadableCandidate))).toMatchObject({ code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "candidate", index: 0, reason: "unreadable" } });
  });

  it("rejects missing and non-decimal coordinate text with controlled details", () => {
    const withFirst = (first: RawWaypointCandidate) => document({ waypointCandidates: Object.freeze([first, candidate({ documentOrder: 1 })]) });
    expect(errorCode(withFirst(candidate({ longitudeText: null, altitudeText: null, altitudeSource: "missing", rawSummary: "" })))).toMatchObject({ code: "INVALID_COORDINATE", details: { field: "longitude", reason: "missing" } });
    expect(errorCode(withFirst(candidate({ latitudeText: null })))).toMatchObject({ code: "INVALID_COORDINATE", details: { field: "latitude", reason: "missing" } });
    expect(errorCode(withFirst(candidate({ longitudeText: "0x10" })))).toMatchObject({ code: "INVALID_COORDINATE", details: { field: "longitude", reason: "invalid-decimal" } });
    expect(errorCode(withFirst(candidate({ latitudeText: " 30" })))).toMatchObject({ code: "INVALID_COORDINATE", details: { field: "latitude", reason: "invalid-decimal" } });
    expect(errorCode(withFirst(candidate({ altitudeText: "Infinity" })))).toMatchObject({ code: "INVALID_COORDINATE", details: { field: "altitude", reason: "invalid-decimal" } });
    expect(errorCode(withFirst(candidate({ longitudeText: "1e9999" })))).toMatchObject({ code: "INVALID_COORDINATE", details: { field: "longitude", reason: "not-finite" } });
    expect(errorCode(withFirst(candidate({ rawSummary: `x ${"a".repeat(200)}`, longitudeText: "NaN" })))).toMatchObject({ code: "INVALID_COORDINATE", details: { rawSummary: `x ${"a".repeat(158)}` } });
    expect(errorCode(withFirst(candidate({ rawSummary: "/secret/path", longitudeText: "NaN" })))).toMatchObject({ code: "INVALID_COORDINATE", details: { rawSummary: "[redacted]" } });
    expect(errorCode(document({ sha256: `x${"a".repeat(64)}` }))).toMatchObject({ code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "sha256" } });
    expect(errorCode(document({ sha256: `${"a".repeat(64)}x` }))).toMatchObject({ code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "sha256" } });
    expect(RouteQualification.qualify(document({ fileName: "xC:route.kml", waypointCandidates: Object.freeze([
      candidate({ longitudeText: ".1234" }), candidate({ documentOrder: 1 })
    ]) }), limits)).toMatchObject({ ok: true });
    expect(errorCode(withFirst(candidate({ longitudeText: ".x" })))).toMatchObject({ code: "INVALID_COORDINATE", details: { field: "longitude" } });
    expect(errorCode(withFirst(candidate({ longitudeText: "NaN", rawSummary: "x/relative" })))).toMatchObject({ code: "INVALID_COORDINATE", details: { rawSummary: "x/relative" } });
    expect(errorCode(withFirst(candidate({ longitudeText: "NaN", rawSummary: "1:/not-an-absolute-path" })))).toMatchObject({ code: "INVALID_COORDINATE", details: { rawSummary: "1:/not-an-absolute-path" } });
    expect(errorCode(withFirst(candidate({ longitudeText: "NaN", rawSummary: "C:x/not-an-absolute-path" })))).toMatchObject({ code: "INVALID_COORDINATE", details: { rawSummary: "C:x/not-an-absolute-path" } });
  });

  it("rejects wholly blank candidates, unexpected KML indexes, and unsafe WPML indexes", () => {
    expect(errorCode(document({ waypointCandidates: Object.freeze([
      candidate({ longitudeText: null, latitudeText: null, altitudeText: null, altitudeSource: "missing", rawSummary: "" }),
      candidate({ documentOrder: 1, longitudeText: null, latitudeText: null, altitudeText: null, altitudeSource: "missing", rawSummary: "" })
    ]) }))).toMatchObject({ code: "INSUFFICIENT_WAYPOINTS", details: { count: 0 } });
    expect(errorCode(document({ waypointCandidates: Object.freeze([
      candidate({ declaredSequenceText: "0" }),
      candidate({ documentOrder: 1 })
    ]) }))).toMatchObject({ code: "DOMAIN_INVARIANT_VIOLATION", details: { field: "declaredSequenceText", index: 0, reason: "unexpected-kml-sequence" } });
    expect(errorCode(document({
      fileName: "route.kmz",
      format: "kmz",
      sourceDocument: "wpmz/waylines.wpml",
      sourceKind: "waylines-wpml",
      wpmlNamespace: "http://www.dji.com/wpmz/1.0.6/",
      waypointCandidates: Object.freeze([
        candidate({ declaredSequenceText: "999999999999999999999999999" }),
        candidate({ documentOrder: 1, declaredSequenceText: "1" })
      ])
    }))).toMatchObject({ code: "INVALID_COORDINATE", details: { field: "sequence", reason: "not-safe-integer" } });
  });

  it("accepts every importer-defined non-missing altitude source", () => {
    for (const altitudeSource of ["execute-height", "ellipsoid-height", "height"] as const) {
      const result = RouteQualification.qualify(document({ waypointCandidates: Object.freeze([
        candidate({ altitudeSource }),
        candidate({ documentOrder: 1, altitudeSource })
      ]) }), limits);
      expect(result.ok).toBe(true);
    }
  });

  it("does not classify a partially blank collection as wholly blank", () => {
    const cases: readonly [RawWaypointCandidate, string][] = [
      [candidate({ longitudeText: null, latitudeText: "30", altitudeText: null, altitudeSource: "missing", rawSummary: "" }), "longitude"],
      [candidate({ longitudeText: "120", latitudeText: null, altitudeText: null, altitudeSource: "missing", rawSummary: "" }), "latitude"],
      [candidate({ longitudeText: null, latitudeText: null, altitudeText: null, altitudeSource: "missing", rawSummary: "placeholder" }), "longitude"]
    ];
    for (const [first, field] of cases) {
      const result = RouteQualification.qualify(document({ waypointCandidates: Object.freeze([first, candidate({ documentOrder: 1 })]) }), limits);
      expect(result).toMatchObject({ ok: false, error: { code: "INVALID_COORDINATE", details: { field } } });
    }
  });

  it("treats a collection as wholly blank only when every candidate lacks both coordinates and a summary", () => {
    const cases: readonly [RawWaypointCandidate, string][] = [
      [candidate({ longitudeText: "120", latitudeText: null, altitudeText: null, altitudeSource: "missing", rawSummary: "" }), "latitude"],
      [candidate({ longitudeText: null, latitudeText: "30", altitudeText: null, altitudeSource: "missing", rawSummary: "" }), "longitude"],
      [candidate({ longitudeText: null, latitudeText: null, altitudeText: null, altitudeSource: "missing", rawSummary: "placeholder" }), "longitude"]
    ];
    for (const [first, field] of cases) {
      const second = candidate({ ...first, documentOrder: 1 });
      expect(errorCode(document({ waypointCandidates: Object.freeze([first, second]) }))).toMatchObject({
        code: "INVALID_COORDINATE", details: { field, index: 0 }
      });
    }
    const mixed = document({ waypointCandidates: Object.freeze([
      candidate({ longitudeText: null, latitudeText: null, altitudeText: null, altitudeSource: "missing", rawSummary: "" }),
      candidate({ documentOrder: 1 })
    ]) });
    expect(errorCode(mixed)).toMatchObject({ code: "INVALID_COORDINATE", details: { field: "longitude", index: 0 } });
  });
});
