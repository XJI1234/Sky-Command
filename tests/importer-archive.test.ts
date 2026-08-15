import { readFile } from "node:fs/promises";
import { ZipReader } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";
import { RouteImporter, type RouteImportLimits } from "../src/modules/route-library/importer/index.js";
import { appendArchiveData, concatenateArchives, corruptDeclaredSize, corruptPayloadByte, makeKmz, makeModeAwareKmz, makeOverlappingKmz, makeSpecialEntryKmz, makeStoredKmz, makeSymlinkKmz, setGeneralPurposeFlags, setLocalGeneralPurposeFlags, truncateArchive } from "./helpers/zip-fixture.js";

const limits: RouteImportLimits = Object.freeze({
  maxFileBytes: 1024 * 1024,
  maxArchiveEntries: 20,
  maxExpandedBytes: 2 * 1024 * 1024,
  maxWaypoints: 20
});

const wpml = `<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wp="http://www.dji.com/wpmz/1.0.6"><Document><Folder>
  <Placemark><Point><coordinates>120.1,30.1</coordinates></Point><wp:index>0</wp:index><wp:executeHeight>40</wp:executeHeight></Placemark>
  <Placemark><Point><coordinates>120.2,30.2</coordinates></Point><wp:index>1</wp:index><wp:executeHeight>40</wp:executeHeight></Placemark>
</Folder></Document></kml>`;

const template = "<kml><Document><Placemark><LineString><coordinates>120,30 121,31</coordinates></LineString></Placemark></Document></kml>";

async function ingest(entries: Readonly<Record<string, string>>, overrides: Partial<RouteImportLimits> = {}) {
  const bytes = await makeKmz(entries);
  return RouteImporter.ingest("mission.kmz", bytes, { ...limits, ...overrides });
}

describe("D3.2 KMZ archive safety and selection", () => {
  it("parses the real Wayline Hangzhou KMZ fixture", async () => {
    const bytes = new Uint8Array(await readFile(new URL("./fixtures/wayline-hangzhou-orbit.kmz", import.meta.url)));
    const result = await RouteImporter.ingest("wayline-hangzhou-orbit.kmz", bytes, limits);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.document.sourceDocument).toBe("waylines.wpml");
      expect(result.document.sourceKind).toBe("waylines-wpml");
      expect(result.document.waypointCandidates).toHaveLength(4);
      expect(result.document.waypointCandidates[0]).toMatchObject({ longitudeText: "120.16720400471", latitudeText: "30.3221040027" });
    }
  });

  it("parses the fixed DJI canonical wpmz fixture", async () => {
    const bytes = new Uint8Array(await readFile(new URL("./fixtures/dji-canonical-hangzhou-orbit.kmz", import.meta.url)));
    const result = await RouteImporter.ingest("dji-canonical-hangzhou-orbit.kmz", bytes, limits);

    expect(result).toMatchObject({
      status: "parsed",
      document: {
        sourceDocument: "wpmz/waylines.wpml",
        sourceKind: "waylines-wpml"
      }
    });
    if (result.status === "parsed") expect(result.document.waypointCandidates).toHaveLength(4);
  });

  it("selects canonical wpmz/waylines.wpml and exposes the namespace", async () => {
    const result = await ingest({
      "wpmz/template.kml": template,
      "wpmz/waylines.wpml": wpml,
      "wpmz/res/icon.png": "not important"
    });

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.document).toMatchObject({
        format: "kmz",
        sourceDocument: "wpmz/waylines.wpml",
        sourceKind: "waylines-wpml",
        wpmlNamespace: "http://www.dji.com/wpmz/1.0.6"
      });
      expect(result.document.waypointCandidates).toHaveLength(2);
      expect(result.document.waypointCandidates[0]).toMatchObject({
        declaredSequenceText: "0",
        altitudeText: "40",
        altitudeSource: "execute-height"
      });
    }
  });

  it("supports Wayline root layout and canonical entries outrank root entries", async () => {
    const result = await ingest({
      template: "<kml><Document/></kml>",
      "waylines.wpml": wpml,
      "wpmz/template.kml": template,
      "wpmz/waylines.wpml": wpml.replace("120.1", "130.1")
    });

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.document.sourceDocument).toBe("wpmz/waylines.wpml");
      expect(result.document.waypointCandidates[0]?.longitudeText).toBe("130.1");
    }
  });

  it("selects a single nested waylines.wpml when canonical locations are absent", async () => {
    const result = await ingest({ "missions/day-one/waylines.wpml": wpml });
    expect(result).toMatchObject({
      status: "parsed",
      document: {
        sourceDocument: "missions/day-one/waylines.wpml",
        sourceKind: "waylines-wpml"
      }
    });
  });

  it.each([
    [{ "template.kml": template }, "preview-only"],
    [{ "nested/template.kml": template }, "preview-only"],
    [{ "nested/other.kml": template }, "preview-only"]
  ])("falls back to a KML document only when WPML is absent", async (entries, _label) => {
    const result = await ingest(entries);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.sourceKind).toBe("kml");
  });

  it("applies template priority before a generic KML fallback", async () => {
    const rootTemplate = await ingest({ "template.kml": template, "other.kml": template.replace("120,30", "130,40") });
    expect(rootTemplate).toMatchObject({ status: "parsed", document: { sourceDocument: "template.kml" } });

    const canonicalTemplate = await ingest({
      "wpmz/template.kml": template,
      "template.kml": template.replace("120,30", "130,40"),
      "other.kml": template.replace("120,30", "140,50")
    });
    expect(canonicalTemplate).toMatchObject({ status: "parsed", document: { sourceDocument: "wpmz/template.kml" } });

    const nestedTemplate = await ingest({
      "nested/template.kml": template,
      "nested/other.kml": template.replace("120,30", "150,60")
    });
    expect(nestedTemplate).toMatchObject({ status: "parsed", document: { sourceDocument: "nested/template.kml" } });
  });

  it("rejects same-tier document ambiguity", async () => {
    const result = await ingest({ "a/waylines.wpml": wpml, "b/waylines.wpml": wpml });

    expect(result).toMatchObject({
      status: "rejected",
      error: { code: "CORRUPT_KMZ", details: { phase: "archive-document-selection" } }
    });
  });

  it("reports a missing route document for an empty or unrelated archive", async () => {
    const empty = await ingest({});
    const unrelated = await ingest({ "res/icon.png": "icon" });

    expect(empty).toMatchObject({ status: "rejected", error: { code: "ROUTE_DOCUMENT_MISSING" } });
    expect(unrelated).toMatchObject({ status: "rejected", error: { code: "ROUTE_DOCUMENT_MISSING" } });
  });

  it("rejects a damaged WPML instead of silently falling back to template KML", async () => {
    const result = await ingest({ "template.kml": template, "waylines.wpml": "<kml>" });

    expect(result).toMatchObject({ status: "rejected", error: { code: "INVALID_XML" } });
  });

  it("rejects a selected route document that has no XML signature", async () => {
    const result = await ingest({ "waylines.wpml": "not xml" });
    expect(result).toMatchObject({
      status: "rejected",
      error: { code: "INVALID_XML", details: { phase: "xml-encoding" } }
    });
  });

  it("rejects encrypted entries before trying to decode them", async () => {
    const bytes = setGeneralPurposeFlags(await makeKmz({ "waylines.wpml": wpml }), "waylines.wpml", 1);
    const result = await RouteImporter.ingest("mission.kmz", bytes, limits);

    expect(result).toMatchObject({ status: "rejected", error: { code: "ENCRYPTED_KMZ", details: { entryIndex: 0 } } });
  });

  it("rejects ambiguous ZIP structures instead of accepting the last parseable view", async () => {
    const valid = await makeKmz({ "waylines.wpml": wpml });
    const other = await makeKmz({ "template.kml": template });
    const cases = [
      appendArchiveData(valid, new Uint8Array([0x41, 0x42, 0x43])),
      concatenateArchives(other, valid),
      setLocalGeneralPurposeFlags(valid, "waylines.wpml", 1)
    ];

    for (const bytes of cases) {
      expect(await RouteImporter.ingest("mission.kmz", bytes, limits)).toMatchObject({
        status: "rejected",
        error: { code: "CORRUPT_KMZ" }
      });
    }
  });

  it("rejects overlapping local entry ranges", async () => {
    const bytes = await makeOverlappingKmz(wpml);

    expect(await RouteImporter.ingest("mission.kmz", bytes, limits)).toMatchObject({
      status: "rejected",
      error: { code: "CORRUPT_KMZ" }
    });
  });

  it("rejects unsafe archive paths", async () => {
    for (const path of ["../waylines.wpml", "/waylines.wpml", "C:/waylines.wpml", "././waylines.wpml"]) {
      const bytes = await makeKmz({ [path]: wpml });
      const result = await RouteImporter.ingest("mission.kmz", bytes, limits);
      if (path.startsWith("./")) expect(result.status).toBe("parsed");
      else expect(result).toMatchObject({ status: "rejected", error: { code: "UNSAFE_ARCHIVE_PATH" } });
    }
  });

  it.each([
    "./C:/waylines.wpml",
    "././D:/missions/waylines.wpml",
    "./\\\\server\\share\\waylines.wpml"
  ])("rejects an absolute archive path hidden behind dot segments", async (path) => {
    const result = await ingest({ [path]: wpml });

    expect(result).toMatchObject({
      status: "rejected",
      error: { code: "UNSAFE_ARCHIVE_PATH", details: { phase: "archive-path" } }
    });
  });

  it("reports a bounded Unicode-safe summary for an unsafe archive path", async () => {
    const path = `../${"😀".repeat(200)}.wpml`;
    const result = await ingest({ [path]: wpml });

    expect(result).toMatchObject({
      status: "rejected",
      error: {
        code: "UNSAFE_ARCHIVE_PATH",
        details: {
          phase: "archive-path",
          entryIndex: 0,
          entryNameSummary: [...path].slice(0, 160).join("")
        }
      }
    });
  });

  it("normalizes archive backslashes without rejecting a non-drive colon", async () => {
    const result = await ingest({
      "wpmz\\waylines.wpml": wpml,
      "resources/xC:data.bin": "resource"
    });

    expect(result).toMatchObject({
      status: "parsed",
      document: { sourceDocument: "wpmz/waylines.wpml", sourceKind: "waylines-wpml" }
    });
  });

  it("removes empty archive path segments from the selected source path", async () => {
    const result = await ingest({ "missions//waylines.wpml": wpml });

    expect(result).toMatchObject({
      status: "parsed",
      document: { sourceDocument: "missions/waylines.wpml" }
    });
  });

  it("rejects an entry whose normalized path is empty", async () => {
    const bytes = await makeKmz({ ".": "resource", "waylines.wpml": wpml });
    expect(await RouteImporter.ingest("mission.kmz", bytes, limits)).toMatchObject({
      status: "rejected",
      error: { code: "UNSAFE_ARCHIVE_PATH" }
    });
  });

  it("rejects control paths, duplicate normalized paths, symlinks, truncation, and invalid sizes", async () => {
    const control = await makeKmz({ [`way${String.fromCharCode(1)}lines.wpml`]: wpml });
    expect(await RouteImporter.ingest("mission.kmz", control, limits)).toMatchObject({ status: "rejected", error: { code: "UNSAFE_ARCHIVE_PATH" } });

    const duplicate = await makeKmz({ "A.txt": "a", "a.txt": "b" });
    expect(await RouteImporter.ingest("mission.kmz", duplicate, limits)).toMatchObject({
      status: "rejected",
      error: { code: "CORRUPT_KMZ", details: { phase: "archive-duplicate-path" } }
    });

    const symlink = await makeSymlinkKmz("waylines.wpml", wpml);
    expect(await RouteImporter.ingest("mission.kmz", symlink, limits)).toMatchObject({ status: "rejected", error: { code: "CORRUPT_KMZ" } });

    expect(await RouteImporter.ingest("mission.kmz", truncateArchive(await makeKmz({ "waylines.wpml": wpml })), limits)).toMatchObject({ status: "rejected", error: { code: "CORRUPT_KMZ" } });
    expect(await RouteImporter.ingest("mission.kmz", corruptDeclaredSize(await makeKmz({ "waylines.wpml": wpml }), "waylines.wpml"), limits)).toMatchObject({ status: "rejected", error: { code: "ARCHIVE_EXPANSION_LIMIT" } });
  });

  it("folds only ASCII case when comparing archive paths", async () => {
    const bytes = await makeKmz({
      "waylines.wpml": wpml,
      "res/Ä.txt": "upper",
      "res/ä.txt": "lower"
    });

    expect(await RouteImporter.ingest("mission.kmz", bytes, limits)).toMatchObject({
      status: "parsed",
      document: { sourceDocument: "waylines.wpml" }
    });
  });

  it.each([
    ["FIFO", 0o010666],
    ["character device", 0o020666],
    ["block device", 0o060666],
    ["socket", 0o140777]
  ])("rejects a %s archive entry", async (_kind, unixMode) => {
    const bytes = await makeSpecialEntryKmz("waylines.wpml", wpml, unixMode);

    expect(await RouteImporter.ingest("mission.kmz", bytes, limits)).toMatchObject({
      status: "rejected",
      error: { code: "CORRUPT_KMZ", details: { phase: "archive-special-entry" } }
    });
  });

  it("accepts explicit regular-file and directory Unix modes", async () => {
    const bytes = await makeModeAwareKmz([
      { name: "resources/", contents: "", unixMode: 0o040755 },
      { name: "waylines.wpml", contents: wpml, unixMode: 0o100644 }
    ]);

    expect(await RouteImporter.ingest("mission.kmz", bytes, limits)).toMatchObject({
      status: "parsed",
      document: { sourceDocument: "waylines.wpml" }
    });
  });

  it("accepts a zero-byte regular resource", async () => {
    expect(await ingest({ "waylines.wpml": wpml, "res/empty.bin": "" })).toMatchObject({
      status: "parsed",
      document: { sourceDocument: "waylines.wpml" }
    });
  });

  it("skips directory metadata and content streams entirely", async () => {
    type TestWriter = { writeUint8Array(value: Uint8Array): Promise<void>; getData(): Promise<Uint8Array> };
    const route = {
      filename: "waylines.wpml",
      directory: false as const,
      encrypted: false,
      unixMode: 0o100644,
      uncompressedSize: 6,
      async getData(writer: TestWriter) {
        await writer.writeUint8Array(new TextEncoder().encode("<kml/>"));
        return writer.getData();
      }
    };
    const directory = {
      filename: "resources/",
      directory: true as const,
      encrypted: false,
      unixMode: 0o040755,
      uncompressedSize: Number.NaN,
      async getData() {
        throw new Error("directory content must not be read");
      }
    };
    const prototype = ZipReader.prototype as unknown as {
      getEntriesGenerator(): AsyncGenerator<typeof route | typeof directory, boolean>;
    };
    const original = prototype.getEntriesGenerator;
    prototype.getEntriesGenerator = async function* () {
      yield directory;
      yield route;
      return true;
    };
    try {
      const result = await RouteImporter.ingest(
        "mission.kmz",
        new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        { ...limits, maxFileBytes: 4 }
      );
      expect(result).toMatchObject({ status: "parsed", document: { sourceDocument: "waylines.wpml" } });
    } finally {
      prototype.getEntriesGenerator = original;
    }
  });

  it("reports an unsafe path before an earlier special entry", async () => {
    const bytes = await makeModeAwareKmz([
      { name: "waylines.wpml", contents: wpml, unixMode: 0o010666 },
      { name: "../resource.bin", contents: "resource" }
    ]);

    expect(await RouteImporter.ingest("mission.kmz", bytes, limits)).toMatchObject({
      status: "rejected",
      error: { code: "UNSAFE_ARCHIVE_PATH" }
    });
  });

  it("enforces entry and expanded-size limits", async () => {
    const tooMany = await makeKmz({ a: "1", b: "2", c: "3" });
    const countResult = await RouteImporter.ingest("mission.kmz", tooMany, { ...limits, maxArchiveEntries: 2 });
    expect(countResult).toMatchObject({
      status: "rejected",
      error: { code: "ARCHIVE_ENTRY_LIMIT", details: { count: 3 } }
    });

    const expandedResult = await ingest(
      { "waylines.wpml": wpml, "res/blob.bin": "0123456789".repeat(200) },
      { maxFileBytes: 1024, maxExpandedBytes: 2048 }
    );
    expect(expandedResult).toMatchObject({
      status: "rejected",
      error: { code: "ARCHIVE_EXPANSION_LIMIT", details: { phase: "archive-metadata" } }
    });
  });

  it("accepts exact entry-count and declared/actual expansion boundaries", async () => {
    type TestWriter = {
      writeUint8Array(value: Uint8Array): Promise<void>;
      getData(): Promise<Uint8Array>;
    };
    const entry = (filename: string, contents: Uint8Array) => ({
      filename,
      directory: false as const,
      encrypted: false,
      unixMode: 0o100644,
      uncompressedSize: contents.byteLength,
      async getData(writer: TestWriter) {
        await writer.writeUint8Array(contents);
        const data = await writer.getData();
        if (!(data instanceof Uint8Array)) throw new Error("writer returned invalid data");
        return data;
      }
    });
    const prototype = ZipReader.prototype as unknown as {
      getEntriesGenerator(): AsyncGenerator<ReturnType<typeof entry>, boolean>;
    };
    const original = prototype.getEntriesGenerator;
    prototype.getEntriesGenerator = async function* () {
      yield entry("waylines.wpml", new TextEncoder().encode("<kml/>"));
      yield entry("res/data.bin", new Uint8Array([1, 2]));
      return true;
    };
    try {
      const result = await RouteImporter.ingest(
        "mission.kmz",
        new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        { maxFileBytes: 4, maxArchiveEntries: 2, maxExpandedBytes: 8, maxWaypoints: 1 }
      );
      expect(result).toMatchObject({ status: "parsed", document: { sourceDocument: "waylines.wpml" } });
    } finally {
      prototype.getEntriesGenerator = original;
    }
  });

  it("retains copied decompression chunks at their original offsets", async () => {
    type TestWriter = {
      writeUint8Array(value: Uint8Array): Promise<void>;
      getData(): Promise<Uint8Array>;
    };
    const fakeEntry = {
      filename: "waylines.wpml",
      directory: false as const,
      encrypted: false,
      unixMode: 0o100644,
      uncompressedSize: 6,
      async getData(writer: TestWriter) {
        const reused = new TextEncoder().encode("<km");
        await writer.writeUint8Array(reused);
        reused.set(new TextEncoder().encode("l/>"));
        await writer.writeUint8Array(reused);
        return writer.getData();
      }
    };
    const prototype = ZipReader.prototype as unknown as {
      getEntriesGenerator(): AsyncGenerator<typeof fakeEntry, boolean>;
    };
    const original = prototype.getEntriesGenerator;
    prototype.getEntriesGenerator = async function* () {
      yield fakeEntry;
      return true;
    };
    try {
      const result = await RouteImporter.ingest(
        "mission.kmz",
        new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        { ...limits, maxFileBytes: 4 }
      );
      expect(result).toMatchObject({ status: "parsed", document: { sourceDocument: "waylines.wpml" } });
    } finally {
      prototype.getEntriesGenerator = original;
    }
  });

  it("returns the retained XML buffer without a second full-document copy", async () => {
    type TestWriter = {
      writeUint8Array(value: Uint8Array): Promise<void>;
      getData(): Promise<Uint8Array>;
    };
    const fakeEntry = {
      filename: "waylines.wpml",
      directory: false as const,
      encrypted: false,
      unixMode: 0o100644,
      uncompressedSize: 6,
      async getData(writer: TestWriter) {
        await writer.writeUint8Array(new TextEncoder().encode("<kml/>"));
        const first = await writer.getData();
        const second = await writer.getData();
        if (first !== second) throw new Error("retained XML was copied during assembly");
        return first;
      }
    };
    const prototype = ZipReader.prototype as unknown as {
      getEntriesGenerator(): AsyncGenerator<typeof fakeEntry, boolean>;
    };
    const original = prototype.getEntriesGenerator;
    prototype.getEntriesGenerator = async function* () {
      yield fakeEntry;
      return true;
    };
    try {
      const result = await RouteImporter.ingest(
        "mission.kmz",
        new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        { ...limits, maxFileBytes: 4 }
      );
      expect(result).toMatchObject({ status: "parsed", document: { sourceDocument: "waylines.wpml" } });
    } finally {
      prototype.getEntriesGenerator = original;
    }
  });

  it("rejects selected XML whose streamed bytes exceed its declared size", async () => {
    type TestWriter = {
      writeUint8Array(value: Uint8Array): Promise<void>;
      getData(): Promise<Uint8Array>;
    };
    const fakeEntry = {
      filename: "waylines.wpml",
      directory: false as const,
      encrypted: false,
      unixMode: 0o100644,
      uncompressedSize: 6,
      async getData(writer: TestWriter) {
        await writer.writeUint8Array(new TextEncoder().encode("<kml"));
        await writer.writeUint8Array(new TextEncoder().encode("/>!"));
        return writer.getData();
      }
    };
    const prototype = ZipReader.prototype as unknown as {
      getEntriesGenerator(): AsyncGenerator<typeof fakeEntry, boolean>;
    };
    const original = prototype.getEntriesGenerator;
    prototype.getEntriesGenerator = async function* () {
      yield fakeEntry;
      return true;
    };
    try {
      const result = await RouteImporter.ingest(
        "mission.kmz",
        new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        { ...limits, maxFileBytes: 4 }
      );
      expect(result).toMatchObject({
        status: "rejected",
        error: { code: "CORRUPT_KMZ", details: { phase: "archive-stream" } }
      });
    } finally {
      prototype.getEntriesGenerator = original;
    }
  });

  it("enforces the total expansion limit before accepting an understated selected entry", async () => {
    type TestWriter = {
      writeUint8Array(value: Uint8Array): Promise<void>;
      getData(): Promise<Uint8Array>;
    };
    const entry = (filename: string, contents: Uint8Array, uncompressedSize: number) => ({
      filename,
      directory: false as const,
      encrypted: false,
      unixMode: 0o100644,
      uncompressedSize,
      async getData(writer: TestWriter) {
        await writer.writeUint8Array(contents);
        return writer.getData();
      }
    });
    const prototype = ZipReader.prototype as unknown as {
      getEntriesGenerator(): AsyncGenerator<ReturnType<typeof entry>, boolean>;
    };
    const original = prototype.getEntriesGenerator;
    prototype.getEntriesGenerator = async function* () {
      yield entry("waylines.wpml", new TextEncoder().encode("<kml/>"), 6);
      yield entry("res/blob.bin", new Uint8Array([1, 2, 3]), 1);
      return true;
    };
    try {
      const result = await RouteImporter.ingest(
        "mission.kmz",
        new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        { ...limits, maxFileBytes: 4, maxExpandedBytes: 8 }
      );
      expect(result).toMatchObject({
        status: "rejected",
        error: { code: "ARCHIVE_EXPANSION_LIMIT", details: { phase: "archive-stream" } }
      });
    } finally {
      prototype.getEntriesGenerator = original;
    }
  });

  it("rejects selected XML whose streamed bytes end before its declared size", async () => {
    type TestWriter = {
      writeUint8Array(value: Uint8Array): Promise<void>;
      getData(): Promise<Uint8Array>;
    };
    const fakeEntry = {
      filename: "waylines.wpml",
      directory: false as const,
      encrypted: false,
      unixMode: 0o100644,
      uncompressedSize: 7,
      async getData(writer: TestWriter) {
        await writer.writeUint8Array(new TextEncoder().encode("<kml/>"));
        return writer.getData();
      }
    };
    const prototype = ZipReader.prototype as unknown as {
      getEntriesGenerator(): AsyncGenerator<typeof fakeEntry, boolean>;
    };
    const original = prototype.getEntriesGenerator;
    prototype.getEntriesGenerator = async function* () {
      yield fakeEntry;
      return true;
    };
    try {
      const result = await RouteImporter.ingest(
        "mission.kmz",
        new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        { ...limits, maxFileBytes: 4 }
      );
      expect(result).toMatchObject({
        status: "rejected",
        error: { code: "CORRUPT_KMZ", details: { phase: "archive-stream" } }
      });
    } finally {
      prototype.getEntriesGenerator = original;
    }
  });

  it("cancels while a selected XML stream cooperatively yields", async () => {
    type TestWriter = {
      writeUint8Array(value: Uint8Array): Promise<void>;
      getData(): Promise<Uint8Array>;
    };
    const contents = new Uint8Array(1024 * 1024);
    contents.fill(0x20);
    contents.set(new TextEncoder().encode("<kml/>"));
    const fakeEntry = {
      filename: "waylines.wpml",
      directory: false as const,
      encrypted: false,
      unixMode: 0o100644,
      uncompressedSize: contents.byteLength,
      async getData(writer: TestWriter) {
        const timer = setTimeout(() => { cancellation.aborted = true; }, 0);
        try {
          await writer.writeUint8Array(contents);
        } finally {
          clearTimeout(timer);
        }
        return writer.getData();
      }
    };
    const prototype = ZipReader.prototype as unknown as {
      getEntriesGenerator(): AsyncGenerator<typeof fakeEntry, boolean>;
    };
    const original = prototype.getEntriesGenerator;
    prototype.getEntriesGenerator = async function* () {
      yield fakeEntry;
      return true;
    };
    const cancellation = { aborted: false };
    try {
      await expect(RouteImporter.ingest(
        "mission.kmz",
        new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        { ...limits, maxFileBytes: 2 * 1024 * 1024, maxExpandedBytes: 2 * 1024 * 1024 },
        cancellation
      )).resolves.toEqual({ status: "cancelled" });
    } finally {
      prototype.getEntriesGenerator = original;
    }
  });

  it("continues after a selected XML stream cooperatively yields", async () => {
    type TestWriter = {
      writeUint8Array(value: Uint8Array): Promise<void>;
      getData(): Promise<Uint8Array>;
    };
    const contents = new Uint8Array(1024 * 1024);
    contents.fill(0x20);
    contents.set(new TextEncoder().encode("<kml/>"));
    const fakeEntry = {
      filename: "waylines.wpml",
      directory: false as const,
      encrypted: false,
      unixMode: 0o100644,
      uncompressedSize: contents.byteLength,
      async getData(writer: TestWriter) {
        const timer = setTimeout(() => { timerRan = true; }, 0);
        await writer.writeUint8Array(contents);
        clearTimeout(timer);
        if (!timerRan) throw new Error("stream writer did not yield before completing");
        return writer.getData();
      }
    };
    const prototype = ZipReader.prototype as unknown as {
      getEntriesGenerator(): AsyncGenerator<typeof fakeEntry, boolean>;
    };
    const original = prototype.getEntriesGenerator;
    prototype.getEntriesGenerator = async function* () {
      yield fakeEntry;
      return true;
    };
    let timerRan = false;
    try {
      const result = await RouteImporter.ingest(
        "mission.kmz",
        new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        { ...limits, maxFileBytes: 2 * 1024 * 1024, maxExpandedBytes: 2 * 1024 * 1024 }
      );
      expect(result.status).toBe("parsed");
      expect(timerRan).toBe(true);
    } finally {
      prototype.getEntriesGenerator = original;
    }
  });

  it("does not yield while retaining selected XML below the one-mebibyte scheduling boundary", async () => {
    type TestWriter = {
      writeUint8Array(value: Uint8Array): Promise<void>;
      getData(): Promise<Uint8Array>;
    };
    const contents = new Uint8Array(1024 * 1024 - 1);
    contents.fill(0x20);
    contents.set(new TextEncoder().encode("<kml/>"));
    const fakeEntry = {
      filename: "waylines.wpml",
      directory: false as const,
      encrypted: false,
      unixMode: 0o100644,
      uncompressedSize: contents.byteLength,
      async getData(writer: TestWriter) {
        let timerRan = false;
        const timer = setTimeout(() => { timerRan = true; }, 0);
        await writer.writeUint8Array(contents);
        clearTimeout(timer);
        if (timerRan) throw new Error("small stream yielded before completing");
        return writer.getData();
      }
    };
    const prototype = ZipReader.prototype as unknown as {
      getEntriesGenerator(): AsyncGenerator<typeof fakeEntry, boolean>;
    };
    const original = prototype.getEntriesGenerator;
    prototype.getEntriesGenerator = async function* () {
      yield fakeEntry;
      return true;
    };
    try {
      const result = await RouteImporter.ingest(
        "mission.kmz",
        new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        { ...limits, maxFileBytes: 2 * 1024 * 1024, maxExpandedBytes: 2 * 1024 * 1024 }
      );
      expect(result.status).toBe("parsed");
    } finally {
      prototype.getEntriesGenerator = original;
    }
  });

  it("preserves cancellation when a ZIP reader masks a yielded stream failure", async () => {
    type TestWriter = {
      writeUint8Array(value: Uint8Array): Promise<void>;
      getData(): Promise<Uint8Array>;
    };
    const contents = new Uint8Array(1024 * 1024);
    contents.fill(0x20);
    contents.set(new TextEncoder().encode("<kml/>"));
    const fakeEntry = {
      filename: "waylines.wpml",
      directory: false as const,
      encrypted: false,
      unixMode: 0o100644,
      uncompressedSize: contents.byteLength,
      async getData(writer: TestWriter) {
        try {
          await writer.writeUint8Array(contents);
        } catch {
          return new Uint8Array(0);
        }
        return writer.getData();
      }
    };
    const prototype = ZipReader.prototype as unknown as {
      getEntriesGenerator(): AsyncGenerator<typeof fakeEntry, boolean>;
    };
    const original = prototype.getEntriesGenerator;
    prototype.getEntriesGenerator = async function* () {
      yield fakeEntry;
      return true;
    };
    let reads = 0;
    const cancellation = {
      get aborted() {
        reads += 1;
        return reads === 11;
      }
    };
    try {
      await expect(RouteImporter.ingest(
        "mission.kmz",
        new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        { ...limits, maxFileBytes: 2 * 1024 * 1024, maxExpandedBytes: 2 * 1024 * 1024 },
        cancellation
      )).resolves.toEqual({ status: "cancelled" });
    } finally {
      prototype.getEntriesGenerator = original;
    }
  });

  it("enforces actual expansion bytes when the ZIP dependency understates metadata", async () => {
    type TestWriter = {
      writeUint8Array(value: Uint8Array): Promise<void>;
      getData(): Promise<Uint8Array>;
    };
    const entry = (filename: string, contents: Uint8Array, uncompressedSize: number) => ({
      filename,
      directory: false as const,
      encrypted: false,
      unixMode: undefined,
      uncompressedSize,
      async getData(writer: TestWriter) {
        await writer.writeUint8Array(contents);
        return writer.getData();
      }
    });
    const prototype = ZipReader.prototype as unknown as {
      getEntriesGenerator(): AsyncGenerator<ReturnType<typeof entry>, boolean>;
    };
    const original = prototype.getEntriesGenerator;
    prototype.getEntriesGenerator = async function* () {
      yield entry("waylines.wpml", new TextEncoder().encode("<kml/>"), 6);
      yield entry("res/blob.bin", new Uint8Array([1, 2, 3]), 1);
      return true;
    };
    try {
      const result = await RouteImporter.ingest(
        "mission.kmz",
        new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        { ...limits, maxFileBytes: 4, maxExpandedBytes: 8 }
      );
      expect(result).toMatchObject({
        status: "rejected",
        error: { code: "ARCHIVE_EXPANSION_LIMIT", details: { phase: "archive-stream" } }
      });
    } finally {
      prototype.getEntriesGenerator = original;
    }
  });

  it("preserves a streamed expansion error when the ZIP dependency masks it", async () => {
    type TestWriter = {
      writeUint8Array(value: Uint8Array): Promise<void>;
      getData(): Promise<Uint8Array>;
    };
    const entry = (filename: string, contents: Uint8Array, uncompressedSize: number, masksWriterFailure = false) => ({
      filename,
      directory: false as const,
      encrypted: false,
      unixMode: undefined,
      uncompressedSize,
      async getData(writer: TestWriter) {
        try {
          await writer.writeUint8Array(contents);
          return await writer.getData();
        } catch {
          if (masksWriterFailure) throw new Error("dependency masked writer failure");
          throw new Error("unexpected stream failure");
        }
      }
    });
    const prototype = ZipReader.prototype as unknown as {
      getEntriesGenerator(): AsyncGenerator<ReturnType<typeof entry>, boolean>;
    };
    const original = prototype.getEntriesGenerator;
    prototype.getEntriesGenerator = async function* () {
      yield entry("waylines.wpml", new TextEncoder().encode("<kml/>"), 6);
      yield entry("res/blob.bin", new Uint8Array([1, 2, 3]), 1, true);
      return true;
    };
    try {
      const result = await RouteImporter.ingest(
        "mission.kmz",
        new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        { ...limits, maxFileBytes: 4, maxExpandedBytes: 8 }
      );
      expect(result).toMatchObject({
        status: "rejected",
        error: { code: "ARCHIVE_EXPANSION_LIMIT", details: { phase: "archive-stream" } }
      });
    } finally {
      prototype.getEntriesGenerator = original;
    }
  });

  it.each([Number.NaN, -1, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid uncompressed size reported by the ZIP dependency",
    async (uncompressedSize) => {
      const fakeEntry = {
        filename: "waylines.wpml",
        directory: false as const,
        encrypted: false,
        unixMode: undefined,
        uncompressedSize,
        async getData() {
          throw new Error("invalid metadata must be rejected before extraction");
        }
      };
      const prototype = ZipReader.prototype as unknown as {
        getEntriesGenerator(): AsyncGenerator<typeof fakeEntry, boolean>;
      };
      const original = prototype.getEntriesGenerator;
      prototype.getEntriesGenerator = async function* () {
        yield fakeEntry;
        return true;
      };
      try {
        const result = await RouteImporter.ingest(
          "mission.kmz",
          new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
          { ...limits, maxFileBytes: 4 }
        );
        expect(result).toMatchObject({
          status: "rejected",
          error: { code: "ARCHIVE_EXPANSION_LIMIT", details: { entryIndex: 0, phase: "archive-metadata" } }
        });
      } finally {
        prototype.getEntriesGenerator = original;
      }
    }
  );

  it("checks unselected resources and CRC instead of trusting only the selected XML", async () => {
    const bytes = corruptPayloadByte(
      await makeKmz({ "waylines.wpml": wpml, "res/blob.bin": "resource" }),
      "res/blob.bin"
    );
    const result = await RouteImporter.ingest("mission.kmz", bytes, limits);

    expect(result).toMatchObject({
      status: "rejected",
      error: { code: "CORRUPT_KMZ", details: { phase: "archive-read" } }
    });
  });

  it("rejects a stored resource whose payload no longer matches its CRC", async () => {
    const bytes = corruptPayloadByte(
      await makeStoredKmz({ "waylines.wpml": wpml, "res/blob.bin": "resource" }),
      "res/blob.bin"
    );

    expect(await RouteImporter.ingest("mission.kmz", bytes, limits)).toMatchObject({
      status: "rejected",
      error: { code: "CORRUPT_KMZ", details: { phase: "archive-read" } }
    });
  });

  it("validates a corrupt resource before reporting that no route document exists", async () => {
    const bytes = corruptPayloadByte(await makeKmz({ "res/blob.bin": "resource" }), "res/blob.bin");

    expect(await RouteImporter.ingest("mission.kmz", bytes, limits)).toMatchObject({
      status: "rejected",
      error: { code: "CORRUPT_KMZ" }
    });
  });

  it("always closes the ZIP reader after a successful import", async () => {
    const prototype = ZipReader.prototype as unknown as { close(): Promise<void> };
    const originalClose = prototype.close;
    let closeCount = 0;
    prototype.close = async function () {
      closeCount += 1;
      await originalClose.call(this);
    };
    try {
      const result = await ingest({ "waylines.wpml": wpml });
      expect(result.status).toBe("parsed");
      expect(closeCount).toBe(1);
    } finally {
      prototype.close = originalClose;
    }
  });
});
