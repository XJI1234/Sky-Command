import { describe, expect, it } from "vitest";
import { createError, type RouteErrorCode } from "../src/modules/route-library/domain/index.js";

const RECOVERABLE: readonly RouteErrorCode[] = [
  "INVALID_FILE_NAME", "UNSUPPORTED_FORMAT", "EMPTY_FILE", "FILE_TOO_LARGE", "FORMAT_MISMATCH",
  "INVALID_XML", "EXTERNAL_ENTITY_FORBIDDEN", "CORRUPT_KMZ", "ENCRYPTED_KMZ",
  "ARCHIVE_ENTRY_LIMIT", "ARCHIVE_EXPANSION_LIMIT", "UNSAFE_ARCHIVE_PATH",
  "ROUTE_DOCUMENT_MISSING", "INSUFFICIENT_WAYPOINTS", "INVALID_COORDINATE",
  "TOO_MANY_WAYPOINTS", "ROUTE_NOT_FOUND", "ROUTE_NOT_UPLOADABLE",
  "MAP_INITIALIZATION_FAILED", "BASEMAP_LOAD_FAILED", "CITY_MODEL_LOAD_FAILED"
];
const FATAL: readonly RouteErrorCode[] = ["INVALID_CONFIGURATION", "DOMAIN_INVARIANT_VIOLATION"];

describe("RouteLibraryError", () => {
  it.each(RECOVERABLE)("maps %s to a stable recoverable error", (code) => {
    const first = createError(code);
    const second = createError(code);
    expect(first).toEqual(second);
    expect(first.recoverable).toBe(true);
    expect(first.message.length).toBeGreaterThan(0);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it.each(FATAL)("maps %s to a stable fatal error", (code) => {
    expect(createError(code).recoverable).toBe(false);
  });

  it("deep-copies and freezes JSON-safe details", () => {
    const details = { field: "routeId", nested: { values: [1, true, null] } };
    const error = createError("DOMAIN_INVARIANT_VIOLATION", details);
    details.nested.values[0] = 9;
    expect(error.details).toEqual({ field: "routeId", nested: { values: [1, true, null] } });
    expect(Object.isFrozen(error.details)).toBe(true);
    expect(Object.isFrozen((error.details as { nested: object }).nested)).toBe(true);
  });

  it("sanitizes unsafe details without throwing or leaking them", () => {
    const cyclic: Record<string, unknown> = { safe: "ok" };
    cyclic.self = cyclic;
    const throwing = Object.create(null, {
      broken: { enumerable: true, get: () => { throw new Error("secret"); } }
    });
    const values = [
      { bytes: new Uint8Array([1, 2]), token: "super-secret", path: "C:\\Users\\name\\route.kmz", xml: "<kml>complete</kml>" },
      { mapKey: "map-secret", apiKey: "api-secret", accessToken: "access-secret" },
      { error: new Error("boom"), date: new Date(), map: new Map(), fn: () => null, symbol: Symbol("x") },
      { content: "<kml>complete</kml>", number: NaN, array: [1, Symbol("x")] },
      cyclic,
      throwing
    ];
    for (const details of values) {
      expect(() => createError("INVALID_FILE_NAME", details)).not.toThrow();
      const serialized = JSON.stringify(createError("INVALID_FILE_NAME", details).details);
      expect(serialized).not.toContain("super-secret");
      expect(serialized).not.toContain("C:\\\\Users");
      expect(serialized).not.toContain("<kml>");
      expect(serialized).not.toContain("map-secret");
      expect(serialized).not.toContain("api-secret");
      expect(serialized).not.toContain("access-secret");
    }
  });

  it("does not redact ordinary words that merely end with key-like letters", () => {
    const error = createError("INVALID_FILE_NAME", {
      monkey: "banana",
      hockey: "sport",
      keynote: "speech",
      notmapkey: "ordinary-prefix",
      mapkeynote: "ordinary-suffix"
    });
    expect(error.details).toEqual({
      monkey: "banana",
      hockey: "sport",
      keynote: "speech",
      notmapkey: "ordinary-prefix",
      mapkeynote: "ordinary-suffix"
    });
  });

  it.each([
    "key",
    "token",
    "secret",
    "password",
    "byte",
    "bytes",
    "xml",
    "path",
    "route_token_value",
    "route-token-value",
    "routeTokenValue",
    "routeBytesCopy",
    "__token__",
    "mapKey",
    "apiKey",
    "mapkey",
    "apikey",
    "accessToken",
    "mapbyte"
  ])("redacts the sensitive key spelling %s", (key) => {
    const marker = `secret-for-${key}`;
    const error = createError("INVALID_FILE_NAME", { [key]: marker });
    expect(JSON.stringify(error.details)).not.toContain(marker);
  });

  it("sanitizes invalid root details and proxies that reject inspection", () => {
    const proxy = new Proxy({}, { getPrototypeOf: () => { throw new Error("blocked"); } });
    expect(createError("INVALID_FILE_NAME", Symbol("x")).details).toEqual({ sanitized: true });
    expect(createError("INVALID_FILE_NAME", proxy).details).toEqual({ sanitized: true });
  });
});
