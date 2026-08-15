import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  createQualifiedRoute,
  createWaypoint,
  type RouteWaypoint
} from "../src/modules/route-library/domain/index.js";

function buildWaypoints(count: number): RouteWaypoint[] {
  const points = new Array<RouteWaypoint>(count);
  for (let sequence = 0; sequence < count; sequence += 1) {
    const result = createWaypoint({
      longitude: 120 + sequence / 1_000_000,
      latitude: 30 + sequence / 1_000_000,
      altitude: 80,
      sequence
    });
    if (!result.ok) throw new Error(result.error.code);
    points[sequence] = result.value;
  }
  return points;
}

function measureValidation(waypoints: readonly RouteWaypoint[]): number {
  const startedAt = performance.now();
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const result = createQualifiedRoute({
      displayName: "performance.kmz",
      format: "kmz",
      classification: "upload-candidate",
      sourceDocument: "wpmz/waylines.wpml",
      waypoints,
      warnings: [],
      sha256: "a".repeat(64),
      sizeBytes: 1,
      originalBytes: new Uint8Array([1])
    });
    expect(result.ok).toBe(true);
  }
  return performance.now() - startedAt;
}

describe("large route performance", () => {
  it("keeps validation growth linear through 100,000 waypoints", () => {
    const all = buildWaypoints(100_000);
    measureValidation(all.slice(0, 1_000));
    const halfDuration = measureValidation(all.slice(0, 50_000));
    const fullDuration = measureValidation(all);

    // Doubling input may vary under CI load, but must remain far below quadratic growth.
    expect(fullDuration / Math.max(halfDuration, 0.01)).toBeLessThan(6);
  }, 20_000);
});
