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
const lowBatteryRthStates = ["IDLE", "COUNTING_DOWN", "EXECUTED", "CANCELLED", "UNKNOWN"] as const;
const lowBatteryRthState = (value: unknown): typeof lowBatteryRthStates[number] | "unknown" => typeof value === "string" && lowBatteryRthStates.includes(value as typeof lowBatteryRthStates[number]) ? value as typeof lowBatteryRthStates[number] : "unknown";
const missionExecutionStates = ["NOT_STARTED", "STARTING", "EXECUTING", "PAUSED", "STOPPING", "FINISHED", "FAILED"] as const;
const missionDjiExecutionStates = ["IDLE", "READY", "UPLOADING", "PREPARING", "RECOVERING", "ENTER_WAYLINE", "EXECUTING", "PAUSED", "INTERRUPTED", "FINISHED", "RETURN_TO_START_POINT", "DISCONNECTED", "NOT_SUPPORTED", "UNKNOWN"] as const;
const missionExecutionState = (value: unknown): typeof missionExecutionStates[number] | null => typeof value === "string" && missionExecutionStates.includes(value as typeof missionExecutionStates[number]) ? value as typeof missionExecutionStates[number] : null;
const missionDjiExecutionState = (value: unknown): typeof missionDjiExecutionStates[number] | null => typeof value === "string" && missionDjiExecutionStates.includes(value as typeof missionDjiExecutionStates[number]) ? value as typeof missionDjiExecutionStates[number] : null;
const cameraFrameStates = ["UNAVAILABLE", "UNOBSERVED", "RECEIVING", "STALLED"] as const;
const cameraFrameState = (value: unknown): "unavailable" | "unobserved" | "receiving" | "stalled" | "unknown" => {
  if (typeof value !== "string" || !cameraFrameStates.includes(value as typeof cameraFrameStates[number])) return "unknown";
  return value.toLowerCase() as "unavailable" | "unobserved" | "receiving" | "stalled";
};
const cameraFrameCodec = (value: unknown): "H264" | "H265" | "UNKNOWN" | null =>
  value === "H264" || value === "H265" || value === "UNKNOWN" ? value : null;
const landingPhase = (intent: unknown, connection: RecordValue): "idle" | "awaiting-msdk" | "confirmation-required" | "confirmed-grounded" | "state-unknown" | "stopped" => {
  if (intent !== "requested" && intent !== "stopped") return "idle";
  if (intent === "stopped") return "stopped";
  if (read(connection, "flightController") !== "connected") return "state-unknown";
  const flightState = read(connection, "flightState");
  const motorsOn = read(connection, "motorsOn");
  if ((flightState !== "flying" && flightState !== "grounded") || (motorsOn !== true && motorsOn !== false)) return "state-unknown";
  if (flightState === "grounded" && motorsOn === false) return "confirmed-grounded";
  if (read(connection, "landingConfirmationNeeded") === true) return "confirmation-required";
  return "awaiting-msdk";
};
const poseNumber = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const safeText = (value: unknown, maximumCodePoints = 128): string | null => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= maximumCodePoints && !/[\p{Cc}]/u.test(value) ? value : null;
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
  const notice = safeText(read(payload, "liveStreamNotice"), 256);
  const runtimeErrorCode = safeText(read(payload, "liveStreamRuntimeErrorCode"), 128);
  const runtimeErrorDescription = safeText(read(payload, "liveStreamRuntimeErrorDescription"), 512);
  const runtimeError = runtimeErrorCode !== null && runtimeErrorDescription !== null
    ? freeze({ code: runtimeErrorCode, description: runtimeErrorDescription })
    : null;
  if (streaming !== true) return freeze({ streaming: streaming === false ? false : null, notice, runtimeError, resolution: null, fps: null, videoBitrateKbps: null, rttMillis: null, packetLoss: null, packetCacheLength: null });
  return freeze({
    streaming: true,
    notice,
    runtimeError,
    resolution: safeText(read(payload, "liveResolution")),
    fps: boundedNumber(read(payload, "liveFps"), 0, 240),
    videoBitrateKbps: boundedNumber(read(payload, "liveVideoBitrateKbps"), 0, 100_000),
    rttMillis: boundedInteger(read(payload, "liveRttMillis"), 0, 60_000),
    packetLoss: boundedInteger(read(payload, "livePacketLoss"), 0, 2_147_483_647),
    packetCacheLength: boundedInteger(read(payload, "livePacketCacheLength"), 0, 2_147_483_647),
  });
};
const cameraFrames = (payload: unknown) => {
  const receivedFrameCount = boundedInteger(read(payload, "cameraFrameCount"), 0, Number.MAX_SAFE_INTEGER) ?? 0;
  const observed = receivedFrameCount > 0;
  return freeze({
    generation: boundedInteger(read(payload, "cameraFrameGeneration"), 0, Number.MAX_SAFE_INTEGER) ?? 0,
    state: cameraFrameState(read(payload, "cameraFrameState")),
    receivedFrameCount,
    lastFrameAgeMillis: observed ? boundedInteger(read(payload, "cameraFrameLastAgeMillis"), 0, Number.MAX_SAFE_INTEGER) : null,
    codec: observed ? cameraFrameCodec(read(payload, "cameraFrameCodec")) : null,
    width: observed ? boundedInteger(read(payload, "cameraFrameWidth"), 1, 16_384) : null,
    height: observed ? boundedInteger(read(payload, "cameraFrameHeight"), 1, 16_384) : null,
    frameRate: observed ? boundedInteger(read(payload, "cameraFrameRate"), 1, 240) : null,
  });
};
const mediaService = (media: unknown, name: "rtmpIngest" | "httpFlv") => {
  const phase = read(read(media, name), "phase");
  return freeze({ phase: phase === "idle" || phase === "listening" || phase === "failed" ? phase : "unknown" as const });
};
const mediaPlayer = (media: unknown) => {
  const player = read(media, "player");
  const phase = read(player, "phase");
  return freeze({
    phase: phase === "idle" || phase === "playing" || phase === "failed" ? phase : "unknown" as const,
    deviceId: safeText(read(player, "deviceId")),
  });
};
const connection = (payload: unknown, telemetryReceivedAtMs: unknown) => {
  const flightController = linkState(read(payload, "flightController"));
  const flightFactsAvailable = flightController !== "disconnected";
  const battery = linkState(read(payload, "battery"));
  const rthState = flightFactsAvailable ? lowBatteryRthState(read(payload, "lowBatteryRthState")) : "unknown";
  return freeze({
    relay: "online" as const,
    telemetryReceivedAtMs: boundedInteger(telemetryReceivedAtMs, 0, Number.MAX_SAFE_INTEGER),
    sdk: state(read(payload, "sdkRegistered"), "ready", "not-ready"),
    msdk: msdkState(read(payload, "sdkAvailability")),
    remoteController: linkState(read(payload, "remoteController")),
    flightController,
    battery,
    airLink: linkState(read(payload, "airLink")),
    camera: linkState(read(payload, "camera")),
    aircraftModel: safeText(read(payload, "aircraftModel")),
    remoteControllerModel: safeText(read(payload, "remoteControllerModel")),
    batteryPercent: battery === "connected" ? boundedInteger(read(payload, "batteryPercent"), 0, 100) : null,
    flightState: flightFactsAvailable ? state(read(payload, "isFlying"), "flying", "grounded") : "unknown",
    motorsOn: flightFactsAvailable && typeof read(payload, "motorsOn") === "boolean" ? read(payload, "motorsOn") as boolean : null,
    flightMode: flightFactsAvailable ? safeText(read(payload, "flightMode")) : null,
    gpsSignalLevel: flightFactsAvailable ? safeText(read(payload, "gpsSignalLevel")) : null,
    gpsSatelliteCount: flightFactsAvailable ? boundedInteger(read(payload, "gpsSatelliteCount"), 0, Number.MAX_SAFE_INTEGER) : null,
    visionSensorUsed: flightFactsAvailable && typeof read(payload, "visionSensorUsed") === "boolean" ? read(payload, "visionSensorUsed") as boolean : null,
    visionSystemWarning: flightFactsAvailable ? safeText(read(payload, "visionSystemWarning")) : null,
    visionPositioningEnabled: flightFactsAvailable && typeof read(payload, "visionPositioningEnabled") === "boolean" ? read(payload, "visionPositioningEnabled") as boolean : null,
    landingProtectionState: flightFactsAvailable ? safeText(read(payload, "landingProtectionState")) : null,
    landingConfirmationNeeded: flightFactsAvailable && typeof read(payload, "landingConfirmationNeeded") === "boolean" ? read(payload, "landingConfirmationNeeded") as boolean : null,
    takeoffFailureError: flightFactsAvailable ? safeText(read(payload, "takeoffFailureError")) : null,
    motorStartFailureError: flightFactsAvailable ? safeText(read(payload, "motorStartFailureError")) : null,
    lowBatteryRthState: rthState,
    remainingFlightTimeSeconds: rthState === "unknown" || rthState === "UNKNOWN" ? null : boundedInteger(read(payload, "remainingFlightTimeSeconds"), 1, 86_400),
    pairingState: pairingState(read(payload, "pairing")),
    missionRevision: boundedInteger(read(payload, "missionRevision"), 1, Number.MAX_SAFE_INTEGER),
    missionDeviceGeneration: boundedInteger(read(payload, "missionDeviceGeneration"), 0, Number.MAX_SAFE_INTEGER),
    missionExecution: missionExecutionState(read(payload, "missionExecution")),
    missionDjiExecutionState: missionDjiExecutionState(read(payload, "missionDjiExecutionState")),
    missionUploadProgress: boundedInteger(read(payload, "missionUploadProgress"), 0, 100),
    missionFileName: safeText(read(payload, "missionFileName")),
    waylineExecutingMissionFileName: safeText(read(payload, "waylineExecutingMissionFileName")),
    waylineId: boundedInteger(read(payload, "waylineId"), 0, 10_000),
    currentWaypointIndex: boundedInteger(read(payload, "currentWaypointIndex"), 0, 100_000),
    waypointActionGroup: boundedInteger(read(payload, "waypointActionGroup"), 0, 100_000),
    waypointActionId: boundedInteger(read(payload, "waypointActionId"), 0, 100_000),
    waypointActionPhase: read(payload, "waypointActionPhase") === "START" || read(payload, "waypointActionPhase") === "FINISH" ? read(payload, "waypointActionPhase") as "START" | "FINISH" : null,
    waypointActionErrorCode: safeText(read(payload, "waypointActionErrorCode")),
    waypointActionErrorDescription: safeText(read(payload, "waypointActionErrorDescription"), 512),
    waylineInterruptErrorCode: safeText(read(payload, "waylineInterruptErrorCode")),
    waylineInterruptErrorDescription: safeText(read(payload, "waylineInterruptErrorDescription"), 512),
    pose: flightFactsAvailable ? pose(payload) : null,
    live: live(payload),
    cameraFrames: cameraFrames(payload),
  });
};
const control = (payload: unknown) => freeze({
  sdk: state(read(payload, "sdkRegistered"), "ready", "not-ready"),
  remoteController: linkState(read(payload, "remoteController")),
  flightController: linkState(read(payload, "flightController")),
});

function create(input: Readonly<{ readonly devices: readonly { readonly deviceId: string; readonly connectionEpoch: number; readonly telemetry: unknown; readonly controlTelemetry?: unknown; readonly assignment: unknown; readonly mission: unknown; readonly stream: unknown; readonly settings: unknown; readonly pendingFlightAction: unknown; readonly landingIntent?: unknown }[]; readonly routes: readonly unknown[]; readonly selectedRouteId: string | null; readonly selectedVideoDeviceId: string | null; readonly revision: number; readonly media: unknown; readonly disposed: boolean }>) {
  const streams = read(input.media, "streams");
  const mediaStreams = Array.isArray(streams) ? streams : [];
  const player = mediaPlayer(input.media);
  const devices = input.devices.map((device) => {
    const telemetry = record(device.telemetry);
    const payload = read(telemetry, "payload");
    const capabilities = read(telemetry, "capabilities");
    const stream = mediaStreams.find((item) => read(item, "deviceId") === device.deviceId);
    const mediaPhase = read(stream, "phase");
    const videoPhase = mediaPhase === "awaiting-ingest" || mediaPhase === "awaiting-playback" || mediaPhase === "ready" || mediaPhase === "failed" ? mediaPhase : "unavailable";
    const connectionValue = connection(payload, read(telemetry, "receivedAtMs"));
    return freeze({
      deviceId: device.deviceId,
      // This local counter differentiates reconnects without exposing a relay session ID.
      connectionEpoch: Number.isSafeInteger(device.connectionEpoch) && device.connectionEpoch >= 0 ? device.connectionEpoch : 0,
      connection: connectionValue,
      control: control(read(record(device.controlTelemetry), "payload")),
      capabilities: freeze({ waypointMission: read(capabilities, "waypointMission") === true && read(capabilities, "waypointMissionSupport") === "supported" ? "supported" : read(capabilities, "waypointMission") === false || read(capabilities, "waypointMissionSupport") === "unsupported" ? "unsupported" : "unknown", liveVideo: read(capabilities, "liveVideo") === true ? "supported" : read(capabilities, "liveVideo") === false ? "unsupported" : "unknown" }),
      assignment: device.assignment,
      mission: device.mission,
      stream: device.stream,
      video: freeze({ phase: videoPhase, selected: input.selectedVideoDeviceId === device.deviceId, playerPhase: player.deviceId === device.deviceId ? player.phase : "idle" }),
      settings: device.settings,
      pendingFlightAction: device.pendingFlightAction
      ,landing: freeze({ phase: landingPhase(device.landingIntent, connectionValue) })
    });
  }).sort((left, right) => left.deviceId.localeCompare(right.deviceId));
  const media = freeze({
    rtmpIngest: mediaService(input.media, "rtmpIngest"),
    httpFlv: mediaService(input.media, "httpFlv"),
    player,
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
