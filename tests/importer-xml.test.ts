import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RouteImporter, type RouteImportLimits } from "../src/modules/route-library/importer/index.js";
import { makeKmz } from "./helpers/zip-fixture.js";

const limits: RouteImportLimits = Object.freeze({
  maxFileBytes: 1024 * 1024,
  maxArchiveEntries: 100,
  maxExpandedBytes: 2 * 1024 * 1024,
  maxWaypoints: 10
});

function utf8(xml: string): Uint8Array {
  return new TextEncoder().encode(xml);
}

function utf16le(xml: string): Uint8Array {
  const bytes = new Uint8Array(2 + xml.length * 2);
  bytes.set([0xff, 0xfe]);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < xml.length; index += 1) view.setUint16(2 + index * 2, xml.charCodeAt(index), true);
  return bytes;
}

function utf16be(xml: string): Uint8Array {
  const bytes = new Uint8Array(2 + xml.length * 2);
  bytes.set([0xfe, 0xff]);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < xml.length; index += 1) view.setUint16(2 + index * 2, xml.charCodeAt(index), false);
  return bytes;
}

function utf16WithoutBom(xml: string, littleEndian: boolean): Uint8Array {
  const bytes = new Uint8Array(xml.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < xml.length; index += 1) view.setUint16(index * 2, xml.charCodeAt(index), littleEndian);
  return bytes;
}

async function parse(xml: string | Uint8Array, overrides: Partial<RouteImportLimits> = {}) {
  return RouteImporter.ingest(" 航线.KML ", typeof xml === "string" ? utf8(xml) : xml, { ...limits, ...overrides });
}

async function parseWpml(xml: string, overrides: Partial<RouteImportLimits> = {}) {
  const bytes = await makeKmz({ "waylines.wpml": xml });
  return RouteImporter.ingest("mission.kmz", bytes, { ...limits, ...overrides });
}

describe("D3.2 KML syntax parsing", () => {
  it("parses the real Wayline Hangzhou KML fixture", async () => {
    const bytes = new Uint8Array(await readFile(new URL("./fixtures/wayline-hangzhou-orbit.kml", import.meta.url)));
    const result = await RouteImporter.ingest("wayline-hangzhou-orbit.kml", bytes, limits);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.document.waypointCandidates).toHaveLength(4);
      expect(result.document.waypointCandidates[0]).toMatchObject({ longitudeText: "120.16720400471", latitudeText: "30.3221040027", altitudeText: "43.25" });
    }
  });

  it("returns ordered raw LineString candidates, exact SHA-256, and isolated bytes", async () => {
    const xml = "<kml xmlns=\"http://www.opengis.net/kml/2.2\"><Document><Placemark><LineString><coordinates>120.1,30.2,50 120.2,30.3</coordinates></LineString></Placemark></Document></kml>";
    const bytes = utf8(xml);

    const result = await RouteImporter.ingest(" 航线.KML ", bytes, limits);

    expect(result.status).toBe("parsed");
    if (result.status !== "parsed") return;
    expect(result.document).toMatchObject({
      fileName: "航线.KML",
      format: "kml",
      sourceDocument: "航线.KML",
      sourceKind: "kml",
      wpmlNamespace: null,
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex")
    });
    expect(result.document.waypointCandidates).toEqual([
      {
        documentOrder: 0,
        declaredSequenceText: null,
        longitudeText: "120.1",
        latitudeText: "30.2",
        altitudeText: "50",
        altitudeSource: "coordinate",
        malformed: false,
        rawSummary: "120.1,30.2,50"
      },
      {
        documentOrder: 1,
        declaredSequenceText: null,
        longitudeText: "120.2",
        latitudeText: "30.3",
        altitudeText: null,
        altitudeSource: "missing",
        malformed: false,
        rawSummary: "120.2,30.3"
      }
    ]);
    const firstCopy = result.document.originalBytes;
    firstCopy.fill(0);
    expect(result.document.originalBytes).toEqual(bytes);
    expect(result.document.originalBytes).not.toBe(firstCopy);
    expect(Object.keys(result.document)).toContain("originalBytes");
  });

  it("uses every LineString in document order and ignores Point fallback", async () => {
    const result = await parse(`<kml><Document>
      <Placemark><Point><coordinates>1,1,1</coordinates></Point></Placemark>
      <Placemark><LineString><coordinates>2,2,2 3,3,3</coordinates></LineString></Placemark>
      <Placemark><LineString><coordinates>4,4,4</coordinates></LineString></Placemark>
    </Document></kml>`);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.document.waypointCandidates.map((candidate) => candidate.longitudeText)).toEqual(["2", "3", "4"]);
    }
  });

  it("does not count ignored Point fallback candidates against the LineString limit", async () => {
    const result = await parse(`<kml><Document>
      <Placemark><LineString><coordinates>120,30</coordinates></LineString></Placemark>
      <Placemark><Point><coordinates>121,31</coordinates></Point></Placemark>
      <Placemark><Point><coordinates>122,32</coordinates></Point></Placemark>
    </Document></kml>`, { maxWaypoints: 1 });

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.document.waypointCandidates).toHaveLength(1);
      expect(result.document.waypointCandidates[0]?.longitudeText).toBe("120");
    }
  });

  it("does not fall back to Point when an empty LineString coordinates element exists", async () => {
    const result = await parse(`<kml><Placemark><LineString><coordinates>   </coordinates></LineString></Placemark>
      <Placemark><Point><coordinates>9,9</coordinates></Point></Placemark></kml>`);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates).toEqual([]);
  });

  it("uses Point fallback when a LineString has no coordinates element", async () => {
    const result = await parse(`<kml><Placemark><LineString><name>not coordinates</name></LineString></Placemark>
      <Placemark><Point><coordinates>9,8</coordinates></Point></Placemark></kml>`);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.document.waypointCandidates).toMatchObject([{ longitudeText: "9", latitudeText: "8" }]);
    }
  });

  it("ignores Polygon coordinates when choosing between LineString and Point", async () => {
    const result = await parse(`<kml><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>5,5 6,6</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
      <Placemark><Point><coordinates>1,2</coordinates></Point></Placemark></kml>`);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.document.waypointCandidates).toMatchObject([{ longitudeText: "1", latitudeText: "2" }]);
    }
  });

  it("ignores route-like geometry inside excluded KML subtrees", async () => {
    const result = await parse(`<kml><Document>
      <Style><LineString><coordinates>10,20</coordinates></LineString></Style>
      <Placemark>
        <description><Point><coordinates>11,21</coordinates></Point></description>
        <Point><coordinates>120,30</coordinates></Point>
      </Placemark>
    </Document></kml>`);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.document.waypointCandidates).toHaveLength(1);
      expect(result.document.waypointCandidates[0]).toMatchObject({
        longitudeText: "120",
        latitudeText: "30",
        malformed: false
      });
    }
  });

  it.each(["Camera", "LinearRing", "LookAt", "Model", "Polygon", "StyleMap"])(
    "ignores route-like geometry inside the %s subtree",
    async (subtree) => {
      const result = await parse(`<kml><${subtree}><LineString><coordinates>9,9</coordinates></LineString></${subtree}>
        <Placemark><Point><coordinates>1,2</coordinates></Point></Placemark></kml>`);

      expect(result).toMatchObject({
        status: "parsed",
        document: { waypointCandidates: [{ longitudeText: "1", latitudeText: "2" }] }
      });
    }
  );

  it("keeps an outer excluded subtree active after a nested excluded subtree closes", async () => {
    const result = await parse(`<kml><Style><StyleMap/><LineString><coordinates>9,9</coordinates></LineString></Style>
      <Placemark><Point><coordinates>1,2</coordinates></Point></Placemark></kml>`);

    expect(result).toMatchObject({
      status: "parsed",
      document: { waypointCandidates: [{ longitudeText: "1", latitudeText: "2" }] }
    });
  });

  it("does not append excluded subtree text to an outer coordinate or field capture", async () => {
    const kml = await parse("<kml><LineString><coordinates>1,<description>9</description>2</coordinates></LineString></kml>");
    const wpmlResult = await parseWpml(`<kml xmlns:w="http://www.dji.com/wpmz/1.0.6"><Placemark>
      <Point><coordinates>1,2</coordinates></Point><w:height>4<w:actionGroup>9</w:actionGroup>2</w:height>
    </Placemark></kml>`);

    expect(kml).toMatchObject({
      status: "parsed",
      document: { waypointCandidates: [{ longitudeText: "1", latitudeText: "2", malformed: false }] }
    });
    expect(wpmlResult).toMatchObject({
      status: "parsed",
      document: { waypointCandidates: [{ altitudeText: "42", malformed: false }] }
    });
  });

  it("ignores route-like geometry inside WPML metadata and action subtrees", async () => {
    const result = await parseWpml(`<kml xmlns:w="http://www.dji.com/wpmz/1.0.6"><Placemark>
      <w:actionGroup><Point><coordinates>10,20</coordinates></Point></w:actionGroup>
      <Point><coordinates>120,30</coordinates></Point><w:index>0</w:index>
    </Placemark></kml>`);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.document.waypointCandidates).toHaveLength(1);
      expect(result.document.waypointCandidates[0]).toMatchObject({
        longitudeText: "120",
        latitudeText: "30",
        declaredSequenceText: "0",
        malformed: false
      });
    }
  });

  it("ignores coordinates and placemarks from non-KML namespaces", async () => {
    const result = await parse(`<kml xmlns:x="urn:other"><x:Placemark><x:Point><x:coordinates>9,9</x:coordinates></x:Point></x:Placemark>
      <Placemark><Point><coordinates>1,2</coordinates></Point></Placemark></kml>`);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates.map((candidate) => candidate.longitudeText)).toEqual(["1"]);
  });

  it("ignores Point and coordinates that are not inside a KML Placemark", async () => {
    const result = await parse("<kml><Point><coordinates>9,9</coordinates></Point><Placemark><Point><coordinates>1,2</coordinates><x:coordinates xmlns:x=\"urn:other\">8,8</x:coordinates></Point></Placemark></kml>");
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates).toMatchObject([{ longitudeText: "1", malformed: false }]);
  });

  it("falls back to Placemark Point and records namespaced height text", async () => {
    const result = await parse(`<kml xmlns:w="http://www.dji.com/wpmz/1.0.6"><Document><Placemark>
      <Point><coordinates>120,30</coordinates></Point><w:executeHeight> 42.5 </w:executeHeight>
    </Placemark></Document></kml>`);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.document.wpmlNamespace).toBe("http://www.dji.com/wpmz/1.0.6");
      expect(result.document.waypointCandidates[0]).toMatchObject({
        altitudeText: "42.5",
        altitudeSource: "execute-height"
      });
    }
  });

  it("uses coordinate altitude before every fallback height field", async () => {
    const result = await parse(`<kml xmlns:w="http://www.dji.com/wpmz/1.0.6"><Placemark>
      <Point><coordinates>120,30,7</coordinates></Point><w:executeHeight>42</w:executeHeight><w:ellipsoidHeight>43</w:ellipsoidHeight><w:height>44</w:height>
    </Placemark></kml>`);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      altitudeText: "7",
      altitudeSource: "coordinate",
      malformed: false
    });
  });

  it("keeps malformed state from conflicting height fields even when coordinate altitude wins", async () => {
    const result = await parse(`<kml xmlns:w="http://www.dji.com/wpmz/1.0.6"><Placemark>
      <Point><coordinates>120,30,7</coordinates></Point><w:executeHeight>42</w:executeHeight><w:executeHeight>43</w:executeHeight>
    </Placemark></kml>`);

    expect(result).toMatchObject({
      status: "parsed",
      document: { waypointCandidates: [{ altitudeText: "7", altitudeSource: "coordinate", malformed: true }] }
    });
  });

  it("uses WPML execute height before coordinate altitude", async () => {
    const bytes = await makeKmz({ "waylines.wpml": "<kml xmlns:w=\"http://www.dji.com/wpmz/1.0.6\"><Placemark><Point><coordinates>120,30,7</coordinates></Point><w:executeHeight>42</w:executeHeight></Placemark></kml>" });
    const result = await RouteImporter.ingest(
      "mission.kmz",
      bytes,
      limits
    );

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      altitudeText: "42",
      altitudeSource: "execute-height"
    });
  });

  it("keeps malformed state from a conflicting lower-priority WPML height", async () => {
    const result = await parseWpml(`<kml xmlns:w="http://www.dji.com/wpmz/1.0.6"><Placemark>
      <Point><coordinates>120,30,7</coordinates></Point><w:executeHeight>42</w:executeHeight>
      <w:ellipsoidHeight>50</w:ellipsoidHeight><w:ellipsoidHeight>51</w:ellipsoidHeight>
    </Placemark></kml>`);

    expect(result).toMatchObject({
      status: "parsed",
      document: { waypointCandidates: [{ altitudeText: "42", altitudeSource: "execute-height", malformed: true }] }
    });
  });

  it("uses coordinate altitude as the final WPML height fallback", async () => {
    const result = await parseWpml("<kml><Placemark><Point><coordinates>120,30,7</coordinates></Point></Placemark></kml>");

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      altitudeText: "7",
      altitudeSource: "coordinate",
      malformed: false
    });
  });

  it("returns an explicit missing sequence for a WPML point without index", async () => {
    const result = await parseWpml("<kml><Placemark><Point><coordinates>1,2</coordinates></Point></Placemark></kml>");

    expect(result).toMatchObject({
      status: "parsed",
      document: { waypointCandidates: [{ declaredSequenceText: null, malformed: false }] }
    });
  });

  it("continues to a lower-priority WPML height when the preferred field is blank", async () => {
    const result = await parseWpml(`<kml xmlns:w="http://www.dji.com/wpmz/1.0.6"><Placemark>
      <Point><coordinates>120,30</coordinates></Point>
      <w:executeHeight>   </w:executeHeight><w:ellipsoidHeight>55</w:ellipsoidHeight>
    </Placemark></kml>`);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      altitudeText: "55",
      altitudeSource: "ellipsoid-height",
      malformed: false
    });
  });

  it("marks truncation in any duplicate semantic field as malformed", async () => {
    const exact = "7".repeat(160);
    const result = await parseWpml(`<kml xmlns:w="http://www.dji.com/wpmz/1.0.6"><Placemark>
      <Point><coordinates>120,30</coordinates></Point>
      <w:index>${exact}</w:index><w:index>${exact}7</w:index>
      <w:executeHeight>${exact}</w:executeHeight><w:executeHeight>${exact}7</w:executeHeight>
    </Placemark></kml>`);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      declaredSequenceText: exact,
      altitudeText: exact,
      altitudeSource: "execute-height",
      malformed: true
    });
  });

  it("marks conflicting duplicate preferred heights malformed while retaining the first value", async () => {
    const result = await parse(`<kml xmlns:w="http://www.dji.com/wpmz/1.0.6"><Placemark>
      <Point><coordinates>120,30</coordinates></Point><w:executeHeight>42</w:executeHeight><w:executeHeight>43</w:executeHeight>
    </Placemark></kml>`);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      altitudeText: "42",
      altitudeSource: "execute-height",
      malformed: true
    });
  });

  it("marks conflicting duplicate WPML indexes malformed while retaining document order", async () => {
    const result = await parseWpml(`<kml xmlns:w="http://www.dji.com/wpmz/1.0.6"><Placemark><Point><coordinates>1,2</coordinates></Point><w:index>7</w:index><w:index>8</w:index></Placemark></kml>`);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      declaredSequenceText: "7",
      malformed: true
    });
  });

  it("keeps equal duplicate WPML indexes valid", async () => {
    const bytes = await makeKmz({ "waylines.wpml": "<kml xmlns:w=\"http://www.dji.com/wpmz/1.0.6\"><Placemark><Point><coordinates>1,2</coordinates></Point><w:index>7</w:index><w:index>7</w:index></Placemark></kml>" });
    const result = await RouteImporter.ingest("mission.kmz", bytes, limits);
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      declaredSequenceText: "7",
      malformed: false
    });
  });

  it("uses height fallback when coordinate altitude is absent and keeps equal duplicate fields valid", async () => {
    const result = await parse(`<kml xmlns:w="http://www.dji.com/wpmz/1.0.6"><Placemark>
      <Point><coordinates>120,30</coordinates></Point><w:height>42</w:height><w:height>42</w:height>
    </Placemark></kml>`);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      altitudeText: "42",
      altitudeSource: "height",
      malformed: false
    });
  });

  it("keeps the WPML namespace match anchored and rejects a lookalike URI", async () => {
    const result = await parse(`<kml xmlns:w="xhttp://www.dji.com/wpmz/1.0.6"><Placemark><Point><coordinates>1,2</coordinates></Point><w:index>4</w:index></Placemark></kml>`);
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.document.wpmlNamespace).toBeNull();
      expect(result.document.waypointCandidates[0]?.declaredSequenceText).toBeNull();
    }
  });

  it("does not treat the WPML namespace prefix without a version as supported", async () => {
    const result = await parse("<kml xmlns:w=\"http://www.dji.com/wpmz/\"><Placemark><Point><coordinates>1,2</coordinates></Point><w:index>4</w:index></Placemark></kml>");
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.wpmlNamespace).toBeNull();
  });

  it("does not treat the HTTPS WPML namespace prefix without a version as supported", async () => {
    const result = await parse("<kml xmlns:w=\"https://www.dji.com/wpmz/\"><Placemark><Point><coordinates>1,2</coordinates></Point><w:index>4</w:index></Placemark></kml>");
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.document.wpmlNamespace).toBeNull();
      expect(result.document.waypointCandidates[0]?.declaredSequenceText).toBeNull();
    }
  });

  it("ignores an include element from an unrelated namespace", async () => {
    const result = await parse("<kml xmlns:x=\"urn:other\"><x:include href=\"file:///ignored\"/></kml>");
    expect(result.status).toBe("parsed");
  });

  it("ignores non-include elements in the XInclude namespace", async () => {
    const result = await parse("<kml xmlns:xi=\"http://www.w3.org/2001/XInclude\"><xi:fallback/></kml>");
    expect(result.status).toBe("parsed");
  });

  it("ignores WPML fields outside a Placemark", async () => {
    const result = await parse("<kml xmlns:w=\"http://www.dji.com/wpmz/1.0.6\"><w:index>4</w:index><Placemark><Point><coordinates>1,2</coordinates></Point></Placemark></kml>");
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]?.declaredSequenceText).toBeNull();
  });

  it("ignores unsupported WPML fields inside a Placemark", async () => {
    const result = await parse("<kml xmlns:w=\"http://www.dji.com/wpmz/1.0.6\"><Placemark><Point><coordinates>1,2</coordinates></Point><w:other>ignored</w:other></Placemark></kml>");
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      longitudeText: "1",
      altitudeText: null,
      altitudeSource: "missing",
      malformed: false
    });
  });

  it("does not let a nested element end coordinate capture early", async () => {
    const result = await parse("<kml xmlns:x=\"urn:other\"><LineString><coordinates>1,<x:gap/>2</coordinates></LineString></kml>");
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      longitudeText: "1",
      latitudeText: "2",
      malformed: false
    });
  });

  it("does not let a same-local-name nested element end coordinate capture early", async () => {
    const result = await parse("<kml xmlns:x=\"urn:other\"><LineString><coordinates>1,<x:coordinates/>2</coordinates></LineString></kml>");
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      longitudeText: "1",
      latitudeText: "2",
      malformed: false
    });
  });

  it("does not let nested KML coordinates replace an active coordinate capture", async () => {
    const result = await parse("<kml><LineString><coordinates>1,<coordinates/>2</coordinates></LineString></kml>");
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      longitudeText: "1",
      latitudeText: "2",
      malformed: false
    });
  });

  it("does not let nested Point coordinates replace an active coordinate capture", async () => {
    const result = await parse("<kml><Placemark><Point><coordinates>1,<coordinates/>2</coordinates></Point></Placemark></kml>");
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      longitudeText: "1",
      latitudeText: "2",
      malformed: false
    });
  });

  it("does not let a nested element end a WPML field capture early", async () => {
    const result = await parse("<kml xmlns:w=\"http://www.dji.com/wpmz/1.0.6\" xmlns:x=\"urn:other\"><Placemark><Point><coordinates>1,2</coordinates></Point><w:height>4<x:gap/>2</w:height></Placemark></kml>");
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      altitudeText: "42",
      altitudeSource: "height"
    });
  });

  it("does not let a same-local-name nested element end a WPML field capture early", async () => {
    const result = await parse("<kml xmlns:w=\"http://www.dji.com/wpmz/1.0.6\" xmlns:x=\"urn:other\"><Placemark><Point><coordinates>1,2</coordinates></Point><w:height>4<x:height/>2</w:height></Placemark></kml>");
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      altitudeText: "42",
      altitudeSource: "height"
    });
  });

  it("does not let a nested WPML field replace an active field capture", async () => {
    const result = await parse("<kml xmlns:w=\"http://www.dji.com/wpmz/1.0.6\"><Placemark><Point><coordinates>1,2</coordinates></Point><w:height>4<w:height/>2</w:height></Placemark></kml>");
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      altitudeText: "42",
      altitudeSource: "height"
    });
  });

  it("keeps WPML index text out of ordinary KML candidates", async () => {
    const result = await parse("<kml xmlns:w=\"http://www.dji.com/wpmz/1.0.6\"><Placemark><Point><coordinates>1,2</coordinates></Point><w:index>7</w:index></Placemark></kml>");
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]?.declaredSequenceText).toBeNull();
  });

  it("does not create an ordinary KML candidate for a blank Point", async () => {
    const result = await parse("<kml><Placemark><Point><coordinates> </coordinates></Point></Placemark></kml>");
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates).toEqual([]);
  });

  it("uses an arbitrary prefix for WPML fields and preserves document order", async () => {
    const parsed = await parseWpml(`<kml xmlns:q="https://www.dji.com/wpmz/1.0.7"><Placemark><Point><coordinates>1,2</coordinates></Point><q:index>9</q:index></Placemark>
      <Placemark><Point><coordinates>3,4</coordinates></Point><q:index>2</q:index></Placemark></kml>`);
    expect(parsed).toMatchObject({ status: "parsed", document: { wpmlNamespace: "https://www.dji.com/wpmz/1.0.7" } });
    if (parsed.status === "parsed") expect(parsed.document.waypointCandidates.map((candidate) => candidate.declaredSequenceText)).toEqual(["9", "2"]);
  });

  it("accepts exactly the waypoint limit and rejects only the next candidate", async () => {
    const exact = await parse("<kml><LineString><coordinates>1,1 2,2</coordinates></LineString></kml>", { maxWaypoints: 2 });
    const overflow = await parse("<kml><LineString><coordinates>1,1 2,2 3,3</coordinates></LineString></kml>", { maxWaypoints: 2 });
    expect(exact.status).toBe("parsed");
    expect(overflow).toMatchObject({ status: "rejected", error: { code: "TOO_MANY_WAYPOINTS" } });
  });

  it("applies the same exact limit to WPML Placemark candidates", async () => {
    const one = await parseWpml("<kml><Placemark><Point><coordinates>1,1</coordinates></Point></Placemark></kml>", { maxWaypoints: 1 });
    const two = await parseWpml("<kml><Placemark><Point><coordinates>1,1</coordinates></Point></Placemark><Placemark><Point><coordinates>2,2</coordinates></Point></Placemark></kml>", { maxWaypoints: 1 });
    expect(one).toMatchObject({ status: "parsed", document: { waypointCandidates: [{ longitudeText: "1" }] } });
    expect(two).toMatchObject({ status: "rejected", error: { code: "TOO_MANY_WAYPOINTS" } });
  });

  it("does not leak Point depth into following coordinates", async () => {
    const result = await parse(`<kml><Placemark><Point><coordinates>1,1</coordinates></Point><coordinates>2,2</coordinates></Placemark></kml>`);
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.document.waypointCandidates.map((candidate) => candidate.longitudeText)).toEqual(["1"]);
      expect(result.document.waypointCandidates[0]?.malformed).toBe(false);
    }
  });

  it("marks a Point with multiple coordinate elements malformed", async () => {
    const result = await parse("<kml><Placemark><Point><coordinates>1,1</coordinates><coordinates>2,2</coordinates></Point></Placemark></kml>");
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]?.malformed).toBe(true);
  });

  it("marks an empty and non-empty coordinate element pair malformed", async () => {
    const result = await parse("<kml><Placemark><Point><coordinates> </coordinates><coordinates>2,2</coordinates></Point></Placemark></kml>");
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      longitudeText: "2",
      malformed: true
    });
  });

  it("marks a Point containing multiple coordinate tuples malformed", async () => {
    const result = await parse("<kml><Placemark><Point><coordinates>1,1 2,2</coordinates></Point></Placemark></kml>");
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      longitudeText: "1",
      malformed: true
    });
  });

  it("extracts WPML Points only and keeps missing coordinates malformed", async () => {
    const result = await parseWpml(`<kml xmlns:w="http://www.dji.com/wpmz/1.0.6"><LineString><coordinates>8,8</coordinates></LineString>
      <Placemark><w:index>1</w:index></Placemark><Placemark><Point><coordinates>2,3</coordinates></Point><w:index>0</w:index></Placemark></kml>`);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.document.waypointCandidates).toHaveLength(2);
      expect(result.document.waypointCandidates[0]).toMatchObject({
        longitudeText: null,
        malformed: true,
        declaredSequenceText: "1",
        rawSummary: ""
      });
      expect(result.document.waypointCandidates[1]).toMatchObject({ longitudeText: "2", declaredSequenceText: "0" });
    }
  });

  it("ignores WPML LineString coordinates without consuming the waypoint limit", async () => {
    const bytes = await makeKmz({ "waylines.wpml": "<kml><LineString><coordinates>8,8 9,9</coordinates></LineString><Placemark><Point><coordinates>2,3</coordinates></Point></Placemark></kml>" });
    const result = await RouteImporter.ingest(
      "mission.kmz",
      bytes,
      { ...limits, maxWaypoints: 1 }
    );

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates.map((candidate) => candidate.longitudeText)).toEqual(["2"]);
  });

  it("uses height fallback when coordinate altitude is absent and keeps equal duplicate fields valid", async () => {
    const result = await parse(`<kml xmlns:w="http://www.dji.com/wpmz/1.0.6"><Placemark>
      <Point><coordinates>120,30</coordinates></Point><w:height>42</w:height><w:height>42</w:height>
    </Placemark></kml>`);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      altitudeText: "42",
      altitudeSource: "height",
      malformed: false
    });
  });

  it("keeps a nonblank malformed tuple instead of silently deleting it", async () => {
    const result = await parse("<kml><Placemark><LineString><coordinates>120,,50</coordinates></LineString></Placemark></kml>");

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.document.waypointCandidates[0]).toMatchObject({
        longitudeText: "120",
        latitudeText: null,
        altitudeText: "50",
        malformed: true
      });
    }
  });

  it("keeps coordinates located in the middle of a multi-chunk XML document", async () => {
    const result = await parse(`<kml><LineString><coordinates>${" ".repeat(10_000)}123,45${" ".repeat(60_000)}</coordinates></LineString></kml>`);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.document.waypointCandidates).toMatchObject([{ longitudeText: "123", latitudeText: "45" }]);
    }
  });

  it("parses coordinate tuples delivered as CDATA", async () => {
    const result = await parse("<kml><LineString><coordinates><![CDATA[1,2 3,4]]></coordinates></LineString></kml>");

    expect(result).toMatchObject({
      status: "parsed",
      document: { waypointCandidates: [{ longitudeText: "1" }, { longitudeText: "3" }] }
    });
  });

  it("preserves a UTF-8 code point split across decoder chunks", async () => {
    const prefix = "<kml><!--";
    const filler = "x".repeat(64 * 1024 - 1 - prefix.length);
    const result = await parse(`${prefix}${filler}中--></kml>`);

    expect(result.status).toBe("parsed");
  });

  it("rejects an incomplete final UTF-8 code point during decoder flush", async () => {
    const prefix = utf8("<kml/>");
    const bytes = new Uint8Array(prefix.byteLength + 1);
    bytes.set(prefix);
    bytes[prefix.byteLength] = 0xe4;

    expect(await parse(bytes)).toMatchObject({
      status: "rejected",
      error: { code: "INVALID_XML", details: { phase: "xml-decoding" } }
    });
  });

  it("accepts UTF-16LE XML with a BOM", async () => {
    const result = await parse(utf16le("<?xml version=\"1.0\" encoding=\"UTF-16\"?><kml><Document/></kml>"));

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates).toEqual([]);
  });

  it("rejects a UTF-16 document declaring UTF-8", async () => {
    const result = await parse(utf16le("<?xml version=\"1.0\" encoding=\"UTF-8\"?><kml/>") );
    expect(result).toMatchObject({
      status: "rejected",
      error: { code: "INVALID_XML", details: { phase: "xml-encoding" } }
    });
  });

  it("accepts UTF-8 BOM, UTF-16BE, and UTF-16 without a BOM", async () => {
    const utf8Result = await parse(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("<kml/>")]));
    const utf16beResult = await parse(utf16be("<?xml version=\"1.0\" encoding=\"UTF-16\"?><kml/>") );
    const noBom = new Uint8Array(utf16le("<kml/>").slice(2));
    const noBomResult = await parse(noBom);

    expect(utf8Result.status).toBe("parsed");
    expect(utf16beResult.status).toBe("parsed");
    expect(noBomResult.status).toBe("parsed");
  });

  it("detects no-BOM UTF-16 after legal leading XML whitespace", async () => {
    const xml = " \t\r\n<kml><Placemark><Point><coordinates>1,2</coordinates></Point></Placemark></kml>";
    const littleEndian = await parse(utf16WithoutBom(xml, true));
    const bigEndian = await parse(utf16WithoutBom(xml, false));

    expect(littleEndian).toMatchObject({ status: "parsed", document: { waypointCandidates: [{ longitudeText: "1" }] } });
    expect(bigEndian).toMatchObject({ status: "parsed", document: { waypointCandidates: [{ longitudeText: "1" }] } });
  });

  it("rejects invalid UTF-8 after an XML signature", async () => {
    const result = await parse(new Uint8Array([0xef, 0xbb, 0xbf, 0xc3, 0x28]));
    expect(result).toMatchObject({
      status: "rejected",
      error: { code: "INVALID_XML", details: { phase: "xml-decoding" } }
    });
  });

  it("marks duplicate and oversized semantic fields as malformed", async () => {
    const longHeight = "1".repeat(161);
    const result = await parse(`<kml xmlns:w="http://www.dji.com/wpmz/1.0.6"><Placemark><Point><coordinates>1,2</coordinates></Point><w:height>1</w:height><w:height>2</w:height><w:executeHeight>${longHeight}</w:executeHeight></Placemark></kml>`);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({ malformed: true, altitudeText: longHeight.slice(0, 160) });
  });

  it("removes C1 controls from captured semantic text", async () => {
    const result = await parseWpml("<kml xmlns:w=\"http://www.dji.com/wpmz/1.0.6\"><Placemark><Point><coordinates>1,2</coordinates></Point><w:height>4\u00852</w:height></Placemark></kml>");
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      altitudeText: "42",
      malformed: false
    });
  });

  it("removes XML whitespace and both C1 endpoints from fields and summaries", async () => {
    const result = await parseWpml("<kml xmlns:w=\"http://www.dji.com/wpmz/1.0.6\"><Placemark><Point><coordinates>1,\u007f2\u009f</coordinates></Point><w:height>4\t\r\n\u007f\u009f2</w:height></Placemark></kml>");

    expect(result).toMatchObject({
      status: "parsed",
      document: {
        waypointCandidates: [{
          latitudeText: "2",
          altitudeText: "42",
          rawSummary: "1,2"
        }]
      }
    });
  });

  it("trims non-XML Unicode whitespace at field edges and preserves it internally", async () => {
    const result = await parseWpml("<kml xmlns:w=\"http://www.dji.com/wpmz/1.0.6\"><Placemark><Point><coordinates>1,2</coordinates></Point><w:height>\u00a0\u00a04\u00a02\u00a0</w:height></Placemark></kml>");

    expect(result).toMatchObject({
      status: "parsed",
      document: { waypointCandidates: [{ altitudeText: "4\u00a02", malformed: false }] }
    });
  });

  it("bounds internal Unicode whitespace and marks following significant text truncated", async () => {
    const prefix = "7".repeat(159);
    const result = await parseWpml(`<kml xmlns:w="http://www.dji.com/wpmz/1.0.6"><Placemark><Point><coordinates>1,2</coordinates></Point>
      <w:height>${prefix}\u00a08</w:height></Placemark></kml>`);

    expect(result).toMatchObject({
      status: "parsed",
      document: { waypointCandidates: [{ altitudeText: `${prefix}\u00a0`, malformed: true }] }
    });
  });

  it("marks a duplicate height malformed when only the later value is truncated", async () => {
    const exact = "7".repeat(160);
    const result = await parseWpml(`<kml xmlns:w="http://www.dji.com/wpmz/1.0.6"><Placemark><Point><coordinates>1,2</coordinates></Point>
      <w:height>${exact}</w:height><w:height>${exact}8</w:height></Placemark></kml>`);

    expect(result).toMatchObject({
      status: "parsed",
      document: { waypointCandidates: [{ altitudeText: exact, altitudeSource: "height", malformed: true }] }
    });
  });

  it("keeps exactly 160 code points and truncates only the 161st", async () => {
    const exact = "7".repeat(160);
    const over = `${exact}8`;
    const result = await parse(`<kml xmlns:w="http://www.dji.com/wpmz/1.0.6"><Placemark><Point><coordinates> 1,2 </coordinates></Point><w:height>${exact}</w:height><w:executeHeight>${over}</w:executeHeight></Placemark></kml>`);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      altitudeText: over.slice(0, 160),
      altitudeSource: "execute-height",
      malformed: true,
      rawSummary: "1,2"
    });
  });

  it("does not mark an exactly 160-code-point height malformed", async () => {
    const exact = "7".repeat(160);
    const result = await parse(`<kml xmlns:w="http://www.dji.com/wpmz/1.0.6"><Placemark><Point><coordinates>1,2</coordinates></Point><w:height>${exact}</w:height></Placemark></kml>`);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      altitudeText: exact,
      altitudeSource: "height",
      malformed: false
    });
  });

  it("does not count trailing Unicode whitespace beyond 160 code points as truncation", async () => {
    const exact = "7".repeat(160);
    const result = await parseWpml(`<kml xmlns:w="http://www.dji.com/wpmz/1.0.6"><Placemark><Point><coordinates>1,2</coordinates></Point>
      <w:height>${exact}\u00a0\u00a0</w:height></Placemark></kml>`);

    expect(result).toMatchObject({
      status: "parsed",
      document: { waypointCandidates: [{ altitudeText: exact, malformed: false }] }
    });
  });

  it.each([
    ["1", true],
    ["1,2,3,4", true],
    ["   ", false]
  ])("preserves coordinate tuple shape", async (coordinates, malformed) => {
    const result = await parse(`<kml><LineString><coordinates>${coordinates}</coordinates></LineString></kml>`);
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      if (coordinates.trim().length === 0) expect(result.document.waypointCandidates).toHaveLength(0);
      else expect(result.document.waypointCandidates[0]?.malformed).toBe(malformed);
    }
  });

  it("keeps an empty longitude as a malformed candidate", async () => {
    const result = await parse("<kml><LineString><coordinates>,2</coordinates></LineString></kml>");
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates[0]).toMatchObject({
      longitudeText: null,
      latitudeText: "2",
      malformed: true
    });
  });

  it("bounds a tuple with more than four comma-separated components", async () => {
    const result = await parse("<kml><LineString><coordinates>1,2,3,4,5</coordinates></LineString></kml>");

    expect(result).toMatchObject({
      status: "parsed",
      document: {
        waypointCandidates: [{
          longitudeText: "1",
          latitudeText: "2",
          altitudeText: "3",
          malformed: true,
          rawSummary: "1,2,3,4,5"
        }]
      }
    });
  });

  it("bounds raw coordinate summaries to 160 code points", async () => {
    const coordinates = `1,${"2".repeat(200)}`;
    const result = await parse(`<kml><LineString><coordinates>${coordinates}</coordinates></LineString></kml>`);

    expect(result).toMatchObject({
      status: "parsed",
      document: {
        waypointCandidates: [{
          latitudeText: "2".repeat(160),
          malformed: true,
          rawSummary: [...coordinates].slice(0, 160).join("")
        }]
      }
    });
  });

  it("splits coordinate tuples on all XML whitespace characters", async () => {
    const result = await parse("<kml><LineString><coordinates>1,1\t  \n3,3</coordinates></LineString></kml>");
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates.map((candidate) => candidate.longitudeText)).toEqual(["1", "3"]);
  });

  it.each([" ", "\t", "\r", "\n"])("splits coordinate tuples on the XML whitespace %j", async (separator) => {
    const result = await parse(`<kml><LineString><coordinates>1,1${separator}2,2</coordinates></LineString></kml>`);

    expect(result).toMatchObject({
      status: "parsed",
      document: { waypointCandidates: [{ longitudeText: "1" }, { longitudeText: "2" }] }
    });
  });

  it("splits coordinate tuples on a carriage-return character reference", async () => {
    const result = await parse("<kml><LineString><coordinates>1,2&#13;3,4</coordinates></LineString></kml>");

    expect(result).toMatchObject({
      status: "parsed",
      document: { waypointCandidates: [{ longitudeText: "1" }, { longitudeText: "3" }] }
    });
  });

  it("does not treat non-XML Unicode whitespace as a coordinate tuple separator", async () => {
    const result = await parse("<kml><Placemark><Point><coordinates>1,2\u00a03,4</coordinates></Point></Placemark></kml>");

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.document.waypointCandidates).toHaveLength(1);
      expect(result.document.waypointCandidates[0]).toMatchObject({
        longitudeText: "1",
        latitudeText: "2\u00a03",
        altitudeText: "4"
      });
    }
  });

  it.each([
    "C:\\Users\\pilot\\mission,30",
    "\\\\server\\share\\mission,30",
    "/home/pilot/mission,30"
  ])("redacts an absolute path from a raw coordinate summary", async (coordinates) => {
    const result = await parse(`<kml><Placemark><Point><coordinates>${coordinates}</coordinates></Point></Placemark></kml>`);

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(result.document.waypointCandidates[0]?.rawSummary).toBe("[redacted]");
    }
  });

  it("does not redact a drive-like substring that is not an absolute path token", async () => {
    const coordinates = "xC:\\relative,30";
    const result = await parse(`<kml><Placemark><Point><coordinates>${coordinates}</coordinates></Point></Placemark></kml>`);

    expect(result).toMatchObject({
      status: "parsed",
      document: { waypointCandidates: [{ rawSummary: coordinates }] }
    });
  });

  it.each([
    ["<!DOCTYPE kml><kml/>", "EXTERNAL_ENTITY_FORBIDDEN", "xml-doctype"],
    ["<kml xmlns:xi=\"http://www.w3.org/2001/XInclude\"><xi:include href=\"file:///secret\"/></kml>", "EXTERNAL_ENTITY_FORBIDDEN", "xml-xinclude"],
    ["<not-kml/>", "INVALID_XML", "xml-root"],
    ["<kml><Document></kml>", "INVALID_XML", "xml-syntax"]
  ])("rejects unsafe or invalid XML with a stable error", async (xml, code, phase) => {
    const result = await parse(xml);

    expect(result).toMatchObject({ status: "rejected", error: { code, details: { phase } } });
  });

  it("rejects the first candidate beyond maxWaypoints", async () => {
    const result = await parse(
      "<kml><Placemark><LineString><coordinates>1,1 2,2 3,3</coordinates></LineString></Placemark></kml>",
      { maxWaypoints: 2 }
    );

    expect(result).toMatchObject({ status: "rejected", error: { code: "TOO_MANY_WAYPOINTS" } });
  });

  it("rejects ordinary KML Point fallback overflow after parsing the document", async () => {
    const result = await parse(`<kml>
      <Placemark><Point><coordinates>1,1</coordinates></Point></Placemark>
      <Placemark><Point><coordinates>2,2</coordinates></Point></Placemark>
    </kml>`, { maxWaypoints: 1 });
    expect(result).toMatchObject({ status: "rejected", error: { code: "TOO_MANY_WAYPOINTS" } });
  });
});
