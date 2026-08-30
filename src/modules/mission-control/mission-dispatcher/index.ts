import { MissionPhaseDomain, type MissionPhase, type MissionPhaseMachine } from "../mission-phase-domain/index.js";
import { PreflightCheck, type PreflightBlocker } from "../preflight-check/index.js";

export interface RouteMissionPayload {
  readonly routeId: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

export interface MissionRouteSource {
  readonly getMissionPayload: (routeId: string) =>
    | Readonly<{ readonly ok: true; readonly value: RouteMissionPayload }>
    | Readonly<{ readonly ok: false; readonly error: Readonly<{ readonly code: string }> }>;
}

export interface RelayMissionPayload {
  readonly missionId: string;
  readonly fileName: string;
  readonly size: number;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

export interface MissionSendOutcome {
  readonly deviceId: string;
  readonly missionId: string;
  readonly status: "succeeded" | "rejected" | "timed-out" | "disconnected" | "transport-failed";
  readonly detail: string;
}

export interface WaylineCommand { readonly name: "wayline.upload" | "wayline.start" | "wayline.pause" | "wayline.resume" | "wayline.stop"; readonly fields: Readonly<{ readonly confirm: true }>; }
export interface CommandSendOutcome { readonly deviceId: string; readonly commandId: string; readonly status: "succeeded" | "rejected" | "timed-out" | "disconnected" | "transport-failed"; readonly detail: string; }
export interface RelayTelemetry { readonly deviceId: string; readonly payload: Record<string, unknown>; readonly capabilities: Record<string, unknown>; }
export interface MissionRelayGateway {
  readonly sendMission: (deviceId: string, payload: RelayMissionPayload) => Promise<MissionSendOutcome>;
  readonly sendCommand: (deviceId: string, request: WaylineCommand) => Promise<CommandSendOutcome>;
  readonly latestTelemetry: (deviceId: string) => RelayTelemetry | null;
}

export interface MissionDispatcherDependencies { readonly routeSource: MissionRouteSource; readonly relay: MissionRelayGateway; }
export interface MissionDispatcherOptions { readonly createMissionId: (deviceId: string, routeId: string) => string; }
export type DispatchOperation = "stage" | "upload" | "start" | "pause" | "resume" | "stop";
export type DispatchErrorCode = "INVALID_DEVICE_ID" | "INVALID_ROUTE_ID" | "ROUTE_UNAVAILABLE" | "MISSION_ID_UNAVAILABLE" | "ILLEGAL_PHASE" | "OPERATION_IN_PROGRESS" | "DEPENDENCY_FAILURE" | "MISSION_TRANSFER_FAILED" | "WAYLINE_UPLOAD_FAILED" | "PREFLIGHT_BLOCKED" | "WAYLINE_START_FAILED" | "WAYLINE_START_UNCONFIRMED" | "WAYLINE_PAUSE_FAILED" | "WAYLINE_PAUSE_UNCONFIRMED" | "WAYLINE_RESUME_FAILED" | "WAYLINE_RESUME_UNCONFIRMED" | "WAYLINE_STOP_FAILED" | "WAYLINE_STOP_UNCONFIRMED";
export interface LastDispatchResult { readonly operation: DispatchOperation; readonly ok: boolean; readonly code: DispatchErrorCode | null; }
export interface MissionDispatchSnapshot { readonly deviceId: string; readonly routeId: string | null; readonly missionId: string | null; readonly phase: MissionPhase; readonly failureCode: string | null; readonly lastResult: LastDispatchResult | null; }
export type DispatchResult = Readonly<{ readonly ok: true; readonly operation: DispatchOperation; readonly state: MissionDispatchSnapshot }> | Readonly<{ readonly ok: false; readonly operation: DispatchOperation; readonly code: DispatchErrorCode; readonly state: MissionDispatchSnapshot | null; readonly blockers?: readonly PreflightBlocker[] }>;
export interface MissionDispatcherInstance {
  readonly stage: (deviceId: string, routeId: string) => Promise<DispatchResult>;
  readonly upload: (deviceId: string) => Promise<DispatchResult>;
  readonly start: (deviceId: string) => Promise<DispatchResult>;
  readonly pause: (deviceId: string) => Promise<DispatchResult>;
  readonly resume: (deviceId: string) => Promise<DispatchResult>;
  readonly stop: (deviceId: string) => Promise<DispatchResult>;
  readonly recordExecutionStarted: (deviceId: string, fileName: string, missionRevision: number, deviceGeneration: number) => MissionDispatchSnapshot | null;
  readonly recordExecutionTerminal: (deviceId: string, fileName: string, outcome: "completed" | "failed", missionRevision: number, deviceGeneration: number) => MissionDispatchSnapshot | null;
  readonly recordDisconnected: (deviceId: string) => MissionDispatchSnapshot | null;
  readonly get: (deviceId: string) => MissionDispatchSnapshot;
  readonly list: () => readonly MissionDispatchSnapshot[];
  readonly forget: (deviceId: string) => boolean;
  readonly subscribe: (listener: (snapshot: readonly MissionDispatchSnapshot[]) => void) => () => void;
}

interface MissionIdentity { readonly missionRevision: number; readonly deviceGeneration: number; }
interface Lane { readonly deviceId: string; readonly machine: MissionPhaseMachine; routeId: string | null; fileName: string | null; missionIdentity: MissionIdentity | null; busy: boolean; lastResult: LastDispatchResult | null; }

const COMMANDS = Object.freeze({ confirm: true as const });
const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
const validFileName = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && value.toLowerCase().endsWith(".kmz") && !value.includes("..") && !/[\\/\p{Cc}]/u.test(value);
const validPositiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const validGeneration = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const idleSnapshot = (deviceId: string): MissionDispatchSnapshot => freeze({ deviceId, routeId: null, missionId: null, phase: "idle", failureCode: null, lastResult: null });
type Attempt<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false }>;
const attempt = <T>(operation: () => T): Attempt<T> => {
  try { return freeze({ ok: true as const, value: operation() }); } catch { return freeze({ ok: false as const }); }
};
const succeeded = (value: unknown): boolean => {
  const status = attempt(() => {
    if (value === null || typeof value !== "object") return null;
    return (value as { status?: unknown }).status;
  });
  return status.ok && status.value === "succeeded";
};
const attemptAsync = async <T>(operation: () => Promise<T>): Promise<Attempt<T>> => {
  try { return freeze({ ok: true as const, value: await operation() }); } catch { return freeze({ ok: false as const }); }
};
const completeCommand = Object.freeze({
  upload: (machine: MissionPhaseMachine): void => { void machine.transition({ type: "upload-succeeded" }); },
  start: (_machine: MissionPhaseMachine): void => undefined,
  pause: (machine: MissionPhaseMachine): void => { void machine.transition({ type: "pause-succeeded" }); },
  resume: (machine: MissionPhaseMachine): void => { void machine.transition({ type: "resume-succeeded" }); },
  stop: (machine: MissionPhaseMachine): void => { void machine.transition({ type: "stop-succeeded" }); }
});
const unconfirmedCommandFailure = Object.freeze({
  pause: "WAYLINE_PAUSE_UNCONFIRMED" as const,
  resume: "WAYLINE_RESUME_UNCONFIRMED" as const,
  stop: "WAYLINE_STOP_UNCONFIRMED" as const
});
type RoutePayloadRead = RouteMissionPayload | null | "dependency-failure";
const readRoutePayload = (source: MissionRouteSource, routeId: string): RoutePayloadRead => {
  try {
    const outcome = source.getMissionPayload(routeId);
    if (outcome.ok !== true) return null;
    return outcome.value.bytes instanceof Uint8Array ? outcome.value : null;
  } catch { return "dependency-failure"; }
};
const readMissionId = (factory: MissionDispatcherOptions["createMissionId"], deviceId: string, routeId: string): Attempt<unknown> => {
  try { return freeze({ ok: true as const, value: factory(deviceId, routeId) }); } catch { return freeze({ ok: false as const }); }
};

function create(dependencies: MissionDispatcherDependencies, options: MissionDispatcherOptions): MissionDispatcherInstance {
  const lanes = new Map<string, Lane>();
  const listeners = new Set<(snapshot: readonly MissionDispatchSnapshot[]) => void>();
  const snapshot = (lane: Lane): MissionDispatchSnapshot => {
    const state = lane.machine.state();
    return freeze({ deviceId: lane.deviceId, routeId: lane.routeId, missionId: state.missionId, phase: state.phase, failureCode: state.failureCode, lastResult: lane.lastResult === null ? null : freeze({ ...lane.lastResult }) });
  };
  const list = (): readonly MissionDispatchSnapshot[] => freeze([...lanes.values()].map(snapshot));
  const publish = (): void => { const current = list(); for (const listener of [...listeners]) { try { listener(current); } catch { /* listener isolation */ } } };
  const result = (lane: Lane, operation: DispatchOperation, ok: boolean, code: DispatchErrorCode | null): DispatchResult => {
    lane.lastResult = freeze({ operation, ok, code });
    const state = snapshot(lane);
    publish();
    return ok ? freeze({ ok: true as const, operation, state }) : freeze({ ok: false as const, operation, code: code!, state });
  };
  const blocked = (lane: Lane, operation: "upload" | "start", blockers: readonly PreflightBlocker[]): DispatchResult => {
    lane.lastResult = freeze({ operation, ok: false, code: "PREFLIGHT_BLOCKED" });
    const state = snapshot(lane);
    publish();
    return freeze({ ok: false as const, operation, code: "PREFLIGHT_BLOCKED" as const, state, blockers: freeze(blockers.map((blocker) => freeze({ ...blocker }))) });
  };
  const rejected = (operation: DispatchOperation, code: DispatchErrorCode, lane: Lane | null): DispatchResult => lane === null ? freeze({ ok: false as const, operation, code, state: null }) : result(lane, operation, false, code);
  const get = (deviceId: string): MissionDispatchSnapshot => validId(deviceId) && lanes.has(deviceId) ? snapshot(lanes.get(deviceId)!) : idleSnapshot(typeof deviceId === "string" ? deviceId : "");

  const stage = async (deviceId: string, routeId: string): Promise<DispatchResult> => {
    if (!validId(deviceId)) return rejected("stage", "INVALID_DEVICE_ID", null);
    if (!validId(routeId)) return rejected("stage", "INVALID_ROUTE_ID", lanes.get(deviceId) ?? null);
    const existing = lanes.get(deviceId);
    if (existing?.busy) return rejected("stage", "OPERATION_IN_PROGRESS", existing);

    const routePayload = readRoutePayload(dependencies.routeSource, routeId);
    if (routePayload === "dependency-failure") return rejected("stage", "DEPENDENCY_FAILURE", existing ?? null);
    if (routePayload === null) return rejected("stage", "ROUTE_UNAVAILABLE", existing ?? null);
    const missionIdAttempt = readMissionId(options.createMissionId, deviceId, routeId);
    if (missionIdAttempt.ok === false) return rejected("stage", "DEPENDENCY_FAILURE", existing ?? null);
    const missionId = missionIdAttempt.value;
    if (!validId(missionId)) return rejected("stage", "MISSION_ID_UNAVAILABLE", existing ?? null);

    const lane = existing ?? { deviceId, machine: MissionPhaseDomain.create(), routeId: null, fileName: null, missionIdentity: null, lastResult: null } as Lane;
    const requested = lane.machine.transition({ type: "stage-requested", missionId });
    if (!requested.ok) return rejected("stage", "ILLEGAL_PHASE", lane);
    lane.routeId = routeId;
    lane.fileName = routePayload.fileName;
    lane.missionIdentity = null;
    lanes.set(deviceId, lane);
    lane.busy = true;
    publish();

    const payload: RelayMissionPayload = freeze({ missionId, fileName: routePayload.fileName, size: routePayload.sizeBytes, sha256: routePayload.sha256, bytes: routePayload.bytes.slice() });
    const sent = await attemptAsync(() => dependencies.relay.sendMission(deviceId, payload));
    lane.busy = false;
    if (sent.ok && succeeded(sent.value)) {
      lane.machine.transition({ type: "stage-succeeded", missionId });
      return result(lane, "stage", true, null);
    }
    lane.machine.transition({ type: "operation-failed", code: "MISSION_TRANSFER_FAILED" });
    return result(lane, "stage", false, "MISSION_TRANSFER_FAILED");
  };

  const performCommand = async (operation: Exclude<DispatchOperation, "stage">, deviceId: string, requestType: "upload-requested" | "start-requested" | "pause-requested" | "resume-requested" | "stop-requested", commandName: WaylineCommand["name"], failureCode: DispatchErrorCode): Promise<DispatchResult> => {
    if (!validId(deviceId)) return rejected(operation, "INVALID_DEVICE_ID", null);
    const lane = lanes.get(deviceId);
    if (!lane) return rejected(operation, "ILLEGAL_PHASE", null);
    if (lane.busy) return rejected(operation, "OPERATION_IN_PROGRESS", lane);
    if (operation === "upload" || operation === "start") {
      if (operation === "start" && lane.machine.state().phase !== "uploaded") return rejected(operation, "ILLEGAL_PHASE", lane);
      const telemetryAttempt = attempt(() => dependencies.relay.latestTelemetry(deviceId));
      if (!telemetryAttempt.ok) return rejected(operation, "DEPENDENCY_FAILURE", lane);
      const telemetry = telemetryAttempt.value;
      const preflightAttempt = attempt(() => {
        const input = { relayConnected: telemetry !== null, payload: telemetry?.payload ?? {}, capabilities: telemetry?.capabilities ?? {}, missionPhase: lane.machine.state().phase };
        return operation === "upload" ? PreflightCheck.evaluateUpload(input) : PreflightCheck.evaluate(input);
      });
      if (!preflightAttempt.ok) return rejected(operation, "DEPENDENCY_FAILURE", lane);
      const preflight = preflightAttempt.value;
      if (!preflight.ok) return blocked(lane, operation, preflight.blockers);
    }
    const requested = lane.machine.transition({ type: requestType });
    if (!requested.ok) return rejected(operation, "ILLEGAL_PHASE", lane);
    lane.busy = true;
    publish();
    const sent = await attemptAsync(() => dependencies.relay.sendCommand(deviceId, { name: commandName, fields: COMMANDS }));
    lane.busy = false;
    if (sent.ok && succeeded(sent.value)) {
      completeCommand[operation](lane.machine);
      return result(lane, operation, true, null);
    }
    if (operation === "start") {
      if (lane.machine.state().phase !== "starting") return result(lane, operation, true, null);
      return result(lane, operation, false, "WAYLINE_START_UNCONFIRMED");
    }
    if (operation === "pause" || operation === "resume" || operation === "stop") {
      return result(lane, operation, false, unconfirmedCommandFailure[operation]);
    }
    lane.machine.transition({ type: "operation-failed", code: failureCode });
    return result(lane, operation, false, failureCode);
  };
  const forget = (deviceId: string): boolean => {
    const lane = lanes.get(deviceId); if (!lane || !["idle", "completed", "failed", "disconnected"].includes(lane.machine.state().phase)) return false;
    lanes.delete(deviceId); publish(); return true;
  };
  const recordDisconnected = (deviceId: string): MissionDispatchSnapshot | null => {
    const lane = lanes.get(deviceId);
    if (!lane) return null;
    const changed = lane.machine.transition({ type: "connection-lost" });
    if (!changed.ok) return null;
    lane.busy = false;
    const state = snapshot(lane);
    publish();
    return state;
  };
  const recordExecutionStarted = (deviceId: string, fileName: string, missionRevision: number, deviceGeneration: number): MissionDispatchSnapshot | null => {
    if (!validId(deviceId) || !validFileName(fileName) || !validPositiveInteger(missionRevision) || !validGeneration(deviceGeneration)) return null;
    const lane = lanes.get(deviceId);
    if (!lane || lane.fileName !== fileName || lane.machine.state().phase !== "starting") return null;
    const changed = lane.machine.transition({ type: "start-succeeded" });
    /* c8 ignore next -- this transition is guarded by the immediately preceding phase check. */
    if (!changed.ok) return null;
    lane.missionIdentity = freeze({ missionRevision, deviceGeneration });
    const state = snapshot(lane);
    publish();
    return state;
  };
  const recordExecutionTerminal = (deviceId: string, fileName: string, outcome: "completed" | "failed", missionRevision: number, deviceGeneration: number): MissionDispatchSnapshot | null => {
    if (!validId(deviceId) || !validFileName(fileName) || !validPositiveInteger(missionRevision) || !validGeneration(deviceGeneration) || (outcome !== "completed" && outcome !== "failed")) return null;
    const lane = lanes.get(deviceId);
    const identity = lane?.missionIdentity;
    if (!lane || !identity || lane.busy || lane.fileName !== fileName || identity.missionRevision !== missionRevision || identity.deviceGeneration !== deviceGeneration) return null;
    const current = lane.machine.state().phase;
    const changed = outcome === "completed"
      ? (["starting", "running", "disconnected"].includes(current) ? lane.machine.transition({ type: "mission-completed" }) : null)
      : (["staging", "uploading", "starting", "running", "pausing", "paused", "resuming", "stopping", "disconnected"].includes(current) ? lane.machine.transition({ type: "operation-failed", code: "MISSION_EXECUTION_FAILED" }) : null);
    if (changed === null || !changed.ok) return null;
    const state = snapshot(lane);
    publish();
    return state;
  };
  return freeze({
    stage,
    upload: (deviceId) => performCommand("upload", deviceId, "upload-requested", "wayline.upload", "WAYLINE_UPLOAD_FAILED"),
    start: (deviceId) => performCommand("start", deviceId, "start-requested", "wayline.start", "WAYLINE_START_FAILED"),
    pause: (deviceId) => performCommand("pause", deviceId, "pause-requested", "wayline.pause", "WAYLINE_PAUSE_FAILED"),
    resume: (deviceId) => performCommand("resume", deviceId, "resume-requested", "wayline.resume", "WAYLINE_RESUME_FAILED"),
    stop: (deviceId) => performCommand("stop", deviceId, "stop-requested", "wayline.stop", "WAYLINE_STOP_FAILED"),
    get, list, forget, recordDisconnected, recordExecutionStarted, recordExecutionTerminal,
    subscribe: (listener) => { listeners.add(listener); let active = true; return () => { if (active) { active = false; listeners.delete(listener); } }; }
  });
}

export const MissionDispatcher = freeze({ create });
