import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { RouteImporter, type RouteImportLimits } from "../src/modules/route-library/importer/index.js";
import { makeKmz } from "./helpers/zip-fixture.js";

const limits: RouteImportLimits = Object.freeze({
  maxFileBytes: 64 * 1024,
  maxArchiveEntries: 20,
  maxExpandedBytes: 128 * 1024,
  maxWaypoints: 20
});

describe("D3.2 generated input properties", () => {
  it("never throws for arbitrary byte arrays presented as KML", async () => {
    await fc.assert(fc.asyncProperty(fc.uint8Array({ maxLength: 512 }), async (bytes) => {
      const result = await RouteImporter.ingest("arbitrary.kml", bytes, limits);
      expect(result.status).toMatch(/^(parsed|rejected|cancelled)$/u);
    }), { numRuns: 100 });
  });

  it("keeps SHA-256 equal to the trusted implementation for generated valid KML", async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.tuple(fc.integer({ min: 0, max: 180 }), fc.integer({ min: -90, max: 90 })), { minLength: 2, maxLength: 10 }),
      async (points) => {
        const xml = `<kml><LineString><coordinates>${points.map(([longitude, latitude]) => `${longitude},${latitude}`).join(" ")}</coordinates></LineString></kml>`;
        const bytes = new TextEncoder().encode(xml);
        const result = await RouteImporter.ingest("generated.kml", bytes, limits);
        expect(result.status).toBe("parsed");
        if (result.status === "parsed") expect(result.document.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      }
    ), { numRuns: 50 });
  });

  it("keeps all returned byte copies isolated under arbitrary mutations", async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 2, maxLength: 30 }),
      async (values) => {
        const xml = `<kml><LineString><coordinates>1,1 2,2</coordinates></LineString></kml>`;
        const bytes = new TextEncoder().encode(xml);
        const result = await RouteImporter.ingest("copy.kml", bytes, limits);
        expect(result.status).toBe("parsed");
        if (result.status === "parsed") {
          const copy = result.document.originalBytes;
          copy.set(values.slice(0, Math.min(values.length, copy.length)));
          expect(result.document.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
          expect(result.document.originalBytes).toEqual(bytes);
        }
      }
    ), { numRuns: 50 });
  });

  it("parses generated KMZ route layouts without depending on resource paths", async () => {
    await fc.assert(fc.asyncProperty(
      fc.constantFrom("wpmz/waylines.wpml", "waylines.wpml", "missions/generated/waylines.wpml"),
      fc.integer({ min: -180, max: 180 }),
      fc.integer({ min: -90, max: 90 }),
      async (sourceDocument, longitude, latitude) => {
        const wpml = `<kml><Placemark><Point><coordinates>${longitude},${latitude}</coordinates></Point></Placemark></kml>`;
        const bytes = await makeKmz({ [sourceDocument]: wpml, "res/generated.bin": "resource" });
        const result = await RouteImporter.ingest("generated.kmz", bytes, limits);

        expect(result).toMatchObject({
          status: "parsed",
          document: { sourceDocument, sourceKind: "waylines-wpml" }
        });
      }
    ), { numRuns: 30 });
  });

  it("handles generated bounded coordinate text without leaking an exception", async () => {
    const coordinateCharacter = fc.constantFrom(
      "0", "1", "9", "+", "-", ".", ",", " ", "\t", "\r", "\n", "x", "中", "\u00a0"
    );
    await fc.assert(fc.asyncProperty(
      fc.array(coordinateCharacter, { maxLength: 200 }).map((characters) => characters.join("")),
      async (coordinates) => {
        const bytes = new TextEncoder().encode(`<kml><LineString><coordinates>${coordinates}</coordinates></LineString></kml>`);
        const result = await RouteImporter.ingest("coordinates.kml", bytes, limits);
        expect(result.status).toMatch(/^(parsed|rejected|cancelled)$/u);
        if (result.status === "parsed") expect(result.document.waypointCandidates.length).toBeLessThanOrEqual(limits.maxWaypoints);
      }
    ), { numRuns: 100 });
  }, 12_000);

  it("accepts generated safe Unicode basenames", async () => {
    const nameCharacter = fc.constantFrom("a", "Z", "0", " ", "(", ")", "中", "é", "Ä", "ß");
    await fc.assert(fc.asyncProperty(
      fc.array(nameCharacter, { minLength: 1, maxLength: 20 })
        .map((characters) => characters.join(""))
        .filter((name) => name.trim().length > 0),
      async (name) => {
        const fileName = `${name}.kml`;
        const result = await RouteImporter.ingest(fileName, new TextEncoder().encode("<kml/>"), limits);
        expect(result).toMatchObject({ status: "parsed", document: { fileName: fileName.trim() } });
      }
    ), { numRuns: 50 });
  });

  it("snapshots an offset view before the caller mutates its backing buffer", async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 1, max: 16 }),
      fc.integer({ min: 0, max: 255 }),
      async (offset, replacement) => {
        const expected = new TextEncoder().encode("<kml><LineString><coordinates>1,1 2,2</coordinates></LineString></kml>");
        const backing = new Uint8Array(offset + expected.byteLength + 7);
        backing.fill(0xaa);
        backing.set(expected, offset);
        const view = backing.subarray(offset, offset + expected.byteLength);

        const pending = RouteImporter.ingest("offset.kml", view, limits);
        backing.fill(replacement);
        const result = await pending;

        expect(result.status).toBe("parsed");
        if (result.status === "parsed") {
          expect(result.document.originalBytes).toEqual(expected);
          expect(result.document.sha256).toBe(createHash("sha256").update(expected).digest("hex"));
        }
      }
    ), { numRuns: 50 });
  });
});
