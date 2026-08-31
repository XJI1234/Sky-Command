type RecordValue = Record<string, unknown>;
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const record = (value: unknown): RecordValue | null => value !== null && typeof value === "object" ? value as RecordValue : null;
const read = (value: unknown, key: string): unknown => { try { return record(value)?.[key]; } catch { return undefined; } };
const state = (value: unknown, yes: string, no: string): string => value === true ? yes : value === false ? no : "unknown";
const linkState = (value: unknown): "connected" | "disconnected" | "unknown" => {
  if (value === "CONNECTED") return "connected";
  if (value === "DISCONNECTED") return "disconnected";
  return "unknown";
};
const msdkState = (value: unknown): "stopped" | "starting" | "ready" | "failed" | "unknown" => {
  if (value === "STOPPED") return "stopped";
  if (value === "STARTING") return "starting";
  if (value === "READY") return "ready";
  if (value === "FAILED") return "failed";
  return "unknown";
};
const pairingStates = ["UNKNOWN", "IDLE", "PAIRING", "PAIRED", "STOPPING", "FAILED"] as const;
const pairingState = (value: unknown): string => typeof value === "string" && pairingStates.includes(value as typeof pairingStates[number]) ? value : "unknown";
const lowBatteryRthStates = ["IDLE", "COUNTING_DOWN", "EXECUTED", "CANCELLED"] as const;
const lowBatteryRthState = (value: unknown): typeof lowBatteryRthStates[number] | "unknown" => typeof value === "string" && lowBatteryRthStates.includes(value as typeof lowBatteryRthStates[number]) ? value as typeof lowBatteryRthStates[number] : "unknown";
const poseNumber = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const safeText = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value) ? value : null;
const boundedInteger = (value: unknown, minimum: number, maximum: number): number | null => typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
const boundedNumber = (value: unknown, minimum: number, maximum: number): number | null => typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
const pose = (payload: unknown): Readonly<{ readonly latitude: number | null; readonly longitude: number | null; readonly altitudeMeters: number | null }> | null => {
  const latitude = poseNumber(read(payload, "latitude"));
  const longitude = poseNumber(read(payload, "longitude"));
  const altitudeMeters = poseNumber(read(payload, "altitudeMeters"));
  const coordinates = latitude !== null && longitude !== null && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
  if (!coordinates && altitudeMeters === null) return null;
  return freeze({ latitude: coordinates ? latitude : null, longitude: coordinates ? longitude : null, altitudeMeters });
};
const live = (payload: unknown) => {
  const streaming = read(payload, "liveStreaming");
  if (streaming !== true) return freeze({ streaming: streaming === false ? false : null, resolution: null, fps: null, videoBitrateKbps: null, rttMillis: null });
  return freeze({
    streaming: true,
    resolution: safeText(read(payload, "liveResolution")),
    fps: boundedNumber(read(payload, "liveFps"), 0, 240),
    videoBitrateKbps: boundedNumber(read(payload, "liveVideoBitrateKbps"), 0, 100_000),
    rttMillis: boundedInteger(read(payload, "liveRttMillis"), 0, 60_000),
  });
};
const connection = (payload: unknown, telemetryReceivedAtMs: unknown) => {
  const flightController = linkState(read(payload, "flightController"));
  const flightFactsAvailable = flightController !== "disconnected";
  const rthState = flightFactsAvailable ? lowBatteryRthState(read(payload, "lowBatteryRthState")) : "unknown";
  return freeze({
    relay: "online" as const,
    telemetryReceivedAtMs: boundedInteger(telemetryReceivedAtMs, 0, Number.MAX_SAFE_INTEGER),
    sdk: state(read(payload, "sdkRegistered"), "ready", "not-ready"),
    msdk: msdkState(read(payload, "sdkAvailability")),
    remoteController: linkState(read(payload, "remoteController")),
    flightController,
    aircraft: linkState(read(payload, "aircraft")),
    aircraftModel: safeText(read(payload, "aircraftModel")),
    remoteControllerModel: safeText(read(payload, "remoteControllerModel")),
    batteryPercent: flightFactsAvailable ? boundedInteger(read(payload, "batteryPercent"), 0, 100) : null,
    flightState: flightFactsAvailable ? state(read(payload, "isFlying"), "flying", "grounded") : "unknown",
    motorsOn: flightFactsAvailable && typeof read(payload, "motorsOn") === "boolean" ? read(payload, "motorsOn") as boolean : null,
    flightMode: flightFactsAvailable ? safeText(read(payload, "flightMode")) : null,
    lowBatteryRthState: rthState,
    remainingFlightTimeSeconds: rthState === "unknown" ? null : boundedInteger(read(payload, "remainingFlightTimeSeconds"), 1, 86_400),
    pairingState: pairingState(read(payload, "pairing")),
    pose: flightFactsAvailable ? pose(payload) : null,
    live: live(payload),
  });
};
const control = (payload: unknown) => freeze({
  sdk: state(read(payload, "sdkRegistered"), "ready", "not-ready"),
  remoteController: linkState(read(payload, "remoteController")),
  flightController: linkState(read(payload, "flightController")),
  aircraft: linkState(read(payload, "aircraft")),
});

function create(input: Readonly<{ readonly devices: readonly { readonly deviceId: string; readonly telemetry: unknown; readonly controlTelemetry?: unknown; readonly assignment: unknown; readonly mission: unknown; readonly stream: unknown; readonly settings: unknown; readonly pendingFlightAction: unknown }[]; readonly routes: readonly unknown[]; readonly selectedRouteId: string | null; readonly selectedVideoDeviceId: string | null; readonly revision: number; readonly media: unknown; readonly disposed: boolean }>) {
  const streams = read(input.media, "streams");
  const mediaStreams = Array.isArray(streams) ? streams : [];
  const devices = input.devices.map((device) => {
    const telemetry = record(device.telemetry);
    const payload = read(telemetry, "payload");
    const capabilities = read(telemetry, "capabilities");
    const stream = mediaStreams.find((item) => read(item, "deviceId") === device.deviceId);
    const mediaPhase = read(stream, "phase");
    const videoPhase = mediaPhase === "awaiting-ingest" || mediaPhase === "awaiting-playback" || mediaPhase === "ready" || mediaPhase === "failed" ? mediaPhase : "unavailable";
    return freeze({
      deviceId: device.deviceId,
      connection: connection(payload, read(telemetry, "receivedAtMs")),
      control: control(read(record(device.controlTelemetry), "payload")),
      capabilities: freeze({ waypointMission: read(capabilities, "waypointMission") === true && read(capabilities, "waypointMissionSupport") === "supported" ? "supported" : read(capabilities, "waypointMission") === false || read(capabilities, "waypointMissionSupport") === "unsupported" ? "unsupported" : "unknown", liveVideo: read(capabilities, "liveVideo") === true ? "supported" : read(capabilities, "liveVideo") === false ? "unsupported" : "unknown" }),
      assignment: device.assignment,
      mission: device.mission,
      stream: device.stream,
      video: freeze({ phase: videoPhase, selected: input.selectedVideoDeviceId === device.deviceId }),
      settings: device.settings,
      pendingFlightAction: device.pendingFlightAction
    });
  }).sort((left, right) => left.deviceId.localeCompare(right.deviceId));
  const media = freeze({
    streams: freeze(mediaStreams.flatMap((item) => {
      const deviceId = read(item, "deviceId");
      const phase = read(item, "phase");
      if (typeof deviceId !== "string" || typeof phase !== "string") return [];
      const playbackUrl = read(item, "playbackUrl");
      return [freeze({
        deviceId,
        phase,
        playbackUrl: typeof playbackUrl === "string" ? playbackUrl : null,
      })];
    })),
  });
  return freeze({ phase: input.disposed ? "disposed" as const : "ready" as const, selectedRouteId: input.selectedRouteId, routes: freeze([...input.routes]), devices: freeze(devices), selectedVideoDeviceId: input.selectedVideoDeviceId, revision: input.revision, media });
}

export const WorkflowSnapshot = freeze({ create });
