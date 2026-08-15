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
  const receiveRelaySnapshot = (snapshot: unknown): void => {
    if (disposed) return;
    const currentDevices = RelayDeviceSnapshotReader.read(snapshot);
    if (currentDevices === null) return;
    if (previousDevices !== null) {
      for (const deviceId of previousDevices) {
        if (!currentDevices.has(deviceId)) dispatcher.recordDisconnected(deviceId);
      }
    }
    previousDevices = currentDevices;
    const missionPhases = RelayMissionPhaseSnapshotReader.read(snapshot);
    if (missionPhases === null) return;
    for (const phase of missionPhases) {
      if (phase.phase === "ROUTE_EXECUTION_STARTED") dispatcher.recordExecutionStarted(phase.deviceId, phase.fileName);
    }
    const terminals = RelayMissionPhaseSnapshotReader.readTerminalStates(snapshot);
    if (terminals === null) return;
    for (const terminal of terminals) dispatcher.recordExecutionTerminal(terminal.deviceId, terminal.fileName, terminal.outcome);
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
