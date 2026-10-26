import { RelayFrameCodec, validate, type DiagnosticEventFrame, type JsonObject, type RelayFrame } from "./protocol-core/index.js";
import { RelayServer, type LinkProbeReport, type ListenAddress, type RelayConnection, type RelayServerEvent, type RelayTransport, type TimerScheduler as ServerTimerScheduler } from "./relay-server/index.js";
import { DeviceRegistry, type DeviceSnapshot } from "./device-registry/index.js";
import { CommandTracker, type CommandOutcome as TrackedCommandOutcome, type TimerScheduler as CommandTimerScheduler } from "./command-tracker/index.js";
import { TelemetryIntake } from "./telemetry-intake/index.js";
import { MissionSender, type MissionOutcome as SentMissionOutcome, type MissionPayload, type TimerScheduler as MissionTimerScheduler } from "./mission-sender/index.js";
import { MissionPhaseIntake, type MissionPhase } from "./mission-phase-intake/index.js";
import { MediaIntake, type MediaFile, type MediaReceiveProgress } from "./media-intake/index.js";

export type { LinkProbeReport, ListenAddress, RelayConnection, RelayTransport };
export type { MissionPayload } from "./mission-sender/index.js";
export type TimerScheduler = ServerTimerScheduler & CommandTimerScheduler & MissionTimerScheduler;

export interface RelayPhotoProgress {
  readonly stage: "listing" | "downloading" | "receiving" | "verifying" | "saving" | "saved";
  readonly photoIndex: number;
  readonly completedCount: number;
  readonly fileName: string | null;
  readonly transferredBytes: number;
  readonly totalBytes: number | null;
}
export interface CommandRequest { readonly name: string; readonly fields: JsonObject["fields"]; readonly timeoutMs?: number; readonly onPhotoProgress?: (progress: RelayPhotoProgress) => void; }
export interface RelayDiagnosticSink {
  persist(input: Readonly<{ readonly deviceId: string; readonly runId: string; readonly events: readonly DiagnosticEventFrame[] }>): Promise<boolean>;
}
export interface RelayDeviceSnapshot { readonly deviceId: string; readonly sessionId: string; }
export interface RelayTelemetrySnapshot { readonly deviceId: string; readonly sessionId: string; readonly payload: JsonObject; readonly capabilities: JsonObject; readonly receivedAtMs: number | null; }
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
  readonly lastDisconnect: Readonly<{ readonly deviceId: string; readonly reason: string }> | null;
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
  readonly onPhoto?: (deviceId: string, file: MediaFile, receipt: Readonly<{ readonly isCurrent: () => boolean }>) => boolean | Promise<boolean>;
}

export interface RelayLinkInstance {
  start(): Promise<StartResult>;
  stop(): Promise<void>;
  devices(): readonly RelayDeviceSnapshot[];
  sendCommand(deviceId: string, request: CommandRequest): Promise<CommandOutcome>;
  sendMission(deviceId: string, payload: MissionPayload): Promise<MissionOutcome>;
  measurePhoneLink(deviceId: string): Promise<LinkProbeReport>;
  latestTelemetry(deviceId: string): RelayTelemetrySnapshot | null;
  /** 仅供同进程控制面选择该设备回传媒体地址，不进入公开设备快照。 */
  ingressAddress(deviceId: string): string | null;
  subscribe(listener: (snapshot: RelayLinkSnapshot) => void): () => void;
}

const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
const key = (connectionId: string, operationId: string): string => `${connectionId}\u0000${operationId}`;
const frozen = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const MAX_QUEUED_DIAGNOSTIC_REPORTS = 16;
const commandFailure = (deviceId: string, commandId: string, detail: string): CommandOutcome => frozen({ deviceId, commandId, status: "rejected", detail });
const missionFailure = (deviceId: string, missionId: string, detail: string): MissionOutcome => frozen({ deviceId, missionId, status: "rejected", detail });
const copyProbeReport = (report: LinkProbeReport): LinkProbeReport => report.status === "measured"
  ? frozen({ status: report.status, sampleCount: report.sampleCount, currentRttMs: report.currentRttMs, medianRttMs: report.medianRttMs, maximumRttMs: report.maximumRttMs, jitterMs: report.jitterMs })
  : frozen({ status: report.status, sampleCount: report.sampleCount });

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
  const media = MediaIntake.create({
    onProgress: (connectionId, progress) => receivePhotoProgress(connectionId, progress),
    sink: {
      begin: (connectionId) => deviceForConnection(connectionId) === null ? "rejected" : "accepted",
      append: (connectionId) => deviceForConnection(connectionId) === null ? "rejected" : "accepted",
      complete: (connectionId, file) => {
        const device = deviceForConnection(connectionId);
        if (device === null || options.onPhoto === undefined) return "rejected";
        const owner = photoReceivers.get(connectionId);
        const receipt = frozen({ isCurrent: () => owner !== undefined && deviceForConnection(connectionId) === device && photoReceivers.get(connectionId) === owner && (commandWaiters.get(owner.requestKey) === owner.waiter || owner.commandSucceeded) });
        try {
          const stored = options.onPhoto(device.deviceId, file, receipt);
          return typeof stored === "boolean" ? (stored ? "accepted" : "rejected") : stored.then((ok) => ok ? "accepted" as const : "rejected" as const, () => "rejected" as const);
        } catch { return "rejected"; }
      },
      abort: () => undefined,
    },
    results: {
      send: (connectionId, frame) => {
        if (!frame.ok && photoReceivers.get(connectionId)?.transferId === frame.id) photoReceivers.delete(connectionId);
        const encoded = RelayFrameCodec.encode(frame);
        if (encoded.ok) void server.send(connectionId, encoded.value);
      }
    }
  });
  const listeners = new Set<(snapshot: RelayLinkSnapshot) => void>();
  let lastDisconnect: RelayLinkSnapshot["lastDisconnect"] = null;
  const ingressByConnection = new Map<string, string>();
  interface CommandWaiter {
    readonly deviceId: string;
    readonly resolve: (outcome: CommandOutcome) => void;
    readonly onPhotoProgress?: (progress: RelayPhotoProgress) => void;
    sequence: number;
    completedCount: number;
    lastProgress?: RelayPhotoProgress;
  }
  const commandWaiters = new Map<string, CommandWaiter>();
  const photoReceivers = new Map<string, { readonly requestKey: string; readonly waiter: CommandWaiter; readonly transferId: string; readonly photoIndex: number; commandSucceeded: boolean }>();
  const stageOrder = { listing: 0, downloading: 1, receiving: 2, verifying: 3, saving: 4, saved: 5 };
  const notifyPhoto = (waiter: CommandWaiter, progress: RelayPhotoProgress): void => {
    const previous = waiter.lastProgress;
    if (previous !== undefined) {
      if (progress.stage === "listing") {
        if (previous.stage !== "saved" && previous.stage !== "listing") return;
      } else if (progress.photoIndex < previous.photoIndex || (progress.photoIndex === previous.photoIndex && (stageOrder[progress.stage] < stageOrder[previous.stage] || (progress.stage === previous.stage && progress.fileName === previous.fileName && progress.transferredBytes < previous.transferredBytes)))) return;
    }
    waiter.lastProgress = progress;
    try { waiter.onPhotoProgress?.(frozen(progress)); } catch { /* UI progress cannot fail a command */ }
  };
  const receivePhotoProgress = (connectionId: string, progress: MediaReceiveProgress): void => {
    let owner = photoReceivers.get(connectionId);
    if (progress.stage === "receiving" && progress.transferredBytes === 0) {
      const entry = [...commandWaiters.entries()].find(([requestKey, waiter]) => requestKey.startsWith(`${connectionId}\u0000`) && waiter.onPhotoProgress !== undefined);
      if (entry === undefined) return;
      owner = { requestKey: entry[0], waiter: entry[1], transferId: progress.transferId, photoIndex: entry[1].completedCount + 1, commandSucceeded: false };
      photoReceivers.set(connectionId, owner);
    }
    if (owner === undefined || owner.transferId !== progress.transferId) return;
    if (commandWaiters.get(owner.requestKey) !== owner.waiter) {
      if (progress.stage === "saved") photoReceivers.delete(connectionId);
      return;
    }
    if (progress.stage === "saved") owner.waiter.completedCount += 1;
    notifyPhoto(owner.waiter, { stage: progress.stage, photoIndex: owner.photoIndex, completedCount: owner.waiter.completedCount, fileName: progress.fileName, transferredBytes: progress.transferredBytes, totalBytes: progress.totalBytes });
    if (progress.stage === "saved") photoReceivers.delete(connectionId);
  };
  const persistedDiagnosticKeys = new Map<string, null>();
  interface QueuedDiagnosticReport {
    readonly identity: string;
    readonly persist: () => Promise<void>;
  }
  interface DiagnosticPersistenceQueue {
    readonly reports: QueuedDiagnosticReport[];
    readonly identities: Set<string>;
    running: boolean;
  }
  const diagnosticQueues = new Map<string, DiagnosticPersistenceQueue>();
  const diagnosticKey = (deviceId: string, runId: string, sequence: number): string => `${deviceId}\u0000${runId}\u0000${sequence}`;
  const rememberDiagnostic = (value: string): void => {
    persistedDiagnosticKeys.set(value, null);
    if (persistedDiagnosticKeys.size > 4_096) persistedDiagnosticKeys.delete(persistedDiagnosticKeys.keys().next().value!);
  };
  const deviceForConnection = (connectionId: string): DeviceSnapshot | null => registry.getByConnection(connectionId);
  const drainDiagnosticQueue = (connectionId: string, queue: DiagnosticPersistenceQueue): void => {
    void (async () => {
      while (diagnosticQueues.get(connectionId) === queue) {
        const report = queue.reports.shift();
        if (report === undefined) {
          queue.running = false;
          diagnosticQueues.delete(connectionId);
          return;
        }
        try { await report.persist(); } catch { /* diagnostics must not leak into the relay loop */ }
        queue.identities.delete(report.identity);
      }
    })();
  };
  const snapshot = (): RelayLinkSnapshot => {
    const serverSnapshot = server.snapshot();
    const devices = Object.freeze(registry.snapshot().devices.map((device) => frozen({ deviceId: device.deviceId, sessionId: device.sessionId })));
    const telemetry = Object.freeze(intake.snapshot().flatMap((value) => {
      // The close route removes this child state before the registry mapping.
      const device = deviceForConnection(value.connectionId);
      /* c8 ignore next -- a snapshot cannot retain telemetry for a removed registry entry. */
      return device ? [frozen({ deviceId: device.deviceId, sessionId: device.sessionId, payload: value.payload, capabilities: value.capabilities, receivedAtMs: value.receivedAtMs })] : [];
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
      const device = deviceForConnection(value.connectionId);       return device ? [frozen({ deviceId: device.deviceId, missionId: value.missionId })] : [];
    }));
    return frozen({ state: serverSnapshot.state, endpoint: serverSnapshot.endpoint, devices, telemetry, missionPhases: phaseFacts, pendingCommands, pendingMissions, lastDisconnect });
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
    const receiver = photoReceivers.get(outcome.connectionId);
    if (receiver?.waiter === waiter) {
      if (outcome.status === "succeeded") receiver.commandSucceeded = true;
      else photoReceivers.delete(outcome.connectionId);
    }
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
      const device = deviceForConnection(event.connectionId);
      if (device !== null) lastDisconnect = frozen({ deviceId: device.deviceId, reason: event.reason });
      ingressByConnection.delete(event.connectionId);
      diagnosticQueues.delete(event.connectionId);
      photoReceivers.delete(event.connectionId);
      registry.removeByConnection(event.connectionId); intake.removeConnection(event.connectionId); missionPhases.remove(event.connectionId);
      tracker.cancelConnection(event.connectionId, event.reason);
      missions.cancelConnection(event.connectionId, event.reason);
      media.cancelConnection(event.connectionId, event.reason);
      publish(); return;
    }
    if (event.kind !== "frame") return;
    if (event.frame.type === "photo-progress") {
      const frame = event.frame;
      const waiter = commandWaiters.get(key(event.connectionId, frame.id));
      if (waiter?.onPhotoProgress === undefined || frame.sequence <= waiter.sequence || frame.completedCount !== waiter.completedCount) return;
      waiter.sequence = frame.sequence;
      // Local receive/save facts take precedence over a delayed phone download notification.
      if (photoReceivers.has(event.connectionId)) return;
      notifyPhoto(waiter, { stage: frame.phase === "sending" ? "receiving" : frame.phase, photoIndex: frame.photoIndex, completedCount: waiter.completedCount, fileName: frame.fileName, transferredBytes: frame.phase === "sending" ? 0 : frame.transferredBytes, totalBytes: frame.totalBytes });
      return;
    }
    if (event.frame.type === "telemetry") { intake.accept({ connectionId: event.connectionId, payload: event.frame.payload, capabilities: event.frame.capabilities }); publish(); return; }
    if (event.frame.type === "mission-phase") {
      const accepted = missionPhases.accept({ connectionId: event.connectionId, missionRevision: event.frame.missionRevision, deviceGeneration: event.frame.deviceGeneration, sequence: event.frame.sequence, phase: event.frame.phase, fileName: event.frame.fileName });
      if (accepted.ok) publish();
      return;
    }
    if (event.frame.type === "command-result") { tracker.resolve({ connectionId: event.connectionId, commandId: event.frame.id, ok: event.frame.ok, detail: event.frame.detail, ...(event.frame.result === undefined ? {} : { result: event.frame.result }) }); return; }
    if (event.frame.type === "mission-result") { missions.acceptResult(event.connectionId, { missionId: event.frame.id, ok: event.frame.ok, detail: event.frame.detail }); }
    if (event.frame.type === "media-begin" || event.frame.type === "media-chunk" || event.frame.type === "media-complete") {
      media.accept(event.connectionId, event.frame);
      return;
    }
    const diagnosticReport = event.frame;
    if (diagnosticReport.type === "diagnostic-report") {
      const device = deviceForConnection(event.connectionId);
      const sink = options.diagnosticSink;
      if (!device || !sink) return;
      const identity = `${diagnosticReport.runId}\u0000${diagnosticReport.events.map((item) => item.sequence).join(",")}`;
      const allPersisted = diagnosticReport.events.every((item) => persistedDiagnosticKeys.has(diagnosticKey(device.deviceId, diagnosticReport.runId, item.sequence)));
      if (allPersisted) {
        const acknowledgedSequence = diagnosticReport.events[diagnosticReport.events.length - 1]!.sequence;
        const encoded = RelayFrameCodec.encode({ type: "diagnostic-ack", runId: diagnosticReport.runId, acknowledgedSequence });
        if (encoded.ok) void server.send(event.connectionId, encoded.value);
        return;
      }
      const queue = diagnosticQueues.get(event.connectionId) ?? { reports: [], identities: new Set<string>(), running: false };
      if (queue.identities.has(identity) || queue.reports.length >= MAX_QUEUED_DIAGNOSTIC_REPORTS) return;
      diagnosticQueues.set(event.connectionId, queue);
      queue.identities.add(identity);
      queue.reports.push({
        identity,
        persist: async () => {
          if (diagnosticQueues.get(event.connectionId) !== queue) return;
          const current = deviceForConnection(event.connectionId);
          if (current?.sessionId !== device.sessionId) return;
          const pending = diagnosticReport.events.filter((item) => !persistedDiagnosticKeys.has(diagnosticKey(device.deviceId, diagnosticReport.runId, item.sequence)));
          if (pending.length > 0) {
            let persisted = false;
            try { persisted = await sink.persist(frozen({ deviceId: device.deviceId, runId: diagnosticReport.runId, events: Object.freeze(pending.map((item) => frozen({ ...item }))) })); } catch { persisted = false; }
            if (!persisted) return;
            for (const item of pending) rememberDiagnostic(diagnosticKey(device.deviceId, diagnosticReport.runId, item.sequence));
          }
          if (diagnosticQueues.get(event.connectionId) !== queue || deviceForConnection(event.connectionId)?.sessionId !== device.sessionId) return;
          // protocol-core rejects an empty diagnostic report before it reaches this root module.
          const acknowledgedSequence = diagnosticReport.events[diagnosticReport.events.length - 1]!.sequence;
          const encoded = RelayFrameCodec.encode({ type: "diagnostic-ack", runId: diagnosticReport.runId, acknowledgedSequence });
          /* c8 ignore next -- validated diagnostic identifiers and positive sequence always encode. */
          if (encoded.ok) await server.send(event.connectionId, encoded.value);
        },
      });
      if (!queue.running) {
        queue.running = true;
        drainDiagnosticQueue(event.connectionId, queue);
      }
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
    if (request.name === "camera.photo.fetch") {
      const receiver = photoReceivers.get(device.connectionId);
      if (receiver !== undefined && commandWaiters.get(receiver.requestKey) !== receiver.waiter) photoReceivers.delete(device.connectionId);
    }
    const begun = tracker.begin({ connectionId: device.connectionId, commandId, ...(typeof request?.timeoutMs === "number" ? { timeoutMs: request.timeoutMs } : {}) }); if (!begun.ok) return commandFailure(deviceId, commandId, "Command is already pending");
    const result = new Promise<CommandOutcome>((resolve) => { commandWaiters.set(key(device.connectionId, commandId), { deviceId, resolve, sequence: 0, completedCount: 0, ...(request.name === "camera.photo.fetch" && request.onPhotoProgress !== undefined ? { onPhotoProgress: request.onPhotoProgress } : {}) }); });
    void server.send(device.connectionId, encoded.value).then((sent) => {
      if (!sent.ok) tracker.cancelConnection(device.connectionId, "Command could not be sent");
    });
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
  const measurePhoneLink = async (deviceId: string): Promise<LinkProbeReport> => {
    if (!validId(deviceId)) return frozen({ status: "disconnected", sampleCount: 0 });
    const device = registry.getByDevice(deviceId);
    if (device === null) return frozen({ status: "disconnected", sampleCount: 0 });
    try { return copyProbeReport(await server.measureLink(device.connectionId)); }
    catch { return frozen({ status: "unavailable", sampleCount: 0 }); }
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
    measurePhoneLink,
    latestTelemetry: (deviceId: string): RelayTelemetrySnapshot | null => {
      if (!validId(deviceId)) return null;
      const device = registry.getByDevice(deviceId); if (!device) return null;
      const value = intake.get(device.connectionId); return value ? frozen({ deviceId, sessionId: device.sessionId, payload: value.payload, capabilities: value.capabilities, receivedAtMs: value.receivedAtMs }) : null;
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
