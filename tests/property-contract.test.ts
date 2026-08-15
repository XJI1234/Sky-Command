import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  createQualifiedRoute,
  createRouteId,
  createWaypoint,
  type RouteWaypoint
} from "../src/modules/route-library/domain/index.js";

const SEED = 20260809;

describe("domain properties", () => {
  it("accepts every finite in-range coordinate", () => {
    fc.assert(fc.property(
      fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true }),
      fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true }),
      (longitude, latitude) => {
        expect(createWaypoint({ longitude, latitude, altitude: null, sequence: 0 }).ok).toBe(true);
      }
    ), { seed: SEED });
  });

  it("rejects every finite out-of-range longitude", () => {
    const outside = fc.oneof(
      fc.double({ min: 180.00000000000003, max: Number.MAX_VALUE, noNaN: true, noDefaultInfinity: true }),
      fc.double({ min: -Number.MAX_VALUE, max: -180.00000000000003, noNaN: true, noDefaultInfinity: true })
    );
    fc.assert(fc.property(outside, (longitude) => {
      expect(createWaypoint({ longitude, latitude: 0, altitude: 0, sequence: 0 }).ok).toBe(false);
    }), { seed: SEED });
  });

  it("rejects every finite out-of-range latitude", () => {
    const outside = fc.oneof(
      fc.double({ min: 90.00000000000001, max: Number.MAX_VALUE, noNaN: true, noDefaultInfinity: true }),
      fc.double({ min: -Number.MAX_VALUE, max: -90.00000000000001, noNaN: true, noDefaultInfinity: true })
    );
    fc.assert(fc.property(outside, (latitude) => {
      expect(createWaypoint({ longitude: 0, latitude, altitude: 0, sequence: 0 }).ok).toBe(false);
    }), { seed: SEED });
  });

  it("accepts every non-negative safe sequence", () => {
    fc.assert(fc.property(fc.maxSafeNat(), (sequence) => {
      expect(createWaypoint({ longitude: 0, latitude: 0, altitude: 0, sequence }).ok).toBe(true);
    }), { seed: SEED });
  });

  it("round-trips every valid RouteId", () => {
    const first = fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789");
    const rest = fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-");
    const ids = fc.tuple(first, fc.array(rest, { maxLength: 127 })).map(([head, tail]) => head + tail.join(""));
    fc.assert(fc.property(ids, (id) => {
      expect(createRouteId(id)).toEqual({ ok: true, value: id });
    }), { seed: SEED });
  });

  it("never constructs an invalid RouteId", () => {
    const pattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
    fc.assert(fc.property(fc.string({ maxLength: 140 }).filter((value) => !pattern.test(value)), (value) => {
      expect(createRouteId(value).ok).toBe(false);
    }), { seed: SEED });
  });

  it("accepts waypoint sequences only when they are contiguous from zero", () => {
    fc.assert(fc.property(
      fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 2, maxLength: 12 }),
      (sequences) => {
        const waypoints = sequences.map((sequence, index) => {
          const result = createWaypoint({ longitude: index, latitude: index, altitude: 1, sequence });
          if (!result.ok) throw new Error(result.error.code);
          return result.value;
        }) as RouteWaypoint[];
        const result = createQualifiedRoute({
          displayName: "property.kmz",
          format: "kmz",
          classification: "upload-candidate",
          sourceDocument: "wpmz/waylines.wpml",
          waypoints,
          warnings: [],
          sha256: "a".repeat(64),
          sizeBytes: 1,
          originalBytes: new Uint8Array([1])
        });
        expect(result.ok).toBe(sequences.every((sequence, index) => sequence === index));
      }
    ), { seed: SEED });
  });
});
