import { MissionDispatcher, type DispatchResult, type MissionDispatchSnapshot, type MissionDispatcherDependencies, type MissionDispatcherOptions, type MissionRelayGateway } from "./mission-dispatcher/index.js";
import { RelayDeviceSnapshotReader } from "./relay-device-snapshot/index.js";
import { RelayMissionPhaseSnapshotReader } from "./relay-mission-phase-snapshot/index.js";
import { PreflightCheck } from "./preflight-check/index.js";

export type { DispatchResult, MissionDispatchSnapshot } from "./mission-dispatcher/index.js";
export { PreflightCheck } from "./preflight-check/index.js";
export type { FlightActionPreflightAction, FlightActionPreflightInput, PreflightBlocker, PreflightResult } from "./preflight-check/index.js";

export interface MissionControlRelay extends MissionRelayGateway {
  readonly subscribe: (listener: (snapshot: unknown) => void) => () => void;
}
export interface MissionControlDependencies {
  readonly routeSource: MissionDispatcherDependencies["routeSource"];
  readonly relay: MissionControlRelay;
}
export interface MissionControlInstance {
  readonly stage: (deviceId: string, routeId: string) => Promise<DispatchResult>;
  readonly upload: (deviceId: string) => Promise<DispatchResult>;
  readonly start: (deviceId: string) => Promise<DispatchResult>;
  readonly pause: (deviceId: string) => Promise<DispatchResult>;
  readonly resume: (deviceId: string) => Promise<DispatchResult>;
  readonly stop: (deviceId: string) => Promise<DispatchResult>;
  readonly get: (deviceId: string) => MissionDispatchSnapshot;
  readonly list: () => readonly MissionDispatchSnapshot[];
  readonly forget: (deviceId: string) => boolean;
  readonly subscribe: (listener: (lanes: readonly MissionDispatchSnapshot[]) => void) => () => void;
  readonly dispose: () => void;
}

function freeze<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

class RelaySubscription {
  public constructor(private readonly unsubscribe: () => void) {}

  public dispose(): void {
    try {
      this.unsubscribe();
    } catch {
      // A relay teardown failure cannot make the desktop task lane observable again.
    }
  }
}

function subscribeSafely(relay: MissionControlRelay, listener: (snapshot: unknown) => void): RelaySubscription {
  try {
    return new RelaySubscription(relay.subscribe(listener));
  } catch {
    return new RelaySubscription(() => undefined);
  }
}

function create(dependencies: MissionControlDependencies, options: MissionDispatcherOptions): MissionControlInstance {
  const dispatcher = MissionDispatcher.create({ routeSource: dependencies.routeSource, relay: dependencies.relay }, options);
  let disposed = false;
  let previousDevices: ReadonlySet<string> | null = null;
  const previousSessions = new Map<string, string>();
  const appliedPhases = new Map<string, Readonly<{ readonly deviceGeneration: number; readonly missionRevision: number; readonly sequence: number }>>();
  const validSessionId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
  const sessionsOf = (snapshot: unknown): Map<string, string> => {
    const sessions = new Map<string, string>();
    try {
      const devices = (snapshot as { readonly devices?: unknown }).devices;
      if (!Array.isArray(devices)) return sessions;
      for (const device of devices) {
        const deviceId = (device as { readonly deviceId?: unknown }).deviceId;
        const sessionId = (device as { readonly sessionId?: unknown }).sessionId;
        if (typeof deviceId === "string" && validSessionId(sessionId)) sessions.set(deviceId, sessionId);
      }
    } catch {
      return sessions;
    }
    return sessions;
  };
  const stalePhase = (deviceId: string, phase: { readonly deviceGeneration: number; readonly missionRevision: number; readonly sequence: number }): boolean => {
    const applied = appliedPhases.get(deviceId);
    if (applied === undefined) return false;
    if (phase.deviceGeneration < applied.deviceGeneration) return true;
    if (phase.deviceGeneration === applied.deviceGeneration && phase.missionRevision < applied.missionRevision) return true;
    return phase.deviceGeneration === applied.deviceGeneration && phase.missionRevision === applied.missionRevision && phase.sequence <= applied.sequence;
  };
  const receiveRelaySnapshot = (snapshot: unknown): void => {
    if (disposed) return;
    const currentDevices = RelayDeviceSnapshotReader.read(snapshot);
    if (currentDevices === null) return;
    const currentSessions = sessionsOf(snapshot);
    if (previousDevices !== null) {
      for (const deviceId of previousDevices) {
        const sessionChanged = previousSessions.has(deviceId) && currentSessions.has(deviceId) && previousSessions.get(deviceId) !== currentSessions.get(deviceId);
        if (!currentDevices.has(deviceId) || sessionChanged) {
          appliedPhases.delete(deviceId);
          dispatcher.recordDisconnected(deviceId);
        }
      }
    }
    previousDevices = currentDevices;
    previousSessions.clear();
    for (const [deviceId, sessionId] of currentSessions) previousSessions.set(deviceId, sessionId);
    const missionPhases = RelayMissionPhaseSnapshotReader.read(snapshot);
    if (missionPhases === null) return;
    for (const phase of missionPhases) {
      if (stalePhase(phase.deviceId, phase)) continue;
      if (phase.phase === "ROUTE_EXECUTION_STARTED") {
        const applied = dispatcher.recordExecutionStarted(phase.deviceId, phase.fileName, phase.missionRevision, phase.deviceGeneration);
        if (applied !== null) appliedPhases.set(phase.deviceId, freeze({ deviceGeneration: phase.deviceGeneration, missionRevision: phase.missionRevision, sequence: phase.sequence }));
      }
    }
    const terminals = RelayMissionPhaseSnapshotReader.readTerminalStates(snapshot);
    if (terminals === null) return;
    for (const terminal of terminals) dispatcher.recordExecutionTerminal(terminal.deviceId, terminal.fileName, terminal.outcome, terminal.missionRevision, terminal.deviceGeneration);
  };
  const relaySubscription = subscribeSafely(dependencies.relay, receiveRelaySnapshot);
  return freeze({
    stage: dispatcher.stage,
    upload: dispatcher.upload,
    start: dispatcher.start,
    pause: dispatcher.pause,
    resume: dispatcher.resume,
    stop: dispatcher.stop,
    get: dispatcher.get,
    list: dispatcher.list,
    forget: dispatcher.forget,
    subscribe: dispatcher.subscribe,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      relaySubscription.dispose();
    }
  });
}

export const MissionControl = freeze({ create, PreflightCheck });
