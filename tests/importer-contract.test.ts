import { describe, expect, it } from "vitest";
import { RouteImporter, type RouteImportLimits } from "../src/modules/route-library/importer/index.js";

const limits: RouteImportLimits = Object.freeze({
  maxFileBytes: 64,
  maxArchiveEntries: 10,
  maxExpandedBytes: 128,
  maxWaypoints: 10
});

describe("D3.2 route importer public contract", () => {
  it("returns cancelled before reading other untrusted inputs", async () => {
    const unreadable = new Proxy({}, { get: () => { throw new Error("must not read"); } });

    const result = await RouteImporter.ingest(unreadable, unreadable, limits, { aborted: true });

    expect(result).toEqual({ status: "cancelled" });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("checks cancellation again after snapshotting and before container detection", async () => {
    let reads = 0;
    let copied = false;
    const bytes = new Proxy(new TextEncoder().encode("not xml"), {
      get(target, property) {
        if (property === "0") copied = true;
        return Reflect.get(target, property, target);
      }
    });
    const cancellation = {
      get aborted() {
        reads += 1;
        return reads >= 2 && copied;
      }
    };

    const result = await RouteImporter.ingest(
      "route.kml",
      bytes,
      limits,
      cancellation
    );

    expect(result).toEqual({ status: "cancelled" });
    expect(copied).toBe(true);
    expect(reads).toBe(2);
  });

  it("rejects a cancellation object whose aborted value is not boolean", async () => {
    const result = await RouteImporter.ingest("route.kml", new TextEncoder().encode("<kml/>"), limits, {
      aborted: 1 as unknown as boolean
    });

    expect(result).toMatchObject({
      status: "rejected",
      error: {
        code: "DOMAIN_INVARIANT_VIOLATION",
        details: { phase: "cancellation", reason: "non-boolean" }
      }
    });
  });

  it.each([
    [{ ...limits, maxFileBytes: 0 }],
    [{ ...limits, maxArchiveEntries: 1.5 }],
    [{ ...limits, maxExpandedBytes: 63 }],
    [{ ...limits, maxWaypoints: Number.NaN }]
  ])("rejects invalid internal limits", async (invalidLimits) => {
    const result = await RouteImporter.ingest("route.kml", new Uint8Array([60]), invalidLimits);

    expect(result).toMatchObject({
      status: "rejected",
      error: {
        code: "DOMAIN_INVARIANT_VIOLATION",
        recoverable: false,
        details: { phase: "limits", reason: "invalid" }
      }
    });
  });

  it.each([
    [null, "INVALID_FILE_NAME"],
    ["   ", "INVALID_FILE_NAME"],
    [".", "INVALID_FILE_NAME"],
    ["..", "INVALID_FILE_NAME"],
    ["../route.kml", "INVALID_FILE_NAME"],
    ["C:\\route.kml", "INVALID_FILE_NAME"],
    ["C:route.kml", "INVALID_FILE_NAME"],
    ["route.txt", "UNSUPPORTED_FORMAT"]
  ])("rejects an invalid file name without coercion", async (fileName, code) => {
    const result = await RouteImporter.ingest(fileName, new Uint8Array([60]), limits);

    expect(result).toMatchObject({ status: "rejected", error: { code } });
  });

  it("rejects truncated container signatures before parsing them", async () => {
    const zipLike = await RouteImporter.ingest("route.kmz", new Uint8Array([0x50]), limits);
    const xmlLike = await RouteImporter.ingest("route.kml", new Uint8Array([0xff]), limits);

    expect(zipLike).toMatchObject({ status: "rejected", error: { code: "FORMAT_MISMATCH" } });
    expect(xmlLike).toMatchObject({ status: "rejected", error: { code: "FORMAT_MISMATCH" } });
  });

  it("accepts a legal basename containing a non-drive colon", async () => {
    const result = await RouteImporter.ingest("xC:route.kml", new TextEncoder().encode("<kml/>"), limits);
    expect(result).toMatchObject({ status: "parsed", document: { fileName: "xC:route.kml" } });
  });

  it("converts an unreadable limits object into a domain invariant error", async () => {
    const unreadable = new Proxy(limits, { get: () => { throw new Error("must not escape"); } });
    const result = await RouteImporter.ingest("route.kml", new Uint8Array([60]), unreadable);
    expect(result).toMatchObject({
      status: "rejected",
      error: {
        code: "DOMAIN_INVARIANT_VIOLATION",
        details: { phase: "limits", reason: "unreadable" }
      }
    });
  });

  it("converts an unreadable byte view into an empty-file error", async () => {
    const bytes = new Proxy(new Uint8Array([60]), { get(target, property, receiver) {
      if (property === "byteLength") throw new Error("must not escape");
      return Reflect.get(target, property, receiver);
    } });
    const result = await RouteImporter.ingest("route.kml", bytes, limits);
    expect(result).toMatchObject({ status: "rejected", error: { code: "EMPTY_FILE" } });
  });

  it.each([
    [null, "EMPTY_FILE"],
    [new Uint8Array(), "EMPTY_FILE"],
    [new Uint8Array(65), "FILE_TOO_LARGE"]
  ])("rejects missing, empty, and oversized byte input", async (bytes, code) => {
    const result = await RouteImporter.ingest("route.kml", bytes, limits);

    expect(result).toMatchObject({ status: "rejected", error: { code } });
  });

  it("reports the measured and configured byte counts for an oversized file", async () => {
    const result = await RouteImporter.ingest("route.kml", new Uint8Array(65), limits);

    expect(result).toMatchObject({
      status: "rejected",
      error: {
        code: "FILE_TOO_LARGE",
        details: { sizeBytes: 65, maxFileBytes: 64 }
      }
    });
  });

  it.each([
    ["route.kml", new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
    ["route.kmz", new TextEncoder().encode("<kml/>")],
    ["route.kml", new TextEncoder().encode("not xml")],
    ["route.kmz", new TextEncoder().encode("not zip")]
  ])("rejects content that conflicts with the declared container", async (fileName, bytes) => {
    const result = await RouteImporter.ingest(fileName, bytes, limits);

    expect(result).toMatchObject({ status: "rejected", error: { code: "FORMAT_MISMATCH" } });
  });

  it("detects XML after legal leading whitespace", async () => {
    const result = await RouteImporter.ingest("route.kml", new TextEncoder().encode(" \t\n<kml/>"), limits);
    expect(result.status).toBe("parsed");
  });

  it("detects XML after a carriage-return prefix", async () => {
    const result = await RouteImporter.ingest("route.kml", new TextEncoder().encode("\r<kml/>"), limits);
    expect(result.status).toBe("parsed");
  });

  it("does not classify an odd trailing UTF-16 byte as an XML opening bracket", async () => {
    const result = await RouteImporter.ingest("route.kml", new Uint8Array([0x20, 0x00, 0x3c]), limits);

    expect(result).toMatchObject({ status: "rejected", error: { code: "FORMAT_MISMATCH" } });
  });
});
