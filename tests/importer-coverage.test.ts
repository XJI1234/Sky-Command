import { createHash } from "node:crypto";
import { sha256 } from "@noble/hashes/sha256";
import { ZipReader } from "@zip.js/zip.js";
import { SaxesParser } from "saxes";
import { describe, expect, it } from "vitest";
import {
  RouteImporter,
  type RouteImportCancellation,
  type RouteImportLimits
} from "../src/modules/route-library/importer/index.js";
import { makeKmz } from "./helpers/zip-fixture.js";

const limits: RouteImportLimits = Object.freeze({
  maxFileBytes: 4 * 1024 * 1024,
  maxArchiveEntries: 20,
  maxExpandedBytes: 4 * 1024 * 1024,
  maxWaypoints: 20
});

const encodeUtf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

function encodeUtf16(value: string, littleEndian: boolean, bom: boolean): Uint8Array {
  const output = new Uint8Array((bom ? 2 : 0) + value.length * 2);
  const view = new DataView(output.buffer);
  let offset = 0;
  if (bom) {
    output.set(littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]);
    offset = 2;
  }
  for (let index = 0; index < value.length; index += 1) {
    view.setUint16(offset + index * 2, value.charCodeAt(index), littleEndian);
  }
  return output;
}

describe("D3.2 importer defensive behavior through the public seam", () => {
  it("returns cancelled when cancellation flips during intake", async () => {
    let reads = 0;
    const cancellation: RouteImportCancellation = {
      get aborted() {
        reads += 1;
        return reads >= 2;
      }
    };

    await expect(RouteImporter.ingest("route.kml", encodeUtf8("<kml/>"), limits, cancellation))
      .resolves.toEqual({ status: "cancelled" });
  });

  it("rejects a bare extension and accepts a file exactly at its byte limit", async () => {
    await expect(RouteImporter.ingest(".kml", encodeUtf8("<kml/>"), limits)).resolves.toMatchObject({
      status: "rejected",
      error: { code: "INVALID_FILE_NAME" }
    });

    const maxFileBytes = 128;
    const prefix = "<kml><!--";
    const suffix = "--></kml>";
    const exact = encodeUtf8(`${prefix}${"x".repeat(maxFileBytes - prefix.length - suffix.length)}${suffix}`);
    const result = await RouteImporter.ingest("exact.kml", exact, {
      ...limits,
      maxFileBytes,
      maxExpandedBytes: maxFileBytes
    });
    expect(result.status).toBe("parsed");
  });

  it("distinguishes recognized truncated containers from unrelated bytes", async () => {
    const zipSignature = await RouteImporter.ingest("route.kmz", new Uint8Array([0x50, 0x4b, 0x05, 0x06]), limits);
    const unrelated = await RouteImporter.ingest("route.kmz", new Uint8Array([1, 2, 3, 4]), limits);
    const whitespace = await RouteImporter.ingest("route.kml", encodeUtf8(" \t\r\n"), limits);

    expect(zipSignature).toMatchObject({ status: "rejected", error: { code: "CORRUPT_KMZ" } });
    expect(unrelated).toMatchObject({ status: "rejected", error: { code: "FORMAT_MISMATCH" } });
    expect(whitespace).toMatchObject({ status: "rejected", error: { code: "FORMAT_MISMATCH" } });
  });

  it("hashes a multi-chunk file exactly like the trusted platform implementation", async () => {
    const bytes = encodeUtf8(`<kml><!--${"x".repeat(2 * 1024 * 1024 + 17)}--></kml>`);
    const result = await RouteImporter.ingest("large.kml", bytes, limits);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.document.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
  });

  it("lets scheduled cancellation run before hashing the next large-file chunk", async () => {
    const bytes = encodeUtf8(`<kml><!--${"x".repeat(1024 * 1024 + 17)}--></kml>`);
    const descriptor = Object.getOwnPropertyDescriptor(sha256, "create")!;
    const realCreate = descriptor.value as typeof sha256.create;
    const cancellation = { aborted: false };
    let timer: ReturnType<typeof setTimeout> | undefined;
    Object.defineProperty(sha256, "create", {
      ...descriptor,
      value: () => {
        const hash = realCreate();
        const realUpdate = hash.update.bind(hash);
        let updateCount = 0;
        hash.update = ((chunk: Uint8Array) => {
          updateCount += 1;
          if (updateCount === 1) {
            timer = setTimeout(() => { cancellation.aborted = true; }, 0);
          } else if (!cancellation.aborted) {
            throw new Error("hashing advanced before the event loop yielded");
          }
          return realUpdate(chunk);
        }) as typeof hash.update;
        return hash;
      }
    });
    try {
      const result = await RouteImporter.ingest("large.kml", bytes, limits, cancellation);
      expect(result).toEqual({ status: "cancelled" });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      Object.defineProperty(sha256, "create", descriptor);
    }
  });

  it("never sends an empty trailing chunk to the hash implementation", async () => {
    const maxFileBytes = 1024 * 1024;
    const prefix = "<kml><!--";
    const suffix = "--></kml>";
    const bytes = encodeUtf8(`${prefix}${"x".repeat(maxFileBytes - prefix.length - suffix.length)}${suffix}`);
    const descriptor = Object.getOwnPropertyDescriptor(sha256, "create")!;
    const realCreate = descriptor.value as typeof sha256.create;
    Object.defineProperty(sha256, "create", {
      ...descriptor,
      value: () => {
        const hash = realCreate();
        const realUpdate = hash.update.bind(hash);
        hash.update = ((chunk: Uint8Array) => {
          if (chunk.byteLength === 0) throw new Error("empty hash chunk");
          return realUpdate(chunk);
        }) as typeof hash.update;
        return hash;
      }
    });
    try {
      const result = await RouteImporter.ingest("exact-hash-chunk.kml", bytes, {
        ...limits,
        maxFileBytes,
        maxExpandedBytes: maxFileBytes
      });
      expect(result.status).toBe("parsed");
    } finally {
      Object.defineProperty(sha256, "create", descriptor);
    }
  });

  it("accepts supported XML declaration and UTF-16 encoding variants", async () => {
    const noEncoding = await RouteImporter.ingest("route.kml", encodeUtf8("<?xml version=\"1.0\"?><kml/>"), limits);
    const utf8Alias = await RouteImporter.ingest("route.kml", encodeUtf8("<?xml version=\"1.0\" encoding=\"utf8\"?><kml/>"), limits);
    const noBomBe = await RouteImporter.ingest("route.kml", encodeUtf16("<kml/>", false, false), limits);
    const leDeclaration = await RouteImporter.ingest(
      "route.kml",
      encodeUtf16("<?xml version=\"1.0\" encoding=\"UTF-16LE\"?><kml/>", true, true),
      limits
    );

    expect(noEncoding.status).toBe("parsed");
    expect(utf8Alias.status).toBe("parsed");
    expect(noBomBe.status).toBe("parsed");
    expect(leDeclaration.status).toBe("parsed");
  });

  it("rejects an XML declaration incompatible with the detected encoding", async () => {
    const result = await RouteImporter.ingest(
      "route.kml",
      encodeUtf8("<?xml version=\"1.0\" encoding=\"utf-16\"?><kml/>"),
      limits
    );
    expect(result).toMatchObject({ status: "rejected", error: { code: "INVALID_XML" } });
  });

  it("maps an unexpected TextDecoder failure to stable invalid XML", async () => {
    const original = globalThis.TextDecoder;
    Object.defineProperty(globalThis, "TextDecoder", {
      configurable: true,
      value: class {
        constructor() {
          throw new Error("decoder failure");
        }
      }
    });
    try {
      const result = await RouteImporter.ingest("route.kml", encodeUtf8("<kml/>"), limits);
      expect(result).toMatchObject({
        status: "rejected",
        error: { code: "INVALID_XML", details: { phase: "xml-syntax" } }
      });
    } finally {
      Object.defineProperty(globalThis, "TextDecoder", { configurable: true, value: original });
    }
  });

  it("maps an unexpected SAX write failure to stable invalid XML", async () => {
    const originalWrite = SaxesParser.prototype.write;
    SaxesParser.prototype.write = (() => {
      throw new Error("unexpected parser failure");
    }) as typeof originalWrite;
    try {
      const result = await RouteImporter.ingest("route.kml", encodeUtf8("<kml/>"), limits);
      expect(result).toMatchObject({
        status: "rejected",
        error: { code: "INVALID_XML", details: { phase: "xml-syntax" } }
      });
    } finally {
      SaxesParser.prototype.write = originalWrite;
    }
  });

  it("maps an unexpected SAX setup failure to stable invalid XML", async () => {
    const originalOn = SaxesParser.prototype.on;
    SaxesParser.prototype.on = (() => {
      throw new Error("unexpected parser setup failure");
    }) as typeof originalOn;
    try {
      const result = await RouteImporter.ingest("route.kml", encodeUtf8("<kml/>"), limits);
      expect(result).toMatchObject({
        status: "rejected",
        error: { code: "INVALID_XML", details: { phase: "xml-syntax" } }
      });
    } finally {
      SaxesParser.prototype.on = originalOn;
    }
  });

  it("maps an unexpected hash dependency failure to a domain invariant error", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(sha256, "create")!;
    Object.defineProperty(sha256, "create", {
      ...descriptor,
      value: () => { throw new Error("hash failure"); }
    });
    try {
      const result = await RouteImporter.ingest("route.kml", encodeUtf8("<kml/>"), limits);
      expect(result).toMatchObject({
        status: "rejected",
        error: { code: "DOMAIN_INVARIANT_VIOLATION", details: { phase: "ingest" } }
      });
    } finally {
      Object.defineProperty(sha256, "create", descriptor);
    }
  });

  it("parses a malformed WPML placemark without coordinates through a real KMZ", async () => {
    const wpml = "<kml xmlns:w=\"http://www.dji.com/wpmz/1.0.6\"><Placemark><w:index>7</w:index><w:ellipsoidHeight>55</w:ellipsoidHeight></Placemark></kml>";
    const result = await RouteImporter.ingest("mission.kmz", await makeKmz({ "waylines.wpml": wpml }), limits);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      declaredSequenceText: "7",
      altitudeText: "55",
      altitudeSource: "ellipsoid-height",
      malformed: true
    });
  });

  it("reports WPML overflow before an invalid trailing payload", async () => {
    const first = "<Placemark><Point><coordinates>1,1</coordinates></Point></Placemark>";
    const second = "<Placemark><Point><coordinates>2,2</coordinates></Point></Placemark>";
    const bytes = await makeKmz({ "waylines.wpml": `<kml>${first}${second}<broken` });
    const result = await RouteImporter.ingest("mission.kmz", bytes, { ...limits, maxWaypoints: 1 });

    expect(result).toMatchObject({ status: "rejected", error: { code: "TOO_MANY_WAYPOINTS" } });
  });

  it("rejects XML with no root element", async () => {
    const result = await RouteImporter.ingest("route.kml", encodeUtf8("<!-- comment -->"), limits);
    expect(result).toMatchObject({
      status: "rejected",
      error: { code: "INVALID_XML", details: { phase: "xml-syntax" } }
    });
  });

  it("ignores a third-party close failure after a fully read KMZ", async () => {
    const prototype = ZipReader.prototype as unknown as { close(): Promise<void> };
    const originalClose = prototype.close;
    prototype.close = () => Promise.reject(new Error("close failed"));
    try {
      const bytes = await makeKmz({ "waylines.wpml": "<kml><Placemark><Point><coordinates>1,2</coordinates></Point></Placemark></kml>" });
      const result = await RouteImporter.ingest("mission.kmz", bytes, limits);
      expect(result.status).toBe("parsed");
    } finally {
      prototype.close = originalClose;
    }
  });
});
