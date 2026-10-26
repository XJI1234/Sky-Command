/** Display-only state. It never selects a mission, sends a command or predicts flight. */
export interface AircraftPosition {
  readonly deviceId: string;
  readonly connectionEpoch: number;
  readonly label: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly altitudeMeters: number | null;
  readonly headingDegrees: number | null;
  readonly sampleId: string | null;
  readonly updatedAtMs: number | null;
  readonly status: "live" | "stale" | "disconnected" | "unknown";
  readonly selected: boolean;
}

const read = (value: unknown, key: string): unknown => value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value) ? value : null;
const timestamp = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

export function createAircraftPositionTracker() {
  const lastKnown = new Map<string, AircraftPosition>();
  return {
    update(snapshot: unknown, selectedDeviceId: string | null, nowMs: number, label: (id: string) => string = (id) => id): readonly AircraftPosition[] {
      const listed = read(snapshot, "devices");
      const devices = Array.isArray(listed) ? listed : [];
      const connected = new Set<string>();
      const onlineDevices = new Set<string>();
      for (const device of devices) {
        const deviceId = text(read(device, "deviceId"));
        if (deviceId === null) continue;
        const connection = read(device, "connection");
        const online = read(connection, "relay") === "online" && read(connection, "flightController") === "connected";
        if (!online) continue;
        onlineDevices.add(deviceId);
        const epoch = timestamp(read(device, "connectionEpoch")) ?? 0;
        const pose = read(connection, "pose");
        const navigation = read(connection, "navigation");
        const latitude = finite(read(pose, "latitude"));
        const longitude = finite(read(pose, "longitude"));
        const gps = read(navigation, "gpsIsValid");
        if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || gps === false || (latitude === 0 && longitude === 0 && gps !== true)) continue;
        connected.add(deviceId);
        const sampleId = text(read(navigation, "positionSampleId"));
        const sourceAge = timestamp(read(navigation, "positionAgeMillis"));
        const receivedAt = timestamp(read(connection, "telemetryReceivedAtMs"));
        const previous = lastKnown.get(deviceId);
        const sameSample = previous?.sampleId === sampleId && previous.connectionEpoch === epoch && sampleId !== null;
        // Keep the first anchor for this sample: repeated telemetry must not rejuvenate it.
        const updatedAtMs = sameSample ? previous.updatedAtMs : sampleId !== null && sourceAge !== null && receivedAt !== null && receivedAt <= nowMs && sourceAge <= receivedAt ? receivedAt - sourceAge : null;
        const heading = finite(read(navigation, "headingDegrees"));
        lastKnown.set(deviceId, Object.freeze({
          deviceId, connectionEpoch: epoch, label: text(label(deviceId)) ?? deviceId,
          latitude: sameSample ? previous.latitude : latitude,
          longitude: sameSample ? previous.longitude : longitude,
          altitudeMeters: finite(read(pose, "altitudeMeters")),
          headingDegrees: heading !== null && heading >= 0 && heading < 360 ? heading : null,
          sampleId, updatedAtMs,
          status: updatedAtMs === null ? "unknown" : nowMs < updatedAtMs || nowMs - updatedAtMs > 5_000 ? "stale" : "live",
          selected: selectedDeviceId === deviceId,
        }));
      }
      for (const [id, previous] of lastKnown) {
        if (!connected.has(id)) lastKnown.set(id, Object.freeze({ ...previous, headingDegrees: null, status: onlineDevices.has(id) ? "stale" : "disconnected", selected: id === selectedDeviceId }));
      }
      // Bounded display history; it is cleared by reload and is not a flight log.
      while (lastKnown.size > 128) lastKnown.delete(lastKnown.keys().next().value!);
      return Object.freeze([...lastKnown.values()]);
    },
  };
}

/** Cesium billboard rotation is counter-clockwise; browser screen Y points down. */
export const screenHeadingRotation = (dx: number, dy: number): number => Math.atan2(-dx, -dy);
