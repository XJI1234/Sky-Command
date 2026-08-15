import { describe, expect, it } from "vitest";
import { RouteImporter, type RouteImportCancellation, type RouteImportLimits } from "../src/modules/route-library/importer/index.js";
import { makeKmz } from "./helpers/zip-fixture.js";

const limits: RouteImportLimits = Object.freeze({
  maxFileBytes: 8 * 1024 * 1024,
  maxArchiveEntries: 100,
  maxExpandedBytes: 16 * 1024 * 1024,
  maxWaypoints: 100_000
});

function flippingCancellation(cancelAfterReads: number): RouteImportCancellation {
  let reads = 0;
  return {
    get aborted() {
      reads += 1;
      return reads > cancelAfterReads;
    }
  };
}

function largeKml(): Uint8Array {
  const coordinates = Array.from({ length: 20_000 }, (_, index) => `${120 + index / 100000},30.2,50`).join(" ");
  return new TextEncoder().encode(`<kml><Placemark><LineString><coordinates>${coordinates}</coordinates></LineString></Placemark></kml>`);
}

function utf16beKmlAfterWhitespace(whitespaceLength: number): Uint8Array {
  const xml = "<kml/>";
  const bytes = new Uint8Array((whitespaceLength + xml.length) * 2);
  for (let index = 0; index < whitespaceLength; index += 1) bytes[index * 2 + 1] = 0x20;
  for (let index = 0; index < xml.length; index += 1) bytes[(whitespaceLength + index) * 2 + 1] = xml.charCodeAt(index);
  return bytes;
}

describe("D3.2 cancellation and concurrent isolation", () => {
  it("cancels during large XML processing without returning a partial document", async () => {
    const cancellation = { aborted: false };
    const timer = setTimeout(() => { cancellation.aborted = true; }, 0);
    const result = await RouteImporter.ingest("large.kml", largeKml(), limits, cancellation);
    clearTimeout(timer);

    expect(result).toEqual({ status: "cancelled" });
    expect(cancellation.aborted).toBe(true);
  });

  it("yields during XML processing before reporting a trailing syntax error", async () => {
    let timerRan = false;
    setTimeout(() => { timerRan = true; }, 0);
    const bytes = new TextEncoder().encode(`<kml><Document>${" ".repeat(70_000)}</broken>`);

    const result = await RouteImporter.ingest("large-invalid.kml", bytes, limits);

    expect(result).toMatchObject({ status: "rejected", error: { code: "INVALID_XML" } });
    expect(timerRan).toBe(true);
  });

  it("yields while detecting a container with more than 1 MiB of leading XML whitespace", async () => {
    let timerRan = false;
    const timer = setTimeout(() => { timerRan = true; }, 0);
    const bytes = new TextEncoder().encode(`${" ".repeat(1024 * 1024 + 1)}<kml/>`);

    const result = await RouteImporter.ingest("large.kmz", bytes, limits);
    clearTimeout(timer);

    expect(result).toMatchObject({ status: "rejected", error: { code: "FORMAT_MISMATCH" } });
    expect(timerRan).toBe(true);
  });

  it("yields while recognizing no-BOM UTF-16 XML with more than 1 MiB of leading whitespace", async () => {
    let timerRan = false;
    const timer = setTimeout(() => { timerRan = true; }, 0);

    const result = await RouteImporter.ingest("large.kml", utf16beKmlAfterWhitespace(1024 * 1024 + 1), limits);
    clearTimeout(timer);

    expect(result.status).toBe("parsed");
    expect(timerRan).toBe(true);
  });

  it("yields at the exact UTF-16 container-detection byte boundary before returning a format mismatch", async () => {
    let timerRan = false;
    const timer = setTimeout(() => { timerRan = true; }, 0);

    const result = await RouteImporter.ingest("large.kmz", utf16beKmlAfterWhitespace(512 * 1024), limits);
    clearTimeout(timer);

    expect(result).toMatchObject({ status: "rejected", error: { code: "FORMAT_MISMATCH" } });
    expect(timerRan).toBe(true);
  });

  it("yields at the exact UTF-8 container-detection byte boundary before returning a format mismatch", async () => {
    let timerRan = false;
    const timer = setTimeout(() => { timerRan = true; }, 0);
    const bytes = new TextEncoder().encode(`${" ".repeat(1024 * 1024)}<kml/>`);

    const result = await RouteImporter.ingest("large.kmz", bytes, limits);
    clearTimeout(timer);

    expect(result).toMatchObject({ status: "rejected", error: { code: "FORMAT_MISMATCH" } });
    expect(timerRan).toBe(true);
  });

  it("schedules only one UTF-8 detection yield between one mebibyte and the opening tag", async () => {
    let reads = 0;
    const cancellation: RouteImportCancellation = {
      get aborted() {
        reads += 1;
        return false;
      }
    };
    const bytes = new TextEncoder().encode(`${" ".repeat(1024 * 1024 + 1)}<kml/>`);

    const result = await RouteImporter.ingest("large.kmz", bytes, limits, cancellation);

    expect(result).toMatchObject({ status: "rejected", error: { code: "FORMAT_MISMATCH" } });
    expect(reads).toBe(5);
  });

  it("cancels while decompressing a KMZ entry", async () => {
    const bytes = await makeKmz({ "waylines.wpml": "<kml><Placemark><Point><coordinates>1,1</coordinates></Point></Placemark></kml>", "res/data.txt": "data".repeat(10_000) });
    const result = await RouteImporter.ingest("mission.kmz", bytes, limits, flippingCancellation(12));

    expect(result).toEqual({ status: "cancelled" });
  });

  it("returns a domain invariant error when cancellation cannot be read", async () => {
    const cancellation: RouteImportCancellation = { get aborted(): boolean { throw new Error("broken signal"); } };
    const result = await RouteImporter.ingest("route.kml", new Uint8Array([60]), limits, cancellation);
    expect(result).toMatchObject({
      status: "rejected",
      error: {
        code: "DOMAIN_INVARIANT_VIOLATION",
        details: { phase: "cancellation", reason: "unreadable" }
      }
    });
  });

  it("keeps concurrent snapshots and candidate arrays isolated", async () => {
    const [first, second] = await Promise.all([
      RouteImporter.ingest("first.kml", new TextEncoder().encode("<kml><LineString><coordinates>1,1 2,2</coordinates></LineString></kml>"), limits),
      RouteImporter.ingest("second.kml", new TextEncoder().encode("<kml><LineString><coordinates>3,3 4,4</coordinates></LineString></kml>"), limits)
    ]);

    expect(first.status).toBe("parsed");
    expect(second.status).toBe("parsed");
    if (first.status === "parsed" && second.status === "parsed") {
      first.document.originalBytes.fill(0);
      expect(second.document.waypointCandidates[0]?.longitudeText).toBe("3");
      expect(first.document.waypointCandidates[0]?.longitudeText).toBe("1");
    }
  });
});
