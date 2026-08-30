import { RelayFrameCodec, validate, type DiagnosticEventFrame, type JsonObject, type RelayFrame } from "./protocol-core/index.js";
import { RelayServer, type ListenAddress, type RelayConnection, type RelayServerEvent, type RelayTransport, type TimerScheduler as ServerTimerScheduler } from "./relay-server/index.js";
import { DeviceRegistry, type DeviceSnapshot } from "./device-registry/index.js";
import { CommandTracker, type CommandOutcome as TrackedCommandOutcome, type TimerScheduler as CommandTimerScheduler } from "./command-tracker/index.js";
import { TelemetryIntake } from "./telemetry-intake/index.js";
import { MissionSender, type MissionOutcome as SentMissionOutcome, type MissionPayload, type TimerScheduler as MissionTimerScheduler } from "./mission-sender/index.js";
import { MissionPhaseIntake, type MissionPhase } from "./mission-phase-intake/index.js";

export type { ListenAddress, RelayConnection, RelayTransport };
export type { MissionPayload } from "./mission-sender/index.js";
export type TimerScheduler = ServerTimerScheduler & CommandTimerScheduler & MissionTimerScheduler;

export interface CommandRequest { readonly name: string; readonly fields: JsonObject["fields"]; }
export interface RelayDiagnosticSink {
  persist(input: Readonly<{ readonly deviceId: string; readonly runId: string; readonly events: readonly DiagnosticEventFrame[] }>): boolean;
}
export interface RelayDeviceSnapshot { readonly deviceId: string; readonly sessionId: string; }
export interface RelayTelemetrySnapshot { readonly deviceId: string; readonly payload: JsonObject; readonly capabilities: JsonObject; readonly receivedAtMs: number | null; }
export interface RelayMissionPhaseSnapshot {
  readonly deviceId: string;
  readonly missionRevision: number;
  readonly deviceGeneration: number;
  readonly sequence: number;
  readonly phase: MissionPhase;
  readonly fileName: string;
}
export type CommandStatus = TrackedCommandOutcome["status"];
export interface CommandOutcome { readonly deviceId: string; readonly commandId: string; readonly status: CommandStatus; readonly detail: string; readonly result?: JsonObject; }
export type MissionStatus = SentMissionOutcome["status"];
export interface MissionOutcome { readonly deviceId: string; readonly missionId: string; readonly status: MissionStatus; readonly detail: string; }
export interface RelayLinkSnapshot {
  readonly state: "stopped" | "starting" | "listening" | "stopping";
  readonly endpoint: ListenAddress | null;
  readonly devices: readonly RelayDeviceSnapshot[];
  readonly telemetry: readonly RelayTelemetrySnapshot[];
  readonly missionPhases: readonly RelayMissionPhaseSnapshot[];
  readonly pendingCommands: readonly Readonly<{ readonly deviceId: string; readonly commandId: string }>[];
  readonly pendingMissions: readonly Readonly<{ readonly deviceId: string; readonly missionId: string }>[];
}
export type StartResult = Readonly<{ readonly ok: true; readonly value: Pick<RelayLinkSnapshot, "state" | "endpoint"> }> | Readonly<{ readonly ok: false; readonly error: Readonly<{ readonly code: string; readonly message: string }> }>;

export interface RelayLinkOptions {
  readonly address: ListenAddress;
  readonly transport: RelayTransport;
  readonly scheduler: TimerScheduler;
  readonly handshakeTimeoutMs: number;
  readonly maxConnections: number;
  readonly commandTimeoutMs: number;
  readonly missionTimeoutMs: number;
  /** Optional desktop wall clock used only to mark successful telemetry receipt for display. */
  readonly now?: () => number;
  readonly diagnosticSink?: RelayDiagnosticSink;
  readonly createConnectionId: () => string;
  readonly createSessionId: (deviceId: string) => string;
  readonly createCommandId: () => string;
}

export interface RelayLinkInstance {
  start(): Promise<StartResult>;
  stop(): Promise<void>;
  devices(): readonly RelayDeviceSnapshot[];
  sendCommand(deviceId: string, request: CommandRequest): Promise<CommandOutcome>;
  sendMission(deviceId: string, payload: MissionPayload): Promise<MissionOutcome>;
  latestTelemetry(deviceId: string): RelayTelemetrySnapshot | null;
  /** 仅供同进程控制面选择该设备回传媒体地址，不进入公开设备快照。 */
  ingressAddress(deviceId: string): string | null;
  subscribe(listener: (snapshot: RelayLinkSnapshot) => void): () => void;
}

const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
const key = (connectionId: string, operationId: string): string => `${connectionId}\u0000${operationId}`;
const frozen = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const commandFailure = (deviceId: string, commandId: string, detail: string): CommandOutcome => frozen({ deviceId, commandId, status: "rejected", detail });
const missionFailure = (deviceId: string, missionId: string, detail: string): MissionOutcome => frozen({ deviceId, missionId, status: "rejected", detail });

function create(options: RelayLinkOptions): RelayLinkInstance {
  const server = RelayServer.create({
    address: options.address, transport: options.transport, scheduler: options.scheduler,
    handshakeTimeoutMs: options.handshakeTimeoutMs, maxConnections: options.maxConnections,
    createConnectionId: options.createConnectionId, createSessionId: options.createSessionId
  });
  const registry = DeviceRegistry.create();
  const tracker = CommandTracker.create({ scheduler: options.scheduler, timeoutMs: options.commandTimeoutMs });
  const intake = TelemetryIntake.create(options.now === undefined ? {} : { now: options.now });
  const missionPhases = MissionPhaseIntake.create();
  const missions = MissionSender.create({ scheduler: options.scheduler, timeoutMs: options.missionTimeoutMs });
  const listeners = new Set<(snapshot: RelayLinkSnapshot) => void>();
  const ingressByConnection = new Map<string, string>();
  const commandWaiters = new Map<string, { readonly deviceId: string; readonly resolve: (outcome: CommandOutcome) => void }>();
  const persistedDiagnosticKeys = new Map<string, null>();
  const diagnosticKey = (deviceId: string, runId: string, sequence: number): string => `${deviceId}\u0000${runId}\u0000${sequence}`;
  const rememberDiagnostic = (value: string): void => {
    persistedDiagnosticKeys.set(value, null);
    if (persistedDiagnosticKeys.size > 4_096) persistedDiagnosticKeys.delete(persistedDiagnosticKeys.keys().next().value!);
  };
  const deviceForConnection = (connectionId: string): DeviceSnapshot | null => registry.getByConnection(connectionId);
  const snapshot = (): RelayLinkSnapshot => {
    const serverSnapshot = server.snapshot();
    const devices = Object.freeze(registry.snapshot().devices.map((device) => frozen({ deviceId: device.deviceId, sessionId: device.sessionId })));
    const telemetry = Object.freeze(intake.snapshot().flatMap((value) => {
      // The close route removes this child state before the registry mapping.
      const device = deviceForConnection(value.connectionId);
      /* c8 ignore next -- a snapshot cannot retain telemetry for a removed registry entry. */
      return device ? [frozen({ deviceId: device.deviceId, payload: value.payload, capabilities: value.capabilities, receivedAtMs: value.receivedAtMs })] : [];
    }));
    const phaseFacts = Object.freeze(missionPhases.snapshot().flatMap((value) => {
      const device = deviceForConnection(value.connectionId);
      /* c8 ignore next -- connection cleanup removes its phase fact before registry removal. */
      return device ? [frozen({ deviceId: device.deviceId, missionRevision: value.missionRevision, deviceGeneration: value.deviceGeneration, sequence: value.sequence, phase: value.phase, fileName: value.fileName })] : [];
    }));
    const pendingCommands = Object.freeze(tracker.snapshot().flatMap((value) => {
      // Command completion is routed before either child can retain a stale entry.
      const device = deviceForConnection(value.connectionId);
      /* c8 ignore next -- a snapshot cannot retain a pending command for a removed registry entry. */
      return device ? [frozen({ deviceId: device.deviceId, commandId: value.commandId })] : [];
    }));
    const pendingMissions = Object.freeze(missions.snapshot().flatMap((value) => {
      const device = deviceForConnection(value.connectionId); return device ? [frozen({ deviceId: device.deviceId, missionId: value.missionId })] : [];
    }));
    return frozen({ state: serverSnapshot.state, endpoint: serverSnapshot.endpoint, devices, telemetry, missionPhases: phaseFacts, pendingCommands, pendingMissions });
  };
  const publish = (): void => {
    const value = snapshot();
    for (const listener of [...listeners]) { try { listener(value); } catch { /* listener isolation is part of the root seam */ } }
  };
  const completeCommand = (outcome: TrackedCommandOutcome): void => {
    const waiter = commandWaiters.get(key(outcome.connectionId, outcome.commandId));
    // Every pending tracker entry is created with its waiter in this module.
    /* c8 ignore next */
    if (!waiter) return;
    commandWaiters.delete(key(outcome.connectionId, outcome.commandId));
    waiter.resolve(frozen({ deviceId: waiter.deviceId, commandId: outcome.commandId, status: outcome.status, detail: outcome.detail, ...(outcome.result === undefined ? {} : { result: outcome.result }) }));
    publish();
  };
  tracker.subscribe(completeCommand);
  missions.subscribe(() => publish());
  const handleServerEvent = (event: RelayServerEvent): void => {
    if (event.kind === "state-changed") { publish(); return; }
    if (event.kind === "connection-paired") {
      if (typeof event.connection.localAddress === "string") ingressByConnection.set(event.connection.connectionId, event.connection.localAddress);
      else ingressByConnection.delete(event.connection.connectionId);
      registry.register({ connectionId: event.connection.connectionId, deviceId: event.connection.deviceId!, sessionId: event.connection.sessionId! }); publish(); return;
    }
    if (event.kind === "connection-closed") {
      ingressByConnection.delete(event.connectionId);
      registry.removeByConnection(event.connectionId); intake.removeConnection(event.connectionId); missionPhases.remove(event.connectionId);
      tracker.cancelConnection(event.connectionId, event.reason);
      missions.cancelConnection(event.connectionId, event.reason);
      publish(); return;
    }
    if (event.kind !== "frame") return;
    if (event.frame.type === "telemetry") { intake.accept({ connectionId: event.connectionId, payload: event.frame.payload, capabilities: event.frame.capabilities }); publish(); return; }
    if (event.frame.type === "mission-phase") {
      const accepted = missionPhases.accept({ connectionId: event.connectionId, missionRevision: event.frame.missionRevision, deviceGeneration: event.frame.deviceGeneration, sequence: event.frame.sequence, phase: event.frame.phase, fileName: event.frame.fileName });
      if (accepted.ok) publish();
      return;
    }
    if (event.frame.type === "command-result") { tracker.resolve({ connectionId: event.connectionId, commandId: event.frame.id, ok: event.frame.ok, detail: event.frame.detail, ...(event.frame.result === undefined ? {} : { result: event.frame.result }) }); return; }
    if (event.frame.type === "mission-result") { missions.acceptResult(event.connectionId, { missionId: event.frame.id, ok: event.frame.ok, detail: event.frame.detail }); }
    const diagnosticReport = event.frame;
    if (diagnosticReport.type === "diagnostic-report") {
      const device = deviceForConnection(event.connectionId);
      const sink = options.diagnosticSink;
      if (!device || !sink) return;
      const pending = diagnosticReport.events.filter((item) => !persistedDiagnosticKeys.has(diagnosticKey(device.deviceId, diagnosticReport.runId, item.sequence)));
      if (pending.length > 0) {
        let persisted = false;
        try { persisted = sink.persist(frozen({ deviceId: device.deviceId, runId: diagnosticReport.runId, events: Object.freeze(pending.map((item) => frozen({ ...item }))) })); } catch { persisted = false; }
        if (!persisted) return;
        for (const item of pending) rememberDiagnostic(diagnosticKey(device.deviceId, diagnosticReport.runId, item.sequence));
      }
      // protocol-core rejects an empty diagnostic report before it reaches this root module.
      const acknowledgedSequence = diagnosticReport.events[diagnosticReport.events.length - 1]!.sequence;
      const encoded = RelayFrameCodec.encode({ type: "diagnostic-ack", runId: diagnosticReport.runId, acknowledgedSequence });
      /* c8 ignore next -- validated diagnostic identifiers and positive sequence always encode. */
      if (encoded.ok) void server.send(event.connectionId, encoded.value);
    }
  };
  server.subscribe(handleServerEvent);
  const sendCommand = async (deviceId: string, request: CommandRequest): Promise<CommandOutcome> => {
    if (!validId(deviceId)) return commandFailure(deviceId, "invalid", "Device is not connected");
    const device = registry.getByDevice(deviceId); if (!device) return commandFailure(deviceId, "invalid", "Device is not connected");
    let commandId: string;
    try { commandId = options.createCommandId(); } catch { return commandFailure(deviceId, "invalid", "Command ID could not be created"); }
    let frame: RelayFrame;
    try { frame = { type: "command", id: commandId, command: { name: request?.name, fields: request?.fields } }; } catch { return commandFailure(deviceId, commandId, "Command is invalid"); }
    const encoded = RelayFrameCodec.encode(frame); if (!encoded.ok) return commandFailure(deviceId, commandId, "Command is invalid");
    const begun = tracker.begin({ connectionId: device.connectionId, commandId }); if (!begun.ok) return commandFailure(deviceId, commandId, "Command is already pending");
    const result = new Promise<CommandOutcome>((resolve) => { commandWaiters.set(key(device.connectionId, commandId), { deviceId, resolve }); });
    const sent = await server.send(device.connectionId, encoded.value);
    if (!sent.ok) tracker.cancelConnection(device.connectionId, "Command could not be sent");
    return result;
  };
  const sendMission = async (deviceId: string, payload: MissionPayload): Promise<MissionOutcome> => {
    if (!validId(deviceId)) return missionFailure(deviceId, typeof payload?.missionId === "string" ? payload.missionId : "invalid", "Device is not connected");
    const device = registry.getByDevice(deviceId); if (!device) return missionFailure(deviceId, typeof payload?.missionId === "string" ? payload.missionId : "invalid", "Device is not connected");
    let beginFrame: RelayFrame;
    try { beginFrame = { type: "mission-begin", id: payload?.missionId, fileName: payload?.fileName, size: payload?.size, sha256: payload?.sha256 }; } catch { return missionFailure(deviceId, "invalid", "Mission payload is invalid"); }
    if (!validate(beginFrame).ok) return missionFailure(deviceId, typeof payload?.missionId === "string" ? payload.missionId : "invalid", "Mission payload is invalid");
    const sink = { send: async (frame: RelayFrame): Promise<void> => { const encoded = RelayFrameCodec.encode(frame); /* c8 ignore next */ if (!encoded.ok) throw new Error("invalid frame"); const sent = await server.send(device.connectionId, encoded.value); if (!sent.ok) throw new Error("send failed"); } };
    const outcome = await missions.send(device.connectionId, payload, sink);
    return frozen({ deviceId, missionId: outcome.missionId, status: outcome.status, detail: outcome.detail });
  };
  return frozen({
    start: async (): Promise<StartResult> => {
      const result = await server.start();
      if (!result.ok) return frozen({ ok: false as const, error: result.error });
      return frozen({ ok: true as const, value: frozen({ state: result.value.state, endpoint: result.value.endpoint }) });
    },
    stop: async (): Promise<void> => { await server.stop(); },
    devices: () => snapshot().devices,
    sendCommand,
    sendMission,
    latestTelemetry: (deviceId: string): RelayTelemetrySnapshot | null => {
      if (!validId(deviceId)) return null;
      const device = registry.getByDevice(deviceId); if (!device) return null;
      const value = intake.get(device.connectionId); return value ? frozen({ deviceId, payload: value.payload, capabilities: value.capabilities, receivedAtMs: value.receivedAtMs }) : null;
    },
    ingressAddress: (deviceId: string): string | null => {
      if (!validId(deviceId)) return null;
      const device = registry.getByDevice(deviceId);
      return device === null ? null : ingressByConnection.get(device.connectionId) ?? null;
    },
    subscribe: (listener: (value: RelayLinkSnapshot) => void): (() => void) => { listeners.add(listener); let active = true; return () => { if (active) { active = false; listeners.delete(listener); } }; }
  });
}

export const RelayLink = Object.freeze({ create });
