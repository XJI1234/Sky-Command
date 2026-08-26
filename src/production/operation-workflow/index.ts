import { AssignmentRegistry } from "./assignment-registry/index.js";
import { WorkflowSnapshot } from "./workflow-snapshot/index.js";
import { WorkflowSubscriptions } from "./workflow-subscriptions/index.js";
import { WorkflowActions } from "./workflow-actions/index.js";
import { CapabilityGate } from "../../modules/device-console/index.js";
import { HardwareReadiness, type HardwareReadinessResult, type HardwareReadinessTarget } from "../../modules/hardware-readiness/index.js";

type RecordValue = Record<string, unknown>;
interface Dependencies {
  readonly relayOperations: RecordValue; readonly routeLibrary: RecordValue; readonly missionControl: RecordValue;
  readonly liveStreamControl: RecordValue; readonly mediaPipeline: RecordValue; readonly flightControl: RecordValue;
  readonly deviceSettings: RecordValue; readonly whipStreamControl?: RecordValue; readonly now: () => number;
  readonly hardwareReadiness: RecordValue;
}
type WorkflowResult = Readonly<{ readonly ok: true; readonly value?: unknown }> | Readonly<{ readonly ok: false; readonly code: string; readonly value?: unknown }>;
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
const record = (value: unknown): RecordValue | null => value !== null && typeof value === "object" ? value as RecordValue : null;
const read = (value: unknown, key: string): unknown => { try { return record(value)?.[key]; } catch { return undefined; } };
const success = (value?: unknown): WorkflowResult => freeze({ ok: true as const, ...(value === undefined ? {} : { value }) });
const failure = (code: string, value?: unknown): WorkflowResult => freeze({ ok: false as const, code, ...(value === undefined ? {} : { value }) });
const invoke = async (target: unknown, method: string, ...args: unknown[]): Promise<WorkflowResult> => {
  const operation = read(target, method);
  if (typeof operation !== "function") return failure("DEPENDENCY_FAILURE");
  try { return success(await operation(...args)); } catch { return failure("DEPENDENCY_FAILURE"); }
};

function create(dependencies: Dependencies) {
  const assignments = AssignmentRegistry.create();
  const pending = new Map<string, string>();
  const listeners = new Set<(snapshot: unknown) => void>();
  let selectedRouteId: string | null = null;
  let selectedVideoDeviceId: string | null = null;
  let revision = 0;
  let disposed = false;
  const deviceRecords = (): readonly Readonly<{ readonly deviceId: string; readonly sessionId: string | undefined }>[] => {
    const devices = read(dependencies.relayOperations, "devices");
    if (typeof devices !== "function") return freeze([]);
    try {
      const values = devices();
      if (!Array.isArray(values)) return freeze([]);
      return freeze(values.flatMap((item) => {
        const deviceId = read(item, "deviceId");
        if (!validId(deviceId)) return [];
        const sessionId = read(item, "sessionId");
        return [freeze({ deviceId, sessionId: validId(sessionId) ? sessionId : undefined })];
      }).sort((left, right) => left.deviceId.localeCompare(right.deviceId)));
    } catch { return freeze([]); }
  };
  const onlineIds = (): readonly string[] => freeze(deviceRecords().map((item) => item.deviceId));
  const sessionMap = (): Map<string, string | undefined> => new Map(deviceRecords().map((item) => [item.deviceId, item.sessionId]));
  const clock = (): number | null => {
    try {
      const value = dependencies.now();
      return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
    } catch { return null; }
  };
  let previousOnline = new Set(onlineIds());
  let previousSessions = sessionMap();
  const connectedSince = new Map<string, number>();
  const initialConnectionTime = clock();
  if (initialConnectionTime !== null) for (const deviceId of previousOnline) connectedSince.set(deviceId, initialConnectionTime);
  const online = (deviceId: string): boolean => onlineIds().includes(deviceId);
  const route = (routeId: string): RecordValue | null => {
    const list = read(dependencies.routeLibrary, "list");
    if (typeof list !== "function") return null;
    try { const values = list(); return Array.isArray(values) ? record(values.find((value) => read(value, "routeId") === routeId)) : null; } catch { return null; }
  };
  const task = (deviceId: string): unknown => { const get = read(dependencies.missionControl, "get"); try { return typeof get === "function" ? get(deviceId) : freeze({ deviceId, phase: "idle" }); } catch { return freeze({ deviceId, phase: "idle" }); } };
  const stream = (deviceId: string): unknown => { const get = read(dependencies.liveStreamControl, "get"); try { return typeof get === "function" ? get(deviceId) : freeze({ deviceId, phase: "idle" }); } catch { return freeze({ deviceId, phase: "idle" }); } };
  const whipStream = (deviceId: string): unknown => { const get = read(dependencies.whipStreamControl, "get"); try { return typeof get === "function" ? get(deviceId) : freeze({ deviceId, phase: "idle", lastOperation: null, failureCode: null, reason: null }); } catch { return freeze({ deviceId, phase: "idle", lastOperation: null, failureCode: null, reason: null }); } };
  const telemetry = (deviceId: string): unknown => { const get = read(dependencies.relayOperations, "telemetry"); try { return typeof get === "function" ? get(deviceId) : null; } catch { return null; } };
  const settings = (deviceId: string): unknown => { const get = read(dependencies.deviceSettings, "snapshot"); try { return typeof get === "function" ? get(deviceId) : freeze({}); } catch { return freeze({}); } };
  const media = (): unknown => { const snapshot = read(dependencies.mediaPipeline, "snapshot"); try { return typeof snapshot === "function" ? snapshot() : freeze({ streams: [] }); } catch { return freeze({ streams: [] }); } };
  const snapshot = () => WorkflowSnapshot.create({ devices: onlineIds().map((deviceId) => freeze({ deviceId, telemetry: telemetry(deviceId), assignment: freeze({ routeId: assignments.get(deviceId), routeName: read(route(assignments.get(deviceId) ?? ""), "displayName") ?? null }), mission: task(deviceId), stream: stream(deviceId), whipStream: whipStream(deviceId), settings: settings(deviceId), pendingFlightAction: (() => { const get = read(dependencies.flightControl, "get"); try { return typeof get === "function" ? get(deviceId) : null; } catch { return null; } })() })), routes: (() => { const list = read(dependencies.routeLibrary, "list"); try { return typeof list === "function" && Array.isArray(list()) ? list() : []; } catch { return []; } })(), selectedRouteId, selectedVideoDeviceId, revision, media: media(), disposed });
  const publish = (): void => { revision += 1; const current = snapshot(); for (const listener of [...listeners]) { try { listener(current); } catch { /* listener faults are isolated */ } } };
  const forgetVideo = (deviceId: string): void => {
    const disconnected = read(dependencies.liveStreamControl, "recordDisconnected"); try { if (typeof disconnected === "function") disconnected(deviceId); } catch { /* downstream retains its own failure state */ }
    const whipDisconnected = read(dependencies.whipStreamControl, "recordDisconnected"); try { if (typeof whipDisconnected === "function") whipDisconnected(deviceId); } catch { /* downstream retains its own failure state */ }
    if (selectedVideoDeviceId === deviceId) selectedVideoDeviceId = null;
  };
  const onDisconnects = (): void => {
    const current = new Set(onlineIds());
    const sessions = sessionMap();
    const observedAt = clock();
    for (const deviceId of previousOnline) {
      const gone = !current.has(deviceId);
      const previousSession = previousSessions.get(deviceId);
      const nextSession = sessions.get(deviceId);
      const replaced = !gone && previousSession !== undefined && nextSession !== undefined && previousSession !== nextSession;
      if (!gone && !replaced) continue;
      if (gone) {
        connectedSince.delete(deviceId);
        assignments.removeDevice(deviceId);
        const confirmationId = pending.get(deviceId);
        if (confirmationId !== undefined) { pending.delete(deviceId); const cancel = read(dependencies.flightControl, "cancel"); try { if (typeof cancel === "function") void cancel(deviceId, confirmationId); } catch { /* a disconnect still clears local state */ } }
        const clear = read(dependencies.flightControl, "clear"); try { if (typeof clear === "function") clear(deviceId); } catch { /* leftover confirmations must not survive reconnect */ }
      }
      forgetVideo(deviceId);
    }
    for (const deviceId of current) {
      const replaced = previousOnline.has(deviceId) && previousSessions.get(deviceId) !== undefined && sessions.get(deviceId) !== undefined && previousSessions.get(deviceId) !== sessions.get(deviceId);
      if (!previousOnline.has(deviceId) || replaced) {
        if (observedAt === null) connectedSince.delete(deviceId);
        else connectedSince.set(deviceId, observedAt);
      }
    }
    previousOnline = current;
    previousSessions = sessions;
    publish();
  };
  const subscriptions = WorkflowSubscriptions.create([dependencies.relayOperations, dependencies.missionControl, dependencies.liveStreamControl, dependencies.flightControl, ...(dependencies.whipStreamControl === undefined ? [] : [dependencies.whipStreamControl])], onDisconnects);
  const mission = async (method: "stage" | "upload" | "start" | "pause" | "resume" | "stop", deviceId: string): Promise<WorkflowResult> => {
    if (disposed) return failure("DISPOSED");
    const result = method === "stage" ? await actions.stage(deviceId) : await actions.mission(method, deviceId);
    publish(); return result;
  };
  const stableTask = (deviceId: string): boolean => ["idle", "completed", "failed", "disconnected"].includes(read(task(deviceId), "phase") as string);
  const settingsAllowed = (deviceId: string, operation: "transmission-settings" | "camera-settings"): boolean => {
    const value = telemetry(deviceId);
    const payload = read(value, "payload");
    const capabilities = read(value, "capabilities");
    const decision = CapabilityGate.evaluate({ operation, relayConnected: value !== null, sdkRegistered: read(payload, "sdkRegistered"), remoteControllerConnected: read(payload, "remoteControllerConnected"), flightControllerConnected: read(payload, "flightControllerConnected"), aircraftConnected: read(payload, "connected"), capabilities });
    return decision.ok === true && decision.value.enabled === true;
  };
  const readiness = (deviceId: string, target: HardwareReadinessTarget): HardwareReadinessResult => {
    const configuration = record(dependencies.hardwareReadiness);
    const configuredDelay = read(configuration, "sessionStableAfterMs");
    const observedAt = clock();
    const connectedAt = connectedSince.get(deviceId);
    const waited = observedAt !== null && connectedAt !== undefined && typeof configuredDelay === "number" && Number.isFinite(configuredDelay) && configuredDelay >= 0 && observedAt - connectedAt >= configuredDelay;
    const payload = record(read(telemetry(deviceId), "payload")) ?? freeze({});
    const payloadFacts: Record<string, boolean> = {};
    for (const key of ["sdkRegistered", "remoteControllerConnected", "flightControllerConnected", "connected"]) {
      const value = read(payload, key);
      if (typeof value === "boolean") payloadFacts[key] = value;
    }
    const factsComplete = payloadFacts.sdkRegistered === true
      && payloadFacts.remoteControllerConnected === true
      && payloadFacts.flightControllerConnected === true
      && payloadFacts.connected === true;
    const relayStable = factsComplete || waited;
    return HardwareReadiness.evaluate({
      desktop: {
        lanAddressAvailable: read(configuration, "lanAddressAvailable") as boolean,
        legacyMediaAvailable: read(configuration, "legacyMediaAvailable") as boolean,
      },
      relayConnected: online(deviceId),
      relayStable,
      payload: payloadFacts,
    }, target);
  };
  const readinessSummary = (deviceId: string): Readonly<{ readonly ok: boolean; readonly legacyVideo: HardwareReadinessResult; readonly flightControl: HardwareReadinessResult; readonly blockers: readonly unknown[] }> => {
    const legacyVideo = readiness(deviceId, "legacy-video");
    const flightControl = readiness(deviceId, "flight-control");
    const seen = new Set<string>();
    const blockers: unknown[] = [];
    for (const result of [legacyVideo, flightControl]) for (const blocker of result.blockers) if (!seen.has(blocker.code)) { seen.add(blocker.code); blockers.push(blocker); }
    return freeze({ ok: legacyVideo.ok && flightControl.ok, legacyVideo, flightControl, blockers: freeze(blockers) });
  };
  const actions = WorkflowActions.create({
    online,
    assignedRoute: (deviceId) => assignments.get(deviceId),
    missionControl: dependencies.missionControl,
    liveStreamControl: dependencies.liveStreamControl,
    deviceSettings: dependencies.deviceSettings,
    flightControl: dependencies.flightControl,
    settingsAllowed,
  });
  const published = async (operation: () => Promise<WorkflowResult>): Promise<WorkflowResult> => {
    const result = await operation();
    publish();
    return result;
  };
  const stopFailedOnlineStreams = async (): Promise<void> => {
    let streams: unknown[] = [];
    try {
      const listed = read(media(), "streams");
      streams = Array.isArray(listed) ? listed : [];
    } catch { return; }
    for (const entry of streams) {
      const deviceId = read(entry, "deviceId");
      if (!validId(deviceId) || read(entry, "phase") !== "failed" || !online(deviceId)) continue;
      const phase = read(stream(deviceId), "phase");
      if (phase !== "starting" && phase !== "streaming") continue;
      try { await actions.stopStream(deviceId); } catch { /* isolate a single failed-lane stop */ }
    }
  };
  return freeze({
    snapshot,
    subscribe: (listener: (snapshot: unknown) => void) => { if (disposed) return () => undefined; listeners.add(listener); let active = true; return () => { if (active) { active = false; listeners.delete(listener); } }; },
    importRoute: async (input: unknown, cancellation?: unknown): Promise<WorkflowResult> => { if (disposed) return failure("DISPOSED"); const result = await invoke(dependencies.routeLibrary, "importFile", input, cancellation); publish(); return result; },
    getRoutePreview: (routeId: string): WorkflowResult => { if (disposed) return failure("DISPOSED"); if (!validId(routeId)) return failure("INVALID_INPUT"); const preview = read(dependencies.routeLibrary, "getPreview"); if (typeof preview !== "function") return failure("DEPENDENCY_FAILURE"); try { return success(preview(routeId)); } catch { return failure("DEPENDENCY_FAILURE"); } },
    selectRoute: (routeId: string): WorkflowResult => {
      if (disposed) return failure("DISPOSED");
      if (!validId(routeId)) return failure("INVALID_INPUT");
      const select = read(dependencies.routeLibrary, "select");
      if (typeof select !== "function") return failure("DEPENDENCY_FAILURE");
      try {
        const outcome = select(routeId);
        if (read(outcome, "ok") !== true) return failure("ROUTE_NOT_FOUND");
        selectedRouteId = routeId;
        publish();
        return success(outcome);
      } catch { return failure("DEPENDENCY_FAILURE"); }
    },
    removeRoute: (routeId: string): WorkflowResult => { if (disposed) return failure("DISPOSED"); if (!validId(routeId)) return failure("INVALID_INPUT"); if (assignments.routesInUse(routeId).length > 0) return failure("ROUTE_ASSIGNED"); const remove = read(dependencies.routeLibrary, "remove"); if (typeof remove !== "function") return failure("DEPENDENCY_FAILURE"); try { const outcome = remove(routeId); if (read(outcome, "ok") !== true) return failure("ROUTE_NOT_FOUND"); if (selectedRouteId === routeId) { const remainingId = read(read(outcome, "value"), "routeId"); selectedRouteId = validId(remainingId) ? remainingId : null; } publish(); return success(outcome); } catch { return failure("DEPENDENCY_FAILURE"); } },
    assignRoute: (deviceId: string, routeId: string): WorkflowResult => { if (disposed) return failure("DISPOSED"); if (!validId(deviceId) || !validId(routeId)) return failure("INVALID_INPUT"); if (!online(deviceId)) return failure("DEVICE_OFFLINE"); if (!stableTask(deviceId)) return failure("TASK_ACTIVE"); if (read(route(routeId), "classification") !== "upload-candidate") return failure("ROUTE_NOT_UPLOADABLE"); assignments.assign(deviceId, routeId); publish(); return success(); },
    clearAssignment: (deviceId: string): WorkflowResult => { if (disposed) return failure("DISPOSED"); if (!validId(deviceId)) return failure("INVALID_INPUT"); if (!stableTask(deviceId)) return failure("TASK_ACTIVE"); assignments.clear(deviceId); publish(); return success(); },
    stage: (deviceId: string) => mission("stage", deviceId), upload: (deviceId: string) => mission("upload", deviceId), start: (deviceId: string) => mission("start", deviceId), pause: (deviceId: string) => mission("pause", deviceId), resume: (deviceId: string) => mission("resume", deviceId), stop: (deviceId: string) => mission("stop", deviceId),
    startStream: (deviceId: string) => disposed ? Promise.resolve(failure("DISPOSED")) : published(async () => {
      if (!validId(deviceId) || !online(deviceId)) return actions.startStream(deviceId);
      const decision = readiness(deviceId, "legacy-video");
      return decision.ok ? actions.startStream(deviceId) : failure("HARDWARE_NOT_READY", decision);
    }),
    stopStream: (deviceId: string) => disposed ? Promise.resolve(failure("DISPOSED")) : published(() => actions.stopStream(deviceId)),
    checkHardwareReadiness: (deviceId: string): WorkflowResult => {
      if (disposed) return failure("DISPOSED");
      if (!validId(deviceId)) return failure("INVALID_INPUT");
      return success(readinessSummary(deviceId));
    },
    selectVideo: (deviceId: string): WorkflowResult => { if (disposed) return failure("DISPOSED"); if (!validId(deviceId)) return failure("INVALID_INPUT"); if (!online(deviceId)) return failure("DEVICE_OFFLINE"); const streams = read(media(), "streams"); const selected = Array.isArray(streams) && streams.some((entry) => read(entry, "deviceId") === deviceId && read(entry, "phase") === "ready"); if (!selected) return failure("VIDEO_NOT_READY"); const player = read(dependencies.mediaPipeline, "selectPlayer"); if (typeof player !== "function") return failure("DEPENDENCY_FAILURE"); try { const outcome = player(deviceId); selectedVideoDeviceId = deviceId; publish(); return success(outcome); } catch { return failure("DEPENDENCY_FAILURE"); } },
    clearVideo: (): WorkflowResult => { if (disposed) return failure("DISPOSED"); const clear = read(dependencies.mediaPipeline, "clearPlayer"); if (typeof clear !== "function") return failure("DEPENDENCY_FAILURE"); try { const outcome = clear(); selectedVideoDeviceId = null; publish(); return success(outcome); } catch { return failure("DEPENDENCY_FAILURE"); } },
    refreshMedia: (): WorkflowResult => {
      if (disposed) return failure("DISPOSED");
      let now: unknown;
      try { now = dependencies.now(); } catch { return failure("CLOCK_FAILURE"); }
      if (typeof now !== "number" || !Number.isFinite(now) || now < 0) return failure("CLOCK_FAILURE");
      const evaluate = read(dependencies.mediaPipeline, "evaluate");
      if (typeof evaluate !== "function") return failure("DEPENDENCY_FAILURE");
      try {
        const outcome = evaluate(now);
        void stopFailedOnlineStreams();
        publish();
        return success(outcome);
      } catch { return failure("DEPENDENCY_FAILURE"); }
    },
    notifyPlaylistReady: (deviceId: string): WorkflowResult => {
      if (disposed) return failure("DISPOSED");
      if (!validId(deviceId)) return failure("INVALID_INPUT");
      const notify = read(dependencies.mediaPipeline, "notifyPlaylistReady");
      if (typeof notify !== "function") return failure("DEPENDENCY_FAILURE");
      try { const outcome = notify(deviceId); publish(); return success(outcome); } catch { return failure("DEPENDENCY_FAILURE"); }
    },
    readTransmissionSettings: (deviceId: string) => disposed ? Promise.resolve(failure("DISPOSED")) : published(() => actions.readTransmission(deviceId)),
    writeTransmissionSettings: (deviceId: string, patch: unknown) => disposed ? Promise.resolve(failure("DISPOSED")) : published(() => actions.writeTransmission(deviceId, patch)),
    readCameraSettings: (deviceId: string) => disposed ? Promise.resolve(failure("DISPOSED")) : published(() => actions.readCamera(deviceId)),
    writeCameraSettings: (deviceId: string, patch: unknown) => disposed ? Promise.resolve(failure("DISPOSED")) : published(() => actions.writeCamera(deviceId, patch)),
    requestFlightAction: (deviceId: string, action: string): WorkflowResult => {
      if (disposed) return failure("DISPOSED");
      const decision = validId(deviceId) && online(deviceId) ? readiness(deviceId, "flight-control") : null;
      const result = decision !== null && !decision.ok ? failure("HARDWARE_NOT_READY", decision) : actions.requestFlight(deviceId, action);
      const outcome = read(result, "value");
      const confirmationId = read(read(outcome, "confirmation"), "confirmationId");
      if (result.ok && read(outcome, "ok") === true && validId(confirmationId)) pending.set(deviceId, confirmationId);
      publish();
      return result;
    },
    confirmFlightAction: async (deviceId: string, confirmationId: string): Promise<WorkflowResult> => {
      if (disposed) return failure("DISPOSED");
      const result = await actions.confirmFlight(deviceId, confirmationId);
      pending.delete(deviceId); publish(); return result;
    },
    cancelFlightAction: (deviceId: string, confirmationId: string): WorkflowResult => {
      if (disposed) return failure("DISPOSED");
      const result = actions.cancelFlight(deviceId, confirmationId);
      pending.delete(deviceId); publish(); return result;
    },
    forgetCompletedTask: (deviceId: string): WorkflowResult => { if (disposed) return failure("DISPOSED"); if (!validId(deviceId)) return failure("INVALID_INPUT"); if (!stableTask(deviceId)) return failure("TASK_ACTIVE"); const forget = read(dependencies.missionControl, "forget"); if (typeof forget !== "function") return failure("DEPENDENCY_FAILURE"); try { const forgotten = forget(deviceId); if (forgotten !== true) return failure("TASK_NOT_FORGETTABLE"); publish(); return success(); } catch { return failure("DEPENDENCY_FAILURE"); } },
    dispose: () => { if (disposed) return; disposed = true; subscriptions.dispose(); listeners.clear(); pending.clear(); selectedRouteId = null; selectedVideoDeviceId = null; }
  });
}

export const OperationWorkflow = freeze({ create });
