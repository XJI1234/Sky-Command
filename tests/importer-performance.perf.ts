import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { RouteImporter, type RouteImportLimits } from "../src/modules/route-library/importer/index.js";

const limits: RouteImportLimits = Object.freeze({
  maxFileBytes: 16 * 1024 * 1024,
  maxArchiveEntries: 100,
  maxExpandedBytes: 32 * 1024 * 1024,
  maxWaypoints: 100_000
});

function largeKml(count: number): Uint8Array {
  const coordinates = Array.from({ length: count }, (_, index) => `${120 + index / 1_000_000},30.2,50`).join(" ");
  return new TextEncoder().encode(`<kml><Placemark><LineString><coordinates>${coordinates}</coordinates></LineString></Placemark></kml>`);
}

describe("D3.2 route importer performance", () => {
  it("parses 100,000 candidates with linear work and rejects the next one", async () => {
    const bytes = largeKml(100_000);
    const startedAt = performance.now();
    const parsed = await RouteImporter.ingest("large.kml", bytes, limits);
    const duration = performance.now() - startedAt;

    expect(parsed.status).toBe("parsed");
    if (parsed.status === "parsed") expect(parsed.document.waypointCandidates).toHaveLength(100_000);
    expect(duration).toBeLessThan(10_000);

    const rejected = await RouteImporter.ingest("too-many.kml", largeKml(100_001), limits);
    expect(rejected).toMatchObject({ status: "rejected", error: { code: "TOO_MANY_WAYPOINTS" } });
  }, 30_000);

  it("lets an independent timer run while processing a large XML document", async () => {
    let timerRan = false;
    const timer = setTimeout(() => { timerRan = true; }, 0);
    const result = await RouteImporter.ingest("yield.kml", largeKml(20_000), limits);
    clearTimeout(timer);

    expect(result.status).toBe("parsed");
    expect(timerRan).toBe(true);
  }, 20_000);

  it("parses 200,000 candidates without an argument-spreading overflow", async () => {
    const expandedLimits = Object.freeze({ ...limits, maxWaypoints: 200_000 });
    const startedAt = performance.now();
    const result = await RouteImporter.ingest("very-large.kml", largeKml(200_000), expandedLimits);
    const duration = performance.now() - startedAt;

    expect(result.status).toBe("parsed");
    if (result.status === "parsed") expect(result.document.waypointCandidates).toHaveLength(200_000);
    expect(duration).toBeLessThan(20_000);
  }, 30_000);
});
