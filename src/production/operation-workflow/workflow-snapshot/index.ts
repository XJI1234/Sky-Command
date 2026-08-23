type RecordValue = Record<string, unknown>;
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const record = (value: unknown): RecordValue | null => value !== null && typeof value === "object" ? value as RecordValue : null;
const read = (value: unknown, key: string): unknown => { try { return record(value)?.[key]; } catch { return undefined; } };
const state = (value: unknown, yes: string, no: string): string => value === true ? yes : value === false ? no : "unknown";
const pairingStates = ["UNKNOWN", "IDLE", "PAIRING", "PAIRED", "STOPPING", "FAILED"] as const;
const pairingState = (value: unknown): string => typeof value === "string" && pairingStates.includes(value as typeof pairingStates[number]) ? value : "unknown";
const poseNumber = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const pose = (payload: unknown): Readonly<{ readonly latitude: number | null; readonly longitude: number | null; readonly altitudeMeters: number | null }> | null => {
  const latitude = poseNumber(read(payload, "latitude"));
  const longitude = poseNumber(read(payload, "longitude"));
  const altitudeMeters = poseNumber(read(payload, "altitudeMeters"));
  const coordinates = latitude !== null && longitude !== null && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
  if (!coordinates && altitudeMeters === null) return null;
  return freeze({ latitude: coordinates ? latitude : null, longitude: coordinates ? longitude : null, altitudeMeters });
};

function create(input: Readonly<{ readonly devices: readonly { readonly deviceId: string; readonly telemetry: unknown; readonly assignment: unknown; readonly mission: unknown; readonly stream: unknown; readonly whipStream?: unknown; readonly settings: unknown; readonly pendingFlightAction: unknown }[]; readonly routes: readonly unknown[]; readonly selectedRouteId: string | null; readonly selectedVideoDeviceId: string | null; readonly revision: number; readonly media: unknown; readonly disposed: boolean }>) {
  const streams = read(input.media, "streams");
  const mediaStreams = Array.isArray(streams) ? streams : [];
  const devices = input.devices.map((device) => {
    const telemetry = record(device.telemetry);
    const payload = read(telemetry, "payload");
    const capabilities = read(telemetry, "capabilities");
    const stream = mediaStreams.find((item) => read(item, "deviceId") === device.deviceId);
    const mediaPhase = read(stream, "phase");
    const videoPhase = mediaPhase === "awaiting-ingest" || mediaPhase === "awaiting-playlist" || mediaPhase === "ready" || mediaPhase === "failed" ? mediaPhase : "unavailable";
    return freeze({
      deviceId: device.deviceId,
      connection: freeze({ relay: "online" as const, sdk: state(read(payload, "sdkRegistered"), "ready", "not-ready"), remoteController: state(read(payload, "remoteControllerConnected"), "connected", "disconnected"), flightController: state(read(payload, "flightControllerConnected"), "connected", "disconnected"), aircraft: state(read(payload, "connected"), "connected", "disconnected"), batteryPercent: typeof read(payload, "batteryPercent") === "number" ? read(payload, "batteryPercent") as number : null, flightState: state(read(payload, "isFlying"), "flying", "grounded"), pairingState: pairingState(read(payload, "pairingState")), pose: pose(payload) }),
      capabilities: freeze({ waypointMission: read(capabilities, "waypointMission") === true && read(capabilities, "waypointMissionSupport") === "supported" ? "supported" : read(capabilities, "waypointMission") === false || read(capabilities, "waypointMissionSupport") === "unsupported" ? "unsupported" : "unknown", liveVideo: read(capabilities, "liveVideo") === true ? "supported" : read(capabilities, "liveVideo") === false ? "unsupported" : "unknown" }),
      assignment: device.assignment,
      mission: device.mission,
      stream: device.stream,
      whipStream: device.whipStream ?? freeze({ deviceId: device.deviceId, phase: "idle", lastOperation: null, failureCode: null, reason: null }),
      video: freeze({ phase: videoPhase, selected: input.selectedVideoDeviceId === device.deviceId }),
      settings: device.settings,
      pendingFlightAction: device.pendingFlightAction
    });
  }).sort((left, right) => left.deviceId.localeCompare(right.deviceId));
  return freeze({ phase: input.disposed ? "disposed" as const : "ready" as const, selectedRouteId: input.selectedRouteId, routes: freeze([...input.routes]), devices: freeze(devices), selectedVideoDeviceId: input.selectedVideoDeviceId, revision: input.revision });
}

export const WorkflowSnapshot = freeze({ create });
