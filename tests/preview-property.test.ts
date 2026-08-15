import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { RoutePreviewModel } from "../src/modules/route-library/preview/index.js";

const coordinate = fc.double({ noNaN: true, noDefaultInfinity: true });
const altitude = fc.option(coordinate, { nil: null });
const waypoint = fc.record({ longitude: coordinate, latitude: coordinate, altitude });

describe("D3.5 preview model properties", () => {
  it("preserves every generated point and derives exact bounds", () => {
    fc.assert(fc.property(fc.array(waypoint, { minLength: 2, maxLength: 80 }), (rawWaypoints) => {
      const waypoints = rawWaypoints.map((point, sequence) => ({ ...point, sequence }));
      const result = RoutePreviewModel.createPreview({ routeId: "random-route", waypoints } as never);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.polyline).toEqual(rawWaypoints);
      expect(result.value.startMarker).toEqual(rawWaypoints[0]);
      expect(result.value.endMarker).toEqual(rawWaypoints.at(-1));
      expect(result.value.cameraBounds.minLongitude).toBe(Math.min(...rawWaypoints.map((point) => point.longitude)));
      expect(result.value.cameraBounds.maxLongitude).toBe(Math.max(...rawWaypoints.map((point) => point.longitude)));
      expect(result.value.cameraBounds.minLatitude).toBe(Math.min(...rawWaypoints.map((point) => point.latitude)));
      expect(result.value.cameraBounds.maxLatitude).toBe(Math.max(...rawWaypoints.map((point) => point.latitude)));

      if (rawWaypoints.some((point) => point.altitude === null)) {
        expect(result.value.cameraBounds.minAltitude).toBeNull();
        expect(result.value.cameraBounds.maxAltitude).toBeNull();
      } else {
        const numericAltitudes = rawWaypoints.map((point) => point.altitude as number);
        expect(result.value.cameraBounds.minAltitude).toBe(Math.min(...numericAltitudes));
        expect(result.value.cameraBounds.maxAltitude).toBe(Math.max(...numericAltitudes));
      }
    }), { numRuns: 100 });
  });
});
