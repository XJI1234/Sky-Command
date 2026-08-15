import { describe, expect, it } from "vitest";
import {
  copyOriginalBytes,
  createQualifiedRoute,
  createRouteAsset,
  createRouteId,
  createWaypoint,
  toDetail,
  toSummary,
  type DomainResult,
  type QualifiedRoute,
  type RouteAsset,
  type RouteClassification,
  type RouteFileFormat,
  type RouteWarning,
  type RouteWaypoint
} from "../src/modules/route-library/domain/index.js";

const SHA256 = "a".repeat(64);

function unwrap<T>(result: DomainResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function waypoint(sequence: number, altitude: number | null = 80): RouteWaypoint {
  return unwrap(createWaypoint({
    longitude: 120.1665 + sequence / 10_000,
    latitude: 30.3214 + sequence / 10_000,
    altitude,
    sequence
  }));
}

function qualified(overrides: Partial<{
  displayName: unknown;
  format: unknown;
  classification: unknown;
  sourceDocument: unknown;
  waypoints: readonly RouteWaypoint[];
  warnings: readonly RouteWarning[];
  sha256: unknown;
  sizeBytes: unknown;
  originalBytes: Uint8Array;
}> = {}): DomainResult<QualifiedRoute> {
  const bytes = overrides.originalBytes ?? new Uint8Array([1, 2, 3]);
  return createQualifiedRoute({
    displayName: "杭州巡检.kmz",
    format: "kmz",
    classification: "upload-candidate",
    sourceDocument: "wpmz/waylines.wpml",
    waypoints: [waypoint(0), waypoint(1)],
    warnings: [],
    sha256: SHA256,
    sizeBytes: bytes.length,
    originalBytes: bytes,
    ...overrides
  });
}

function asset(route = unwrap(qualified())): RouteAsset {
  return unwrap(createRouteAsset({
    qualifiedRoute: route,
    routeId: unwrap(createRouteId("route-001")),
    importedAt: "2026-08-09T01:02:03.004Z"
  }));
}

describe("RouteId", () => {
  it.each(["a", "A0.route_id-9", "x".repeat(128)])("accepts %s", (raw) => {
    const result = createRouteId(raw);
    expect(result).toEqual({ ok: true, value: raw });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    undefined, null, "", " ", " route", "route ", ".route", "_route", "-route",
    "航线", "a/b", "a\\b", "a\n", "x".repeat(129)
  ])("rejects invalid id %j without throwing", (raw) => {
    const result = createRouteId(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DOMAIN_INVARIANT_VIOLATION");
      expect(result.error.details).toMatchObject({ field: "routeId" });
    }
  });
});

describe("RouteWaypoint", () => {
  it("returns an error for a missing or unreadable input container", () => {
    const unreadable = new Proxy({}, {
      get: () => { throw new Error("blocked"); }
    });

    for (const input of [null, undefined, unreadable]) {
      expect(() => createWaypoint(input as never)).not.toThrow();
      const result = createWaypoint(input as never);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_COORDINATE");
        expect(result.error.details).toMatchObject({ field: "input" });
      }
    }
  });

  it.each([
    [-180, -90, null, 0],
    [0, 0, 0, 1],
    [180, 90, -12.5, Number.MAX_SAFE_INTEGER]
  ])("accepts valid boundary values", (longitude, latitude, altitude, sequence) => {
    const value = unwrap(createWaypoint({ longitude, latitude, altitude, sequence }));
    expect(value).toEqual({ longitude, latitude, altitude, sequence });
    expect(Object.isFrozen(value)).toBe(true);
  });

  it("normalizes every negative zero", () => {
    const value = unwrap(createWaypoint({ longitude: -0, latitude: -0, altitude: -0, sequence: -0 }));
    expect(Object.is(value.longitude, -0)).toBe(false);
    expect(Object.is(value.latitude, -0)).toBe(false);
    expect(Object.is(value.altitude, -0)).toBe(false);
    expect(Object.is(value.sequence, -0)).toBe(false);
  });

  it.each([
    ["longitude", 180.0000001], ["longitude", -180.0000001], ["longitude", NaN],
    ["latitude", 90.0000001], ["latitude", -90.0000001], ["latitude", Infinity],
    ["altitude", undefined], ["altitude", ""], ["altitude", -Infinity],
    ["sequence", -1], ["sequence", 1.5], ["sequence", Number.MAX_SAFE_INTEGER + 1]
  ])("rejects invalid %s", (field, invalid) => {
    const input: Record<string, unknown> = { longitude: 1, latitude: 1, altitude: 1, sequence: 0 };
    input[field] = invalid;
    const result = createWaypoint(input as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_COORDINATE");
      expect(result.error.details).toMatchObject({ field });
      if (field !== "sequence") expect(result.error.details).toHaveProperty("sequence", 0);
    }
  });

  it("omits an unusable sequence from a preceding coordinate error", () => {
    const result = createWaypoint({ longitude: "bad", latitude: 1, altitude: 1, sequence: "bad" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.details).not.toHaveProperty("sequence");
  });

  it("does not retain the input object", () => {
    const input = { longitude: 1, latitude: 2, altitude: 3, sequence: 0 };
    const value = unwrap(createWaypoint(input));
    input.longitude = 99;
    expect(value.longitude).toBe(1);
  });
});

describe("QualifiedRoute", () => {
  it("returns a domain error for a missing or unreadable input container", () => {
    const unreadable = new Proxy({}, {
      get: () => { throw new Error("blocked"); }
    });

    for (const input of [null, undefined, unreadable]) {
      expect(() => createQualifiedRoute(input as never)).not.toThrow();
      const result = createQualifiedRoute(input as never);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("DOMAIN_INVARIANT_VIOLATION");
        expect(result.error.details).toMatchObject({ field: "input" });
      }
    }
  });

  it("creates a KMZ upload candidate", () => {
    const value = unwrap(qualified());
    expect(value).toBeDefined();
    expect(Object.isFrozen(value)).toBe(true);
    expect(value).not.toHaveProperty("read");
  });

  it("creates KML preview routes and normalizes warning order", () => {
    const warnings = [
      { code: "ALTITUDE_MISSING", message: "部分航点缺少高度" },
      { code: "WPML_MISSING", message: "missing" }
    ] satisfies RouteWarning[];
    const result = qualified({
      displayName: "航线 01.KML",
      format: "kml",
      classification: "preview-only",
      sourceDocument: "航线 01.KML",
      waypoints: [waypoint(0, null), waypoint(1)],
      warnings: warnings.slice(0, 1)
    });
    const detail = toDetail(asset(unwrap(result)));
    expect(detail.format).toBe("kml");
    expect(detail.classification).toBe("preview-only");
    expect(detail.warnings.map((warning) => warning.code)).toEqual(["ALTITUDE_MISSING"]);
    expect(detail.warnings[0]).not.toHaveProperty("details");
  });

  it("creates a KMZ preview route only when WPML_MISSING is present", () => {
    const value = unwrap(qualified({
      classification: "preview-only",
      sourceDocument: "doc.kml",
      warnings: [{ code: "WPML_MISSING", message: "缺少 WPML" }]
    }));
    expect(toDetail(asset(value)).warnings[0]?.code).toBe("WPML_MISSING");
  });

  it("normalizes both warning codes into their fixed order", () => {
    const route = unwrap(qualified({
      classification: "preview-only",
      sourceDocument: "doc.kml",
      waypoints: [waypoint(0, null), waypoint(1)],
      warnings: [
        { code: "ALTITUDE_MISSING", message: "缺少高度" },
        { code: "WPML_MISSING", message: "缺少 WPML" }
      ]
    }));
    expect(toDetail(asset(route)).warnings.map((warning) => warning.code)).toEqual([
      "WPML_MISSING",
      "ALTITUDE_MISSING"
    ]);
  });

  it("accepts display names that contain a non-leading colon", () => {
    expect(qualified({ displayName: "flight C: route.kmz" }).ok).toBe(true);
  });

  it.each([
    [{ displayName: "" }, "INVALID_FILE_NAME"],
    [{ displayName: " route.kmz" }, "INVALID_FILE_NAME"],
    [{ displayName: "C:route.kmz" }, "INVALID_FILE_NAME"],
    [{ displayName: "dir/route.kmz" }, "INVALID_FILE_NAME"],
    [{ displayName: "route.kmz.tmp" }, "INVALID_FILE_NAME"],
    [{ displayName: "route.kml", format: "kmz" }, "DOMAIN_INVARIANT_VIOLATION"],
    [{ format: "zip" }, "DOMAIN_INVARIANT_VIOLATION"],
    [{ classification: "ready" }, "DOMAIN_INVARIANT_VIOLATION"],
    [{ sourceDocument: null }, "DOMAIN_INVARIANT_VIOLATION"],
    [{ sourceDocument: "" }, "DOMAIN_INVARIANT_VIOLATION"],
    [{ sourceDocument: " doc.kml" }, "DOMAIN_INVARIANT_VIOLATION"],
    [{ sourceDocument: " wpmz/waylines.wpml" }, "DOMAIN_INVARIANT_VIOLATION"],
    [{ sourceDocument: "wpmz\\doc.kml" }, "DOMAIN_INVARIANT_VIOLATION"],
    [{ sourceDocument: "wpmz\\waylines.wpml" }, "DOMAIN_INVARIANT_VIOLATION"],
    [{ sourceDocument: "wpmz/\u0001doc.kml" }, "DOMAIN_INVARIANT_VIOLATION"],
    [{ sourceDocument: "wpmz/\u0001waylines.wpml" }, "DOMAIN_INVARIANT_VIOLATION"],
    [{ sourceDocument: "wpmz//doc.kml" }, "DOMAIN_INVARIANT_VIOLATION"],
    [{ sourceDocument: "wpmz//waylines.wpml" }, "DOMAIN_INVARIANT_VIOLATION"],
    [{ sourceDocument: "wpmz/./doc.kml" }, "DOMAIN_INVARIANT_VIOLATION"],
    [{ sourceDocument: "wpmz/./waylines.wpml" }, "DOMAIN_INVARIANT_VIOLATION"],
    [{ sourceDocument: "../waylines.wpml" }, "DOMAIN_INVARIANT_VIOLATION"],
    [{ sourceDocument: "C:/waylines.wpml" }, "DOMAIN_INVARIANT_VIOLATION"],
    [{ sha256: "A".repeat(64) }, "DOMAIN_INVARIANT_VIOLATION"],
    [{ sha256: "a".repeat(63) }, "DOMAIN_INVARIANT_VIOLATION"],
    [{ sha256: `x${"a".repeat(64)}` }, "DOMAIN_INVARIANT_VIOLATION"],
    [{ sha256: `${"a".repeat(64)}x` }, "DOMAIN_INVARIANT_VIOLATION"],
    [{ originalBytes: "bytes" as never, sizeBytes: 5 }, "DOMAIN_INVARIANT_VIOLATION"],
    [{ originalBytes: new Uint8Array(), sizeBytes: 0 }, "DOMAIN_INVARIANT_VIOLATION"],
    [{ sizeBytes: 4 }, "DOMAIN_INVARIANT_VIOLATION"]
  ])("rejects invalid metadata %#", (overrides, code) => {
    const result = qualified(overrides);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
  });

  it.each([
    ["kml", "upload-candidate", "route.kml", "route.kml", []],
    ["kmz", "upload-candidate", "route.kmz", "doc.kml", []],
    ["kmz", "upload-candidate", "route.kmz", "waylines.wpml", [{ code: "WPML_MISSING", message: "x" }]],
    ["kmz", "preview-only", "route.kmz", "doc.kml", []]
  ] as [RouteFileFormat, RouteClassification, string, string, RouteWarning[]][]) (
    "rejects inconsistent classification %s/%s",
    (format, classification, displayName, sourceDocument, warnings) => {
      const result = qualified({ format, classification, displayName, sourceDocument, warnings });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("DOMAIN_INVARIANT_VIOLATION");
    }
  );

  it("rejects missing, duplicate, unknown, and spurious altitude warnings", () => {
    const missing = qualified({ waypoints: [waypoint(0, null), waypoint(1)] });
    const duplicate = qualified({
      classification: "preview-only",
      sourceDocument: "doc.kml",
      warnings: [
        { code: "WPML_MISSING", message: "a" },
        { code: "WPML_MISSING", message: "b" }
      ]
    });
    const unknown = qualified({ warnings: [{ code: "MAP_FAILED", message: "x" } as never] });
    const spurious = qualified({ warnings: [{ code: "ALTITUDE_MISSING", message: "x" }] });
    for (const result of [missing, duplicate, unknown, spurious]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("DOMAIN_INVARIANT_VIOLATION");
    }
  });

  it("rejects preview routes that still point at WPML, including uppercase extensions", () => {
    for (const sourceDocument of ["waylines.wpml", "waylines.WPML"]) {
      const result = qualified({
        classification: "preview-only",
        sourceDocument,
        warnings: [{ code: "WPML_MISSING", message: "缺少 WPML" }]
      });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects malformed warning containers, values, messages, and details", () => {
    const throwingProxy = new Proxy({}, { getPrototypeOf: () => { throw new Error("blocked"); } });
    const cases = [
      qualified({ warnings: null as never }),
      qualified({ warnings: [null as never] }),
      qualified({ warnings: [undefined as never] }),
      qualified({ warnings: ["warning" as never] }),
      qualified({
        waypoints: [waypoint(0, null), waypoint(1)],
        warnings: [{ code: "ALTITUDE_MISSING", message: 1 } as never]
      }),
      qualified({
        waypoints: [waypoint(0, null), waypoint(1)],
        warnings: [{ code: "ALTITUDE_MISSING", message: " " }]
      }),
      qualified({
        waypoints: [waypoint(0, null), waypoint(1)],
        warnings: [{ code: "ALTITUDE_MISSING", message: "x", details: { token: "secret" } }]
      }),
      qualified({
        waypoints: [waypoint(0, null), waypoint(1)],
        warnings: [{ code: "ALTITUDE_MISSING", message: "x", details: { mapKey: "secret" } }]
      }),
      qualified({
        waypoints: [waypoint(0, null), waypoint(1)],
        warnings: [{ code: "ALTITUDE_MISSING", message: "x", details: throwingProxy as never }]
      })
    ];
    for (const result of cases) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("DOMAIN_INVARIANT_VIOLATION");
    }
  });

  it("rejects fewer than two, non-contiguous, and forged waypoints", () => {
    const cases = [
      qualified({ waypoints: [] }),
      qualified({ waypoints: [waypoint(0)] }),
      qualified({ waypoints: null as never }),
      qualified({ waypoints: [waypoint(0), waypoint(2)] }),
      qualified({ waypoints: [{ longitude: 1, latitude: 1, altitude: 1, sequence: 0 } as RouteWaypoint, waypoint(1)] })
    ];
    expect(cases.map((result) => result.ok)).toEqual([false, false, false, false, false]);
    if (!cases[0]?.ok) expect(cases[0]?.error.code).toBe("INSUFFICIENT_WAYPOINTS");
  });

  it("defensively copies arrays, warnings, and bytes", () => {
    const points = [waypoint(0, null), waypoint(1)];
    const warnings: Array<{
      code: "ALTITUDE_MISSING";
      message: string;
      details: { count: number };
    }> = [{ code: "ALTITUDE_MISSING", message: "缺少高度", details: { count: 1 } }];
    const bytes = new Uint8Array([4, 5, 6]);
    const route = unwrap(qualified({ waypoints: points, warnings, originalBytes: bytes }));
    const stored = asset(route);
    points.reverse();
    warnings[0]!.message = "changed";
    warnings[0]!.details.count = 9;
    bytes[0] = 99;
    const detail = toDetail(stored);
    expect(detail.waypoints.map((point) => point.sequence)).toEqual([0, 1]);
    expect(detail.warnings[0]).toMatchObject({ message: "缺少高度", details: { count: 1 } });
    expect(copyOriginalBytes(stored)).toEqual(new Uint8Array([4, 5, 6]));
  });
});

describe("RouteAsset reads", () => {
  it("returns a domain error for a missing or unreadable input container", () => {
    const unreadable = new Proxy({}, {
      get: () => { throw new Error("blocked"); }
    });

    for (const input of [null, undefined, unreadable]) {
      expect(() => createRouteAsset(input as never)).not.toThrow();
      const result = createRouteAsset(input as never);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("DOMAIN_INVARIANT_VIOLATION");
        expect(result.error.details).toMatchObject({ field: "input" });
      }
    }
  });

  it.each(["2026-08-09T01:02:03Z", "2026-08-09T09:02:03.004+08:00", "not-a-date", new Date()])(
    "rejects non-canonical importedAt %j",
    (importedAt) => {
      const result = createRouteAsset({
        qualifiedRoute: unwrap(qualified()),
        routeId: unwrap(createRouteId("route-1")),
        importedAt
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.details).toMatchObject({ field: "importedAt" });
    }
  );

  it.each([
    "x2026-08-09T01:02:03.004Z",
    "2026-08-09T01:02:03.004Zx"
  ])("rejects importedAt text around an otherwise canonical timestamp", (importedAt) => {
    const result = createRouteAsset({
      qualifiedRoute: unwrap(qualified()),
      routeId: unwrap(createRouteId("route-1")),
      importedAt
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a canonical-looking but impossible UTC date", () => {
    const result = createRouteAsset({
      qualifiedRoute: unwrap(qualified()),
      routeId: unwrap(createRouteId("route-1")),
      importedAt: "2026-99-99T99:99:99.999Z"
    });
    expect(result.ok).toBe(false);
  });

  it("revalidates RouteId while creating an asset", () => {
    const result = createRouteAsset({
      qualifiedRoute: unwrap(qualified()),
      routeId: "bad/id" as never,
      importedAt: "2026-08-09T01:02:03.004Z"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.details).toMatchObject({ field: "routeId" });
  });

  it("rejects forged route inputs", () => {
    const result = createRouteAsset({
      qualifiedRoute: {} as QualifiedRoute,
      routeId: "bad/id" as never,
      importedAt: "2026-08-09T01:02:03.004Z"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.details).toMatchObject({ field: "qualifiedRoute", reason: "untrusted-route" });
    }
  });

  it("returns isolated immutable summaries, details, and bytes", () => {
    const stored = asset();
    expect(stored).not.toHaveProperty("read");
    const summary = toSummary(stored);
    const firstDetail = toDetail(stored);
    const secondDetail = toDetail(stored);
    const firstBytes = copyOriginalBytes(stored);
    const secondBytes = copyOriginalBytes(stored);

    expect(summary).toEqual({
      routeId: "route-001",
      displayName: "杭州巡检.kmz",
      format: "kmz",
      classification: "upload-candidate",
      waypointCount: 2,
      sha256: SHA256,
      sizeBytes: 3,
      importedAt: "2026-08-09T01:02:03.004Z"
    });
    expect(summary).not.toHaveProperty("waypoints");
    expect(summary).not.toHaveProperty("warnings");
    expect(summary).not.toHaveProperty("bytes");
    expect(firstDetail).not.toHaveProperty("bytes");
    expect(firstDetail.warnings).toEqual([]);
    expect(firstDetail.waypoints).not.toBe(secondDetail.waypoints);
    expect(firstBytes).not.toBe(secondBytes);
    firstBytes[0] = 99;
    expect(secondBytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(copyOriginalBytes(stored)).toEqual(new Uint8Array([1, 2, 3]));
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.isFrozen(firstDetail)).toBe(true);
    expect(Object.isFrozen(firstDetail.waypoints)).toBe(true);
  });

  it("returns detail waypoints that remain valid domain waypoints", () => {
    const detail = toDetail(asset());
    const rebuilt = qualified({
      waypoints: detail.waypoints,
      warnings: detail.warnings
    });

    expect(rebuilt.ok).toBe(true);
  });
});
