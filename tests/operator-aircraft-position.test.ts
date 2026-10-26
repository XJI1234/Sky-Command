import { describe, expect, it } from "vitest";
import { createAircraftPositionTracker, screenHeadingRotation } from "../src/production/operator-console/renderer/aircraft-position.js";
import { WorkflowSnapshot } from "../src/production/operation-workflow/workflow-snapshot/index.js";
import { RelayOperationsAdapter } from "../src/production/relay-operations-adapter/index.js";
import { jsonFields } from "../sdk/src/json.js";

function device(id = "mini-1", sample = "observer:1", receivedAt = 10_000, age = 200) {
  return { deviceId: id, connectionEpoch: 1, connection: {
    relay: "online", flightController: "connected", telemetryReceivedAtMs: receivedAt,
    pose: { latitude: 31.2, longitude: 121.5, altitudeMeters: 35 },
    navigation: { positionSampleId: sample, positionAgeMillis: age, headingDegrees: 90, gpsIsValid: true },
  } };
}

describe("aircraft map position state", () => {
  it("uses source age and never rejuvenates a repeated location after battery telemetry", () => {
    const tracker = createAircraftPositionTracker();
    expect(tracker.update({ devices: [device()] }, null, 10_000)[0]).toMatchObject({ updatedAtMs: 9_800, status: "live" });
    const same = device("mini-1", "observer:1", 16_000, 6_200);
    same.connection.pose.altitudeMeters = 40;
    expect(tracker.update({ devices: [same] }, null, 16_000)[0]).toMatchObject({ updatedAtMs: 9_800, status: "stale", altitudeMeters: 40 });
    // Even a replay reporting age zero must retain the first sample anchor.
    expect(tracker.update({ devices: [device("mini-1", "observer:1", 17_000, 0)] }, null, 17_000)[0]?.status).toBe("stale");
    expect(tracker.update({ devices: [device("mini-1", "observer:2", 17_000, 0)] }, null, 17_000)[0]?.status).toBe("live");
  });

  it("keeps a stationary aircraft fresh when a genuinely new sample has equal coordinates", () => {
    const tracker = createAircraftPositionTracker();
    tracker.update({ devices: [device()] }, null, 10_000);
    const updated = tracker.update({ devices: [device("mini-1", "observer:2", 20_000, 100)] }, null, 20_000)[0];
    expect(updated).toMatchObject({ latitude: 31.2, longitude: 121.5, updatedAtMs: 19_900, status: "live" });
  });

  it("keeps multiple aircraft and highlights only the existing selected mission device", () => {
    const input = { devices: [device(), device("mini-2", "other:1")] };
    const before = JSON.stringify(input);
    const items = createAircraftPositionTracker().update(input, "mini-2", 10_000);
    expect(items.map((item) => item.selected)).toEqual([false, true]);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(items)).toBe(true);
    expect(Object.isFrozen(items[0])).toBe(true);
  });

  it("retains the last position through disconnect and waits for a fresh reconnect sample", () => {
    const tracker = createAircraftPositionTracker();
    tracker.update({ devices: [device()] }, null, 10_000);
    expect(tracker.update({ devices: [] }, null, 10_001)[0]).toMatchObject({ status: "disconnected", headingDegrees: null });
    const next = device("mini-1", "new-observer:1", 20_000, 0); next.connectionEpoch = 2;
    expect(tracker.update({ devices: [next] }, null, 20_000)[0]).toMatchObject({ status: "live", connectionEpoch: 2 });
  });

  it("does not generate a marker from missing, invalid or placeholder GPS", () => {
    const tracker = createAircraftPositionTracker();
    const invalid = device(); invalid.connection.pose.latitude = Number.NaN;
    expect(tracker.update({ devices: [invalid] }, null, 10_000)).toEqual([]);
    const badGps = device(); badGps.connection.navigation.gpsIsValid = false;
    expect(tracker.update({ devices: [badGps] }, null, 10_000)).toEqual([]);
    const zero = device(); zero.connection.pose.latitude = 0; zero.connection.pose.longitude = 0;
    const legacy = { ...zero, connection: { ...zero.connection, navigation: undefined } };
    expect(tracker.update({ devices: [legacy] }, null, 10_000)).toEqual([]);
  });

  it("marks unavailable GPS stale without falsely reporting a disconnected phone", () => {
    const tracker = createAircraftPositionTracker(); tracker.update({ devices: [device()] }, null, 10_000);
    const invalid = device(); invalid.connection.navigation.gpsIsValid = false;
    expect(tracker.update({ devices: [invalid] }, null, 10_010)[0]).toMatchObject({ status: "stale", latitude: 31.2, headingDegrees: null });
  });

  it("shows legacy coordinates with unknown freshness and never invents north", () => {
    const legacy = device();
    const item = { ...legacy, connection: { ...legacy.connection, navigation: undefined } };
    expect(createAircraftPositionTracker().update({ devices: [item] }, null, 10_000)[0]).toMatchObject({ status: "unknown", updatedAtMs: null, headingDegrees: null });
  });

  it("handles malformed heading, delayed telemetry and backward clock changes", () => {
    const bad = device("mini-1", "observer:1", 10_000, 6_000); bad.connection.navigation.headingDegrees = 360;
    const tracker = createAircraftPositionTracker();
    expect(tracker.update({ devices: [bad] }, null, 10_000)[0]).toMatchObject({ status: "stale", headingDegrees: null });
    expect(tracker.update({ devices: [device()] }, null, 2_000)[0]?.status).toBe("stale");
  });

  it("projects north/east/south/west correctly after camera screen projection", () => {
    expect(screenHeadingRotation(0, -1)).toBeCloseTo(0);
    expect(screenHeadingRotation(1, 0)).toBeCloseTo(-Math.PI / 2);
    expect(Math.abs(screenHeadingRotation(0, 1))).toBeCloseTo(Math.PI);
    expect(screenHeadingRotation(-1, 0)).toBeCloseTo(Math.PI / 2);
  });
});

describe("workflow navigation projection", () => {
  it("carries navigation across the production relay whitelist and rejects malformed values", () => {
    let payload: Record<string, unknown> = { headingDegrees: 270, positionSampleId: "observer:1", positionAgeMillis: 350,
      gpsIsValid: true, locationAltitudeMeters: 35, takeoffAltitudeMeters: 80 };
    const adapter = RelayOperationsAdapter.create({ relay: {
      devices: () => [{ deviceId: "mini-1", sessionId: "s1" }],
      latestTelemetry: () => ({ sessionId: "s1", payload: { kind: "object", fields: jsonFields(payload) }, capabilities: { kind: "object", fields: {} } }),
    } });
    expect(adapter.telemetry("mini-1")?.payload).toMatchObject(payload);
    payload = { headingDegrees: 360, positionSampleId: "bad\n", positionAgeMillis: -1, gpsIsValid: "yes", locationAltitudeMeters: "35", takeoffAltitudeMeters: "80" };
    const result = adapter.telemetry("mini-1")?.payload;
    for (const key of Object.keys(payload)) expect(result?.[key]).toBeUndefined();
    adapter.dispose();
  });
  it("preserves optional navigation without interpreting raw height as ellipsoid height", () => {
    const input = { devices: [{ deviceId: "mini-1", connectionEpoch: 1, telemetry: { receivedAtMs: 10_000,
      payload: { flightController: "CONNECTED", latitude: 31.2, longitude: 121.5, altitudeMeters: 35,
        headingDegrees: 270, positionSampleId: "observer:1", positionAgeMillis: 200, gpsIsValid: true,
        locationAltitudeMeters: 35, takeoffAltitudeMeters: 80 } },
      assignment: null, mission: null, stream: null, settings: null, pendingFlightAction: null }],
      routes: [], selectedRouteId: null, selectedVideoDeviceId: null, revision: 1, media: null, disposed: false };
    const navigation = WorkflowSnapshot.create(input).devices[0]!.connection.navigation;
    expect(navigation).toMatchObject({ headingDegrees: 270, positionSampleId: "observer:1", positionAgeMillis: 200, heightReference: "unknown" });
    input.devices[0]!.telemetry.payload.flightController = "DISCONNECTED";
    expect(WorkflowSnapshot.create(input).devices[0]!.connection.navigation).toBeNull();
  });
});
