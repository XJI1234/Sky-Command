import type { MissionRelayGateway, RelayMissionPayload } from "../../modules/mission-control/mission-dispatcher/index.js";
import type { PairingRelayPort } from "../../modules/device-console/pairing-controller/index.js";
import type { FlightRelay } from "../../modules/flight-control/flight-command-dispatcher/index.js";

type JsonValue = Readonly<{ readonly kind: "null" }>
  | Readonly<{ readonly kind: "string"; readonly value: string }>
  | Readonly<{ readonly kind: "number"; readonly value: string }>
  | Readonly<{ readonly kind: "boolean"; readonly value: boolean }>
  | Readonly<{ readonly kind: "object"; readonly fields: Readonly<Record<string, JsonValue>> }>;

type CommandStatus = "succeeded" | "rejected" | "timed-out" | "disconnected" | "transport-failed";
type MsdkLinkState = "UNKNOWN" | "DISCONNECTED" | "CONNECTED";
type MsdkPairingState = "UNKNOWN" | "IDLE" | "PAIRING" | "PAIRED" | "STOPPING" | "FAILED";

export interface DesktopRelayTelemetryPayload {
  readonly [key: string]: unknown;
  /** Monotonic sequence of actual Android telemetry frames, scoped to the relay session. */
  readonly telemetrySequence?: number;
  readonly sdkAvailability?: "STOPPED" | "STARTING" | "READY" | "FAILED";
  /** Monotonic `DeviceStateStore` revision for the MSDK device Key observation. */
  readonly deviceRevision?: number;
  readonly sdkRegistered?: boolean;
  /** Raw `RemoteControllerKey.KeyConnection` value from Android MSDK telemetry. */
  readonly remoteController?: MsdkLinkState;
  /** Raw `FlightControllerKey.KeyConnection` value from Android MSDK telemetry. */
  readonly flightController?: MsdkLinkState;
  /** Raw `ProductKey.KeyConnection` value from Android MSDK telemetry. */
  readonly aircraft?: MsdkLinkState;
  /** Raw `AirLinkKey.KeyConnection` value from Android MSDK telemetry. */
  readonly airLink?: MsdkLinkState;
  /** Raw `CameraKey.KeyConnection(LEFT_OR_MAIN)` value from Android MSDK telemetry. */
  readonly camera?: MsdkLinkState;
  /** Raw `RemoteControllerKey.KeyPairingStatus` value from Android MSDK telemetry. */
  readonly pairing?: MsdkPairingState;
  /** Compatibility projections for existing control gates. Do not use for device facts. */
  readonly remoteControllerConnected?: boolean;
  readonly flightControllerConnected?: boolean;
  readonly connected?: boolean;
  readonly isFlying?: boolean;
  readonly motorsOn?: boolean;
  readonly batteryPercent?: number;
  readonly aircraftModel?: string;
  readonly remoteControllerModel?: string;
  readonly flightMode?: string;
  readonly lowBatteryRthState?: "IDLE" | "COUNTING_DOWN" | "EXECUTED" | "CANCELLED";
  readonly remainingFlightTimeSeconds?: number;
  /** Compatibility alias for existing callers. Do not use for device facts. */
  readonly pairingState?: MsdkPairingState;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly altitudeMeters?: number;
  readonly liveStreaming?: boolean;
  readonly liveResolution?: string;
  readonly liveFps?: number;
  readonly liveVideoBitrateKbps?: number;
  readonly liveRttMillis?: number;
  /** Raw Android MSDK LiveStreamStatus.packetLoss value; no unit is inferred. */
  readonly livePacketLoss?: number;
  /** Raw Android MSDK LiveStreamStatus.packetCacheLen value; no unit is inferred. */
  readonly livePacketCacheLength?: number;
  readonly missionRevision?: number;
  readonly missionDeviceGeneration?: number;
  readonly missionExecution?: "NOT_STARTED" | "STARTING" | "EXECUTING" | "PAUSED" | "STOPPING" | "FINISHED" | "FAILED";
  readonly missionFileName?: string;
}

export interface DesktopRelayTelemetry {
  readonly deviceId: string;
  /** Desktop-local receipt time of the latest protocol-validated telemetry, never a DJI fact. */
  readonly receivedAtMs: number | null;
  readonly payload: DesktopRelayTelemetryPayload;
  readonly capabilities: Readonly<{
    readonly liveVideo?: boolean;
    readonly waypointMission?: boolean;
    readonly waypointMissionSupport?: "supported" | "unsupported";
  }>;
}

type MutableDesktopRelayTelemetryPayload = { -readonly [Field in keyof DesktopRelayTelemetryPayload]: DesktopRelayTelemetryPayload[Field] };

export interface DesktopRelayDevice { readonly deviceId: string; readonly sessionId?: string; }
export interface RelayOperationsSnapshot {
  readonly devices: readonly DesktopRelayDevice[];
  readonly telemetry: readonly DesktopRelayTelemetry[];
  readonly missionPhases: readonly Readonly<{ readonly deviceId: string; readonly missionRevision: number; readonly deviceGeneration: number; readonly sequence: number; readonly phase: "START_POINT_REACHED" | "ROUTE_EXECUTION_STARTED"; readonly fileName: string }>[];
}
export interface StreamRelayGateway {
  readonly latestTelemetry: (deviceId: string) => DesktopRelayTelemetry | null;
  readonly ingressAddress?: (deviceId: string) => string | null;
  readonly sendCommand: (deviceId: string, request: Readonly<{ readonly name: "live-stream.start" | "live-stream.stop"; readonly fields: Readonly<Record<string, string>> }>) => Promise<Readonly<{ readonly status: CommandStatus; readonly detail?: string }>>;
}
export interface WhipStreamRelayGateway {
  readonly latestTelemetry: (deviceId: string) => DesktopRelayTelemetry | null;
  readonly sendCommand: (deviceId: string, request: Readonly<{ readonly name: "live-stream-webrtc.start" | "live-stream-webrtc.stop"; readonly fields: Readonly<Record<string, string>> }>) => Promise<Readonly<{ readonly status: CommandStatus; readonly detail?: string }>>;
}
export interface AdapterFlightRelay extends FlightRelay {
  readonly latestTelemetry: (deviceId: string) => DesktopRelayTelemetry | null;
  readonly sendCommand: (deviceId: string, request: Readonly<{ readonly name: "flight.takeoff" | "flight.land" | "flight.return-home"; readonly fields: Readonly<{ readonly confirm: true }> }>) => Promise<Readonly<{ readonly status: CommandStatus }>>;
}
export interface RelaySettingsGateway {
  readonly sendCommand: (deviceId: string, request: Readonly<{ readonly name: "device.settings.camera.read" | "device.settings.camera.write" | "device.settings.transmission.read" | "device.settings.transmission.write"; readonly fields: Readonly<Record<string, JsonValue>> }>) => Promise<Readonly<{ readonly status: CommandStatus; readonly detail: string; readonly result?: JsonValue }>>;
}
export interface RelayOperationsAdapterInstance {
  readonly telemetry: (deviceId: string) => DesktopRelayTelemetry | null;
  readonly controlTelemetry: (deviceId: string) => DesktopRelayTelemetry | null;
  readonly devices: () => readonly DesktopRelayDevice[];
  readonly snapshot: () => RelayOperationsSnapshot;
  readonly subscribe: (listener: (snapshot: RelayOperationsSnapshot) => void) => () => void;
  readonly missionGateway: () => MissionRelayGateway;
  readonly streamGateway: () => StreamRelayGateway;
  readonly whipStreamGateway: () => WhipStreamRelayGateway;
  readonly pairingGateway: () => PairingRelayPort;
  readonly flightGateway: () => AdapterFlightRelay;
  readonly settingsGateway: () => RelaySettingsGateway;
  readonly refreshTelemetry: (deviceId: string) => Promise<Readonly<{ readonly status: CommandStatus; readonly result?: JsonValue }>>;
  readonly dispose: () => void;
}

interface RelaySource {
  readonly devices?: () => unknown;
  readonly latestTelemetry?: (deviceId: string) => unknown;
  readonly ingressAddress?: (deviceId: string) => unknown;
  readonly sendMission?: (deviceId: string, payload: RelayMissionPayload) => Promise<unknown>;
  readonly sendCommand?: (deviceId: string, request: Readonly<{ readonly name: string; readonly fields: Readonly<Record<string, JsonValue>> }>) => Promise<unknown>;
  readonly subscribe?: (listener: (snapshot: unknown) => void) => () => void;
}

interface RelayOperationsAdapterOptions {
  readonly relay: unknown;
  readonly now?: () => number;
}

type UnknownRecord = Record<string, unknown>;
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const text = (value: string): JsonValue => freeze({ kind: "string" as const, value });
const bool = (value: boolean): JsonValue => freeze({ kind: "boolean" as const, value });
const object = (fields: Record<string, JsonValue>): Readonly<Record<string, JsonValue>> => freeze({ ...fields });
const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
const privateIpv4 = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/u.test(value)) return false;
  const parts = value.split(".").map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts as [number, number, number, number];
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
};
const validMissionFileName = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && value.toLowerCase().endsWith(".kmz") && !value.includes("..") && !/[\\/\p{Cc}]/u.test(value);
const positiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const nonNegativeInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): UnknownRecord | null => value !== null && typeof value === "object" ? value as UnknownRecord : null;
const read = (value: unknown, key: string): unknown => {
  const source = record(value);
  if (source === null) return undefined;
  try { return source[key]; } catch { return undefined; }
};
const fieldsOf = (value: unknown): UnknownRecord | null => record(value) !== null && read(value, "kind") === "object" ? record(read(value, "fields")) : null;
const string = (value: unknown): string | undefined => read(value, "kind") === "string" && typeof read(value, "value") === "string" ? read(value, "value") as string : undefined;
const boolean = (value: unknown): boolean | undefined => read(value, "kind") === "boolean" && typeof read(value, "value") === "boolean" ? read(value, "value") as boolean : undefined;
const finiteNumber = (value: unknown): number | undefined => {
  if (read(value, "kind") !== "number") return undefined;
  const raw = read(value, "value");
  if (typeof raw !== "string" || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const number = (value: unknown): number | undefined => {
  const parsed = finiteNumber(value);
  return parsed !== undefined && parsed >= 0 && parsed <= 100 ? parsed : undefined;
};
const safeText = (value: unknown): string | undefined => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value) ? value : undefined;
const boundedNumber = (value: unknown, minimum: number, maximum: number): number | undefined => {
  const parsed = finiteNumber(value);
  return parsed !== undefined && parsed >= minimum && parsed <= maximum ? parsed : undefined;
};
const boundedInteger = (value: unknown, minimum: number, maximum: number): number | undefined => {
  const parsed = boundedNumber(value, minimum, maximum);
  return parsed !== undefined && Number.isSafeInteger(parsed) ? parsed : undefined;
};
const positiveIntegerValue = (value: unknown): number | undefined => {
  const parsed = finiteNumber(value);
  return parsed !== undefined && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};
const nonNegativeIntegerValue = (value: unknown): number | undefined => {
  const parsed = finiteNumber(value);
  return parsed !== undefined && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};
const latitude = (value: unknown): number | undefined => {
  const parsed = finiteNumber(value);
  return parsed !== undefined && parsed >= -90 && parsed <= 90 ? parsed : undefined;
};
const longitude = (value: unknown): number | undefined => {
  const parsed = finiteNumber(value);
  return parsed !== undefined && parsed >= -180 && parsed <= 180 ? parsed : undefined;
};
const pairingState = (value: unknown): MsdkPairingState | undefined => {
  const current = string(value);
  return current === "UNKNOWN" || current === "IDLE" || current === "PAIRING" || current === "PAIRED" || current === "STOPPING" || current === "FAILED" ? current : undefined;
};
const sdkAvailability = (value: unknown): "STOPPED" | "STARTING" | "READY" | "FAILED" | undefined => {
  const current = string(value);
  return current === "STOPPED" || current === "STARTING" || current === "READY" || current === "FAILED" ? current : undefined;
};
const msdkLinkState = (value: unknown): MsdkLinkState | undefined => {
  const current = string(value);
  return current === "UNKNOWN" || current === "DISCONNECTED" || current === "CONNECTED" ? current : undefined;
};
const lowBatteryRthState = (value: unknown): "IDLE" | "COUNTING_DOWN" | "EXECUTED" | "CANCELLED" | undefined => {
  const current = string(value);
  return current === "IDLE" || current === "COUNTING_DOWN" || current === "EXECUTED" || current === "CANCELLED" ? current : undefined;
};
const status = (value: unknown): CommandStatus => {
  const current = read(value, "status");
  return current === "succeeded" || current === "rejected" || current === "timed-out" || current === "disconnected" || current === "transport-failed" ? current : "transport-failed";
};
const commandFailure = (): Readonly<{ readonly status: CommandStatus }> => freeze({ status: "rejected" as const });
const commandDetail = (value: unknown): string | undefined => {
  const detail = read(value, "detail");
  return typeof detail === "string" && detail.trim().length > 0 && Array.from(detail).length <= 256 && !/[\p{Cc}]/u.test(detail) ? detail : undefined;
};

function project(deviceId: string, source: unknown): DesktopRelayTelemetry | null {
  const raw = record(source);
  if (raw === null || !validId(deviceId)) return null;
  const payload = fieldsOf(read(raw, "payload"));
  const capabilities = fieldsOf(read(raw, "capabilities"));
  if (payload === null || capabilities === null) return null;
  const outputPayload: MutableDesktopRelayTelemetryPayload = {};
  const outputCapabilities: { liveVideo?: boolean; waypointMission?: boolean; waypointMissionSupport?: "supported" | "unsupported" } = {};
  const telemetrySequence = positiveIntegerValue(payload.telemetrySequence); if (telemetrySequence !== undefined) outputPayload.telemetrySequence = telemetrySequence;
  const deviceRevision = positiveIntegerValue(payload.deviceRevision); if (deviceRevision !== undefined) outputPayload.deviceRevision = deviceRevision;
  const sdk = sdkAvailability(payload.sdkAvailability);
  if (sdk !== undefined) {
    outputPayload.sdkAvailability = sdk;
    outputPayload.sdkRegistered = sdk === "READY";
  }
  const remote = msdkLinkState(payload.remoteController);
  if (remote !== undefined) {
    outputPayload.remoteController = remote;
    if (remote === "CONNECTED") outputPayload.remoteControllerConnected = true;
    else if (remote === "DISCONNECTED") outputPayload.remoteControllerConnected = false;
  }
  const flight = msdkLinkState(payload.flightController);
  if (flight !== undefined) {
    outputPayload.flightController = flight;
    if (flight === "CONNECTED") outputPayload.flightControllerConnected = true;
    else if (flight === "DISCONNECTED") outputPayload.flightControllerConnected = false;
  }
  const aircraft = msdkLinkState(payload.aircraft);
  if (aircraft !== undefined) {
    outputPayload.aircraft = aircraft;
    if (aircraft === "CONNECTED") outputPayload.connected = true;
    else if (aircraft === "DISCONNECTED") outputPayload.connected = false;
  }
  const airLink = msdkLinkState(payload.airLink); if (airLink !== undefined) outputPayload.airLink = airLink;
  const camera = msdkLinkState(payload.camera); if (camera !== undefined) outputPayload.camera = camera;
  const isFlying = boolean(payload.isFlying); if (isFlying !== undefined) outputPayload.isFlying = isFlying;
  const motorsOn = boolean(payload.motorsOn); if (motorsOn !== undefined) outputPayload.motorsOn = motorsOn;
  const batteryPercent = number(payload.batteryPercent); if (batteryPercent !== undefined) outputPayload.batteryPercent = batteryPercent;
  const aircraftModel = safeText(string(payload.aircraftModel)); if (aircraftModel !== undefined) outputPayload.aircraftModel = aircraftModel;
  const remoteControllerModel = safeText(string(payload.remoteControllerModel)); if (remoteControllerModel !== undefined) outputPayload.remoteControllerModel = remoteControllerModel;
  const flightMode = safeText(string(payload.flightMode)); if (flightMode !== undefined) outputPayload.flightMode = flightMode;
  const rthState = lowBatteryRthState(payload.lowBatteryRthState); if (rthState !== undefined) outputPayload.lowBatteryRthState = rthState;
  const remainingFlightTimeSeconds = rthState === undefined ? undefined : boundedInteger(payload.remainingFlightTimeSeconds, 1, 86_400); if (remainingFlightTimeSeconds !== undefined) outputPayload.remainingFlightTimeSeconds = remainingFlightTimeSeconds;
  const pairing = pairingState(payload.pairing);
  if (pairing !== undefined) {
    outputPayload.pairing = pairing;
    outputPayload.pairingState = pairing;
  }
  const latitudeValue = latitude(payload.latitude);
  const longitudeValue = longitude(payload.longitude);
  if (latitudeValue !== undefined && longitudeValue !== undefined) {
    outputPayload.latitude = latitudeValue;
    outputPayload.longitude = longitudeValue;
  }
  const altitudeMeters = finiteNumber(payload.altitudeMeters); if (altitudeMeters !== undefined) outputPayload.altitudeMeters = altitudeMeters;
  const liveStreaming = boolean(payload.liveStreaming);
  if (liveStreaming !== undefined) {
    outputPayload.liveStreaming = liveStreaming;
    if (liveStreaming) {
      const liveResolution = safeText(string(payload.liveResolution)); if (liveResolution !== undefined) outputPayload.liveResolution = liveResolution;
      const liveFps = boundedNumber(payload.liveFps, 0, 240); if (liveFps !== undefined) outputPayload.liveFps = liveFps;
      const liveVideoBitrateKbps = boundedNumber(payload.liveVideoBitrateKbps, 0, 100_000); if (liveVideoBitrateKbps !== undefined) outputPayload.liveVideoBitrateKbps = liveVideoBitrateKbps;
      const liveRttMillis = boundedInteger(payload.liveRttMillis, 0, 60_000); if (liveRttMillis !== undefined) outputPayload.liveRttMillis = liveRttMillis;
      const livePacketLoss = boundedInteger(payload.livePacketLoss, 0, 2_147_483_647); if (livePacketLoss !== undefined) outputPayload.livePacketLoss = livePacketLoss;
      const livePacketCacheLength = boundedInteger(payload.livePacketCacheLength, 0, 2_147_483_647); if (livePacketCacheLength !== undefined) outputPayload.livePacketCacheLength = livePacketCacheLength;
    }
  }
  const missionExecution = string(payload.missionExecution);
  if (missionExecution === "NOT_STARTED" || missionExecution === "STARTING" || missionExecution === "EXECUTING" || missionExecution === "PAUSED" || missionExecution === "STOPPING" || missionExecution === "FINISHED" || missionExecution === "FAILED") outputPayload.missionExecution = missionExecution;
  const missionFileName = string(payload.missionFileName); if (validMissionFileName(missionFileName)) outputPayload.missionFileName = missionFileName;
  const missionRevision = positiveIntegerValue(payload.missionRevision); if (missionRevision !== undefined) outputPayload.missionRevision = missionRevision;
  const missionDeviceGeneration = nonNegativeIntegerValue(payload.missionDeviceGeneration); if (missionDeviceGeneration !== undefined) outputPayload.missionDeviceGeneration = missionDeviceGeneration;
  const liveVideo = boolean(capabilities.liveVideo); if (liveVideo !== undefined) outputCapabilities.liveVideo = liveVideo;
  const waypointMission = boolean(capabilities.waypointMission); if (waypointMission !== undefined) outputCapabilities.waypointMission = waypointMission;
  const support = string(capabilities.waypointMissionSupport); if (support === "SUPPORTED") outputCapabilities.waypointMissionSupport = "supported"; else if (support === "UNSUPPORTED") outputCapabilities.waypointMissionSupport = "unsupported";
  const receivedAtMs = read(raw, "receivedAtMs");
  return freeze({
    deviceId,
    receivedAtMs: typeof receivedAtMs === "number" && Number.isFinite(receivedAtMs) && receivedAtMs >= 0 ? receivedAtMs : null,
    payload: freeze(outputPayload),
    capabilities: freeze(outputCapabilities),
  });
}

function create(options: RelayOperationsAdapterOptions): RelayOperationsAdapterInstance {
  const relay = options.relay as RelaySource;
  const listeners = new Set<(snapshot: RelayOperationsSnapshot) => void>();
  let rawSnapshot: unknown = null;
  let disposed = false;
  type CurrentObservation = Readonly<{ readonly sessionId: string; readonly telemetrySequence: number | null; readonly deviceRevision: number; readonly telemetry: DesktopRelayTelemetry }>;
  const observations = new Map<string, CurrentObservation>();
  const now = (): number | null => {
    try {
      const value = options.now === undefined ? Date.now() : options.now();
      return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
    } catch { return null; }
  };
  type SessionTelemetry = Readonly<{ readonly sessionId: string | null; readonly telemetry: DesktopRelayTelemetry }>;
  const rawTelemetry = (deviceId: string): SessionTelemetry | null => {
    if (disposed || !validId(deviceId) || typeof relay.latestTelemetry !== "function") return null;
    try {
      const source = relay.latestTelemetry(deviceId);
      const telemetry = project(deviceId, source);
      const sourceSessionId = read(source, "sessionId");
      return telemetry === null ? null : freeze({ sessionId: validId(sourceSessionId) ? sourceSessionId : null, telemetry });
    } catch { return null; }
  };
  const devices = (): readonly DesktopRelayDevice[] => {
    if (disposed || typeof relay.devices !== "function") return freeze([]);
    try {
      const source = relay.devices();
      if (!Array.isArray(source)) return freeze([]);
      const unique = new Map<string, string | undefined>();
      for (const item of source) {
        const deviceId = read(item, "deviceId");
        if (!validId(deviceId)) continue;
        const sessionId = read(item, "sessionId");
        unique.set(deviceId, validId(sessionId) ? sessionId : unique.get(deviceId));
      }
      return freeze([...unique].sort(([left], [right]) => left.localeCompare(right)).map(([deviceId, sessionId]) => freeze(sessionId === undefined ? { deviceId } : { deviceId, sessionId })));
    } catch { return freeze([]); }
  };
  const activeSession = (deviceId: string): string | null => {
    const device = devices().find((candidate) => candidate.deviceId === deviceId);
    return device !== undefined && validId(device.sessionId) ? device.sessionId : null;
  };
  const deviceRevisionOf = (telemetry: DesktopRelayTelemetry): number | null => {
    const value = telemetry.payload.deviceRevision;
    return positiveInteger(value) ? value : null;
  };
  const telemetrySequenceOf = (telemetry: DesktopRelayTelemetry): number | null => {
    const value = telemetry.payload.telemetrySequence;
    return positiveInteger(value) ? value : null;
  };
  const completeDeviceFact = (telemetry: DesktopRelayTelemetry): boolean =>
    deviceRevisionOf(telemetry) !== null &&
    telemetry.payload.sdkAvailability !== undefined &&
    telemetry.payload.remoteController !== undefined &&
    telemetry.payload.flightController !== undefined &&
    telemetry.payload.aircraft !== undefined;
  const discardStaleObservations = (): void => {
    for (const [deviceId, observation] of observations) if (activeSession(deviceId) !== observation.sessionId) observations.delete(deviceId);
  };
  const admit = (deviceId: string, sessionId: string, telemetry: DesktopRelayTelemetry): DesktopRelayTelemetry | null => {
    const deviceRevision = deviceRevisionOf(telemetry);
    if (deviceRevision === null || !completeDeviceFact(telemetry)) return null;
    const previous = observations.get(deviceId);
    const telemetrySequence = telemetrySequenceOf(telemetry);
    if (previous !== undefined && previous.sessionId === sessionId) {
      if (previous.telemetrySequence !== null && (telemetrySequence === null || telemetrySequence <= previous.telemetrySequence)) return previous.telemetry;
      if (previous.telemetrySequence === null && telemetrySequence === null && previous.deviceRevision > deviceRevision) return previous.telemetry;
    }
    observations.set(deviceId, freeze({ sessionId, telemetrySequence, deviceRevision, telemetry }));
    return telemetry;
  };
  const currentObservation = (deviceId: string): DesktopRelayTelemetry | null => {
    if (disposed || !validId(deviceId)) return null;
    discardStaleObservations();
    const sessionId = activeSession(deviceId);
    const raw = rawTelemetry(deviceId);
    if (sessionId === null) return raw?.telemetry ?? null;
    if (raw === null) return observations.get(deviceId)?.telemetry ?? null;
    if (raw.sessionId !== sessionId) return null;
    admit(deviceId, sessionId, raw.telemetry);
    return observations.get(deviceId)?.telemetry ?? raw.telemetry;
  };
  const telemetry = (deviceId: string): DesktopRelayTelemetry | null => currentObservation(deviceId);
  const controlTelemetry = (deviceId: string): DesktopRelayTelemetry | null => {
    const current = currentObservation(deviceId);
    return current !== null && completeDeviceFact(current) ? current : null;
  };
  const ingressAddress = (deviceId: string): string | null => {
    if (disposed || !validId(deviceId) || typeof relay.ingressAddress !== "function" || !devices().some((device) => device.deviceId === deviceId)) return null;
    try {
      const value = relay.ingressAddress(deviceId);
      return privateIpv4(value) ? value : null;
    } catch {
      return null;
    }
  };
  const phases = (): RelayOperationsSnapshot["missionPhases"] => {
    const source = read(rawSnapshot, "missionPhases");
    if (!Array.isArray(source)) return freeze([]);
  const values: Readonly<{ readonly deviceId: string; readonly missionRevision: number; readonly deviceGeneration: number; readonly sequence: number; readonly phase: "START_POINT_REACHED" | "ROUTE_EXECUTION_STARTED"; readonly fileName: string }>[] = [];
  for (const item of source) {
      const deviceId = read(item, "deviceId"); const missionRevision = read(item, "missionRevision"); const deviceGeneration = read(item, "deviceGeneration"); const sequence = read(item, "sequence"); const phase = read(item, "phase"); const fileName = read(item, "fileName");
      if (validId(deviceId) && positiveInteger(missionRevision) && nonNegativeInteger(deviceGeneration) && positiveInteger(sequence) && (phase === "START_POINT_REACHED" || phase === "ROUTE_EXECUTION_STARTED") && validMissionFileName(fileName)) values.push(freeze({ deviceId, missionRevision, deviceGeneration, sequence, phase, fileName }));
    }
    return freeze(values);
  };
  const snapshot = (): RelayOperationsSnapshot => freeze({ devices: devices(), telemetry: freeze(devices().flatMap((device) => { const value = telemetry(device.deviceId); return value === null ? [] : [value]; })), missionPhases: phases() });
  const publish = (): void => { if (disposed) return; const value = snapshot(); for (const listener of [...listeners]) { try { listener(value); } catch { /* subscriber faults are isolated */ } } };
  let unsubscribeRelay = (): void => undefined;
  if (typeof relay.subscribe === "function") {
    try { unsubscribeRelay = relay.subscribe((value) => { rawSnapshot = value; discardStaleObservations(); publish(); }); } catch { /* an unavailable relay leaves the adapter offline */ }
  }
  const send = async (deviceId: string, name: string, fields: Record<string, JsonValue>): Promise<Readonly<{ readonly status: CommandStatus; readonly result?: JsonValue }>> => {
    if (disposed || !validId(deviceId) || typeof relay.sendCommand !== "function") return commandFailure();
    try {
      const outcome = await relay.sendCommand(deviceId, freeze({ name, fields: object(fields) }));
      const result = read(outcome, "result");
      return result !== undefined && record(result) !== null && read(result, "kind") === "object"
        ? freeze({ status: status(outcome), result: result as JsonValue })
        : freeze({ status: status(outcome) });
    } catch { return freeze({ status: "transport-failed" as const }); }
  };
  const sendVideo = async (deviceId: string, name: string, fields: Record<string, JsonValue>): Promise<Readonly<{ readonly status: CommandStatus; readonly detail?: string }>> => {
    if (disposed || !validId(deviceId) || typeof relay.sendCommand !== "function") return commandFailure();
    try {
      const outcome = await relay.sendCommand(deviceId, freeze({ name, fields: object(fields) }));
      const detail = commandDetail(outcome);
      return freeze({ status: status(outcome), ...(detail === undefined ? {} : { detail }) });
    } catch { return freeze({ status: "transport-failed" as const }); }
  };
  const missionGateway: MissionRelayGateway = freeze({
    latestTelemetry: controlTelemetry,
    sendMission: async (deviceId, payload) => {
      if (disposed || !validId(deviceId) || typeof relay.sendMission !== "function") return freeze({ deviceId, missionId: payload.missionId, status: "rejected" as const, detail: "设备未连接" });
      try { const value = await relay.sendMission(deviceId, payload); return freeze({ deviceId, missionId: payload.missionId, status: status(value), detail: typeof read(value, "detail") === "string" ? read(value, "detail") as string : "中继器未确认任务" }); } catch { return freeze({ deviceId, missionId: payload.missionId, status: "transport-failed" as const, detail: "中继器通信失败" }); }
    },
    sendCommand: async (deviceId, request) => {
      const outcome = (request.name === "wayline.upload" || request.name === "wayline.start" || request.name === "wayline.pause" || request.name === "wayline.resume" || request.name === "wayline.stop") && request.fields.confirm === true
        ? await send(deviceId, request.name, { confirm: bool(true) })
        : commandFailure();
      return freeze({ deviceId, commandId: "adapter", status: outcome.status, detail: outcome.status === "succeeded" ? "中继器已确认命令" : "中继器未确认命令" });
    }
  });
  const streamGateway: StreamRelayGateway = freeze({
    latestTelemetry: controlTelemetry,
    ingressAddress,
    sendCommand: async (deviceId, request) => {
      if (request.name === "live-stream.stop" && Object.keys(request.fields).length === 0) return sendVideo(deviceId, request.name, {});
      if (request.name !== "live-stream.start" || Object.keys(request.fields).length !== 1 || typeof request.fields.rtmpUrl !== "string" || request.fields.rtmpUrl.trim().length === 0) return commandFailure();
      return sendVideo(deviceId, request.name, { rtmpUrl: text(request.fields.rtmpUrl) });
    }
  });
  const whipStreamGateway: WhipStreamRelayGateway = freeze({
    latestTelemetry: controlTelemetry,
    sendCommand: async (deviceId, request) => {
      if (request.name === "live-stream-webrtc.stop" && Object.keys(request.fields).length === 0) return sendVideo(deviceId, request.name, {});
      if (request.name !== "live-stream-webrtc.start" || Object.keys(request.fields).length !== 1 || typeof request.fields.whipUrl !== "string" || request.fields.whipUrl.trim().length === 0 || /[\p{Cc}]/u.test(request.fields.whipUrl)) return commandFailure();
      return sendVideo(deviceId, request.name, { whipUrl: text(request.fields.whipUrl) });
    },
  });
  const pairingGateway: PairingRelayPort = freeze({
    sendCommand: async (deviceId, request) => {
      if (request.name === "pairing.start" || request.name === "pairing.stop") {
        return freeze({ status: "rejected" as const, detail: "请到手机上开始或停止对频。" });
      }
      if (request.name !== "pairing.status" || Object.keys(request.fields).length !== 0) return freeze({ status: "rejected" as const, detail: "请求无效" });
      const result = await send(deviceId, request.name, {});
      const mapped = freeze({ status: result.status === "succeeded" ? "accepted" as const : result.status === "timed-out" ? "timeout" as const : "rejected" as const, detail: result.status });
      return result.status === "succeeded" && result.result !== undefined ? freeze({ ...mapped, result: result.result }) : mapped;
    }
  });
  const flightGateway: AdapterFlightRelay = freeze({
    latestTelemetry: controlTelemetry,
    sendCommand: async (deviceId, request) => (request.name === "flight.takeoff" || request.name === "flight.land" || request.name === "flight.return-home") && request.fields.confirm === true ? send(deviceId, request.name, { confirm: bool(true) }) : commandFailure()
  });
  const settingsGateway: RelaySettingsGateway = freeze({
    sendCommand: async (deviceId, request) => {
      if (request.name !== "device.settings.camera.read" && request.name !== "device.settings.camera.write" && request.name !== "device.settings.transmission.read" && request.name !== "device.settings.transmission.write") return freeze({ status: "rejected" as const, detail: "设置命令无效" });
      if (disposed || !validId(deviceId) || typeof relay.sendCommand !== "function") return freeze({ status: "rejected" as const, detail: "设备未连接" });
      try {
        const outcome = await relay.sendCommand(deviceId, freeze({ name: request.name, fields: object({ ...request.fields }) }));
        const result = read(outcome, "result");
        const detail = typeof read(outcome, "detail") === "string" ? read(outcome, "detail") as string : "中继器未确认设置";
        return result !== undefined && record(result) !== null && read(result, "kind") === "object"
          ? freeze({ status: status(outcome), detail, result: result as JsonValue })
          : freeze({ status: status(outcome), detail });
      } catch { return freeze({ status: "transport-failed" as const, detail: "中继器通信失败" }); }
    }
  });
  const projectTelemetryRead = (deviceId: string, receivedAtMs: number, result: JsonValue): DesktopRelayTelemetry | null => {
    const fields = fieldsOf(result);
    if (fields === null || !Object.hasOwn(fields, "deviceRevision") || !Object.hasOwn(fields, "sdkAvailability") || !Object.hasOwn(fields, "remoteController") || !Object.hasOwn(fields, "flightController") || !Object.hasOwn(fields, "aircraft") || !Object.hasOwn(fields, "capabilities")) return null;
    const capabilities = read(fields, "capabilities");
    if (fieldsOf(capabilities) === null) return null;
    const payload: UnknownRecord = {};
    for (const [key, value] of Object.entries(fields)) if (key !== "capabilities") payload[key] = value;
    return project(deviceId, freeze({ deviceId, receivedAtMs, payload: freeze({ kind: "object", fields: freeze(payload) }), capabilities }));
  };
  const refreshTelemetry = async (deviceId: string): Promise<Readonly<{ readonly status: CommandStatus; readonly result?: JsonValue }>> => {
    const sessionId = validId(deviceId) ? activeSession(deviceId) : null;
    const outcome = await send(deviceId, "telemetry.read", {});
    const receivedAtMs = now();
    if (outcome.status !== "succeeded" || outcome.result === undefined || sessionId === null || receivedAtMs === null || activeSession(deviceId) !== sessionId) return outcome;
    const projected = projectTelemetryRead(deviceId, receivedAtMs, outcome.result);
    if (projected !== null) admit(deviceId, sessionId, projected);
    publish();
    return outcome;
  };
  return freeze({
    telemetry,
    controlTelemetry,
    devices,
    snapshot,
    subscribe: (listener) => { if (disposed) return () => undefined; listeners.add(listener); let active = true; return () => { if (active) { active = false; listeners.delete(listener); } }; },
    missionGateway: () => missionGateway,
    streamGateway: () => streamGateway,
    whipStreamGateway: () => whipStreamGateway,
    pairingGateway: () => pairingGateway,
    flightGateway: () => flightGateway,
    settingsGateway: () => settingsGateway,
    refreshTelemetry,
    dispose: () => { if (disposed) return; disposed = true; listeners.clear(); observations.clear(); try { unsubscribeRelay(); } catch { /* adapter teardown is best effort */ } }
  });
}

export const RelayOperationsAdapter = freeze({ create });
