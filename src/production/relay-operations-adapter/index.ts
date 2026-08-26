import type { MissionRelayGateway, RelayMissionPayload } from "../../modules/mission-control/mission-dispatcher/index.js";
import type { PairingRelayPort } from "../../modules/device-console/pairing-controller/index.js";
import type { FlightRelay } from "../../modules/flight-control/flight-command-dispatcher/index.js";

type JsonValue = Readonly<{ readonly kind: "null" }>
  | Readonly<{ readonly kind: "string"; readonly value: string }>
  | Readonly<{ readonly kind: "number"; readonly value: string }>
  | Readonly<{ readonly kind: "boolean"; readonly value: boolean }>
  | Readonly<{ readonly kind: "object"; readonly fields: Readonly<Record<string, JsonValue>> }>;

type CommandStatus = "succeeded" | "rejected" | "timed-out" | "disconnected" | "transport-failed";

export interface DesktopRelayTelemetry {
  readonly deviceId: string;
  readonly payload: Readonly<{
    readonly sdkRegistered?: boolean;
    readonly remoteControllerConnected?: boolean;
    readonly flightControllerConnected?: boolean;
    readonly connected?: boolean;
    readonly isFlying?: boolean;
    readonly motorsOn?: boolean;
    readonly batteryPercent?: number;
    readonly pairingState?: "UNKNOWN" | "IDLE" | "PAIRING" | "PAIRED" | "STOPPING" | "FAILED";
    readonly latitude?: number;
    readonly longitude?: number;
    readonly altitudeMeters?: number;
    readonly missionExecution?: "NOT_STARTED" | "STARTING" | "EXECUTING" | "PAUSED" | "STOPPING" | "FINISHED" | "FAILED";
    readonly missionFileName?: string;
  }>;
  readonly capabilities: Readonly<{
    readonly liveVideo?: boolean;
    readonly waypointMission?: boolean;
    readonly waypointMissionSupport?: "supported" | "unsupported";
  }>;
}

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
const latitude = (value: unknown): number | undefined => {
  const parsed = finiteNumber(value);
  return parsed !== undefined && parsed >= -90 && parsed <= 90 ? parsed : undefined;
};
const longitude = (value: unknown): number | undefined => {
  const parsed = finiteNumber(value);
  return parsed !== undefined && parsed >= -180 && parsed <= 180 ? parsed : undefined;
};
const pairingState = (value: unknown): "UNKNOWN" | "IDLE" | "PAIRING" | "PAIRED" | "STOPPING" | "FAILED" | undefined => {
  const current = string(value);
  return current === "UNKNOWN" || current === "IDLE" || current === "PAIRING" || current === "PAIRED" || current === "STOPPING" || current === "FAILED" ? current : undefined;
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
  const outputPayload: { sdkRegistered?: boolean; remoteControllerConnected?: boolean; flightControllerConnected?: boolean; connected?: boolean; isFlying?: boolean; motorsOn?: boolean; batteryPercent?: number; pairingState?: "UNKNOWN" | "IDLE" | "PAIRING" | "PAIRED" | "STOPPING" | "FAILED"; latitude?: number; longitude?: number; altitudeMeters?: number; missionExecution?: "NOT_STARTED" | "STARTING" | "EXECUTING" | "PAUSED" | "STOPPING" | "FINISHED" | "FAILED"; missionFileName?: string } = {};
  const outputCapabilities: { liveVideo?: boolean; waypointMission?: boolean; waypointMissionSupport?: "supported" | "unsupported" } = {};
  const sdk = string(payload.sdkAvailability); if (sdk === "READY") outputPayload.sdkRegistered = true; else if (sdk === "STARTING" || sdk === "STOPPED" || sdk === "FAILED") outputPayload.sdkRegistered = false;
  const remote = string(payload.remoteController); if (remote === "CONNECTED") outputPayload.remoteControllerConnected = true; else if (remote === "DISCONNECTED") outputPayload.remoteControllerConnected = false;
  const flight = string(payload.flightController); if (flight === "CONNECTED") outputPayload.flightControllerConnected = true; else if (flight === "DISCONNECTED") outputPayload.flightControllerConnected = false;
  const aircraft = string(payload.aircraft); if (aircraft === "CONNECTED") outputPayload.connected = true; else if (aircraft === "DISCONNECTED") outputPayload.connected = false;
  const isFlying = boolean(payload.isFlying); if (isFlying !== undefined) outputPayload.isFlying = isFlying;
  const motorsOn = boolean(payload.motorsOn); if (motorsOn !== undefined) outputPayload.motorsOn = motorsOn;
  const batteryPercent = number(payload.batteryPercent); if (batteryPercent !== undefined) outputPayload.batteryPercent = batteryPercent;
  const pairing = pairingState(payload.pairing); if (pairing !== undefined) outputPayload.pairingState = pairing;
  const latitudeValue = latitude(payload.latitude);
  const longitudeValue = longitude(payload.longitude);
  if (latitudeValue !== undefined && longitudeValue !== undefined) {
    outputPayload.latitude = latitudeValue;
    outputPayload.longitude = longitudeValue;
  }
  const altitudeMeters = finiteNumber(payload.altitudeMeters); if (altitudeMeters !== undefined) outputPayload.altitudeMeters = altitudeMeters;
  const missionExecution = string(payload.missionExecution);
  if (missionExecution === "NOT_STARTED" || missionExecution === "STARTING" || missionExecution === "EXECUTING" || missionExecution === "PAUSED" || missionExecution === "STOPPING" || missionExecution === "FINISHED" || missionExecution === "FAILED") outputPayload.missionExecution = missionExecution;
  const missionFileName = string(payload.missionFileName); if (validMissionFileName(missionFileName)) outputPayload.missionFileName = missionFileName;
  const liveVideo = boolean(capabilities.liveVideo); if (liveVideo !== undefined) outputCapabilities.liveVideo = liveVideo;
  const waypointMission = boolean(capabilities.waypointMission); if (waypointMission !== undefined) outputCapabilities.waypointMission = waypointMission;
  const support = string(capabilities.waypointMissionSupport); if (support === "SUPPORTED") outputCapabilities.waypointMissionSupport = "supported"; else if (support === "UNSUPPORTED") outputCapabilities.waypointMissionSupport = "unsupported";
  return freeze({ deviceId, payload: freeze(outputPayload), capabilities: freeze(outputCapabilities) });
}

function create(options: Readonly<{ readonly relay: unknown }>): RelayOperationsAdapterInstance {
  const relay = options.relay as RelaySource;
  const listeners = new Set<(snapshot: RelayOperationsSnapshot) => void>();
  let rawSnapshot: unknown = null;
  let disposed = false;
  const telemetry = (deviceId: string): DesktopRelayTelemetry | null => {
    if (disposed || !validId(deviceId) || typeof relay.latestTelemetry !== "function") return null;
    try { return project(deviceId, relay.latestTelemetry(deviceId)); } catch { return null; }
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
    try { unsubscribeRelay = relay.subscribe((value) => { rawSnapshot = value; publish(); }); } catch { /* an unavailable relay leaves the adapter offline */ }
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
    latestTelemetry: telemetry,
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
    latestTelemetry: telemetry,
    ingressAddress,
    sendCommand: async (deviceId, request) => {
      if (request.name === "live-stream.stop" && Object.keys(request.fields).length === 0) return sendVideo(deviceId, request.name, {});
      if (request.name !== "live-stream.start" || Object.keys(request.fields).length !== 1 || typeof request.fields.rtmpUrl !== "string" || request.fields.rtmpUrl.trim().length === 0) return commandFailure();
      return sendVideo(deviceId, request.name, { rtmpUrl: text(request.fields.rtmpUrl) });
    }
  });
  const whipStreamGateway: WhipStreamRelayGateway = freeze({
    latestTelemetry: telemetry,
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
    latestTelemetry: telemetry,
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
  return freeze({
    telemetry,
    devices,
    snapshot,
    subscribe: (listener) => { if (disposed) return () => undefined; listeners.add(listener); let active = true; return () => { if (active) { active = false; listeners.delete(listener); } }; },
    missionGateway: () => missionGateway,
    streamGateway: () => streamGateway,
    whipStreamGateway: () => whipStreamGateway,
    pairingGateway: () => pairingGateway,
    flightGateway: () => flightGateway,
    settingsGateway: () => settingsGateway,
    refreshTelemetry: (deviceId) => send(deviceId, "telemetry.read", {}),
    dispose: () => { if (disposed) return; disposed = true; listeners.clear(); try { unsubscribeRelay(); } catch { /* adapter teardown is best effort */ } }
  });
}

export const RelayOperationsAdapter = freeze({ create });
