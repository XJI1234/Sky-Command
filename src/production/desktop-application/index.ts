import { RelayDeviceSettings } from "../../adapters/relay-device-settings/index.js";
import { DeviceConsole } from "../../modules/device-console/index.js";
import { FlightControl, FlightCommandDispatcher, type FlightControlOptions } from "../../modules/flight-control/index.js";
import { LiveStreamControl } from "../../modules/live-stream-control/index.js";
import { MediaPipeline, type MediaPipelineDependencies, type MediaPipelineOptions } from "../../modules/media-pipeline/index.js";
import { MissionControl } from "../../modules/mission-control/index.js";
import type { MissionDispatcherOptions } from "../../modules/mission-control/mission-dispatcher/index.js";
import { NetworkSettings, type NetworkSettingsValue } from "../../modules/desktop-settings/network-settings/index.js";
import { RouteLibrary, type RouteLibraryCreateOptions } from "../../modules/route-library/index.js";
import type { JsonObject, JsonValue } from "../../modules/relay-link/protocol-core/index.js";
import { DesktopRuntime, type DesktopRuntimeCode, type DesktopRuntimeInstance } from "../desktop-runtime/index.js";
import { NodeRuntime, type NodeRelayOptions } from "../node-runtime/index.js";
import { OperationWorkflow } from "../operation-workflow/index.js";
import { RelayOperationsAdapter, type RelaySettingsGateway as AdapterRelaySettingsGateway } from "../relay-operations-adapter/index.js";

export type DesktopApplicationPhase = "idle" | "starting" | "running" | "stopping" | "disposed";
export type DesktopApplicationCode = "INVALID_CONFIGURATION" | "ALREADY_RUNNING" | "NOT_RUNNING" | "OPERATION_IN_PROGRESS" | "DISPOSED" | DesktopRuntimeCode | "DEPENDENCY_FAILURE";

export interface DesktopApplicationOptions {
  readonly network: NetworkSettingsValue;
  readonly relay: NodeRelayOptions;
  readonly routeLibrary?: RouteLibraryCreateOptions;
  readonly media: Readonly<{
    readonly dependencies: MediaPipelineDependencies;
    readonly options: MediaPipelineOptions;
    readonly startInput: unknown;
  }>;
  readonly legacyMediaRequired?: boolean;
  readonly mission: MissionDispatcherOptions;
  readonly flight: FlightControlOptions;
  readonly hardwareReadiness: Readonly<{
    readonly lanAddressAvailable: boolean;
    readonly legacyMediaAvailable: boolean;
    readonly sessionStableAfterMs: number;
  }>;
  readonly now: () => number;
}

export interface DesktopApplicationSnapshot {
  readonly phase: DesktopApplicationPhase;
  readonly revision: number;
  readonly runtime: unknown;
  readonly workflow: unknown;
}

export type DesktopApplicationResult =
  | Readonly<{ readonly ok: true; readonly value: DesktopApplicationSnapshot }>
  | Readonly<{ readonly ok: false; readonly code: DesktopApplicationCode; readonly value: DesktopApplicationSnapshot }>;
export type DesktopApplicationCreateResult =
  | Readonly<{ readonly ok: true; readonly value: DesktopApplicationInstance }>
  | Readonly<{ readonly ok: false; readonly code: "INVALID_CONFIGURATION" | "DEPENDENCY_FAILURE" }>;

export interface DesktopApplicationInstance {
  readonly start: () => Promise<DesktopApplicationResult>;
  readonly stop: () => Promise<DesktopApplicationResult>;
  readonly snapshot: () => DesktopApplicationSnapshot;
  readonly subscribe: (listener: (snapshot: DesktopApplicationSnapshot) => void) => () => void;
  readonly workflow: () => ReturnType<typeof OperationWorkflow.create>;
  readonly dispose: () => Promise<void>;
}

type Operation = "start" | "stop" | null;
type AdapterSettingsFields = Parameters<AdapterRelaySettingsGateway["sendCommand"]>[1]["fields"];
type AdapterSettingsCommand = Parameters<AdapterRelaySettingsGateway["sendCommand"]>[1]["name"];

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
const validFunction = (value: unknown): value is () => unknown => typeof value === "function";
const hiddenSnapshotKeys = new Set(["endpoint", "playbackUrl", "diagnostic", "path", "filePath", "localAddress", "token", "credential", "password"]);
const copy = (value: unknown): unknown => {
  try { return structuredClone(value); }
  /* c8 ignore next -- 内部快照契约只含可结构化克隆值；异常仍需安全降级。 */
  catch { return null; }
};
const publicSnapshot = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (value === null || typeof value !== "object") return value;
  /* c8 ignore next -- 业务快照契约只产生无环值；循环保护保留用于未来适配器故障隔离。 */
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) return freeze(value.map((item) => publicSnapshot(item, seen)));
  const source = record(value);
  /* c8 ignore next -- record 对所有非数组对象均返回对象，此分支仅是类型防御。 */
  if (source === null) return null;
  let names: string[];
  try { names = Object.keys(source); }
  /* c8 ignore next -- 生产快照是普通对象；代理 ownKeys 异常仅是防御性降级。 */
  catch { return null; }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const name of names) if (!hiddenSnapshotKeys.has(name)) {
    try { result[name] = publicSnapshot(source[name], seen); }
    /* c8 ignore next -- 生产快照字段没有恶意 getter；异常字段仍被隔离为 null。 */
    catch { result[name] = null; }
  }
  return freeze(result);
};
/* c8 ignore next -- 设置面板只会发出标量字段；递归拒绝数组是跨边界的防御保护。 */
const noArrayJson = (value: JsonValue): boolean => value.kind !== "array" && (value.kind !== "object" || Object.values(value.fields).every(noArrayJson));
/* c8 ignore next -- 上游设置面板已完成字段类型约束，非法 JSON 仅能由越权内部调用构造。 */
const compatibleSettingsFields = (value: JsonObject["fields"]): AdapterSettingsFields | null => Object.values(value).every(noArrayJson) ? value as unknown as AdapterSettingsFields : null;
/* c8 ignore next -- 调用方类型已限定四个设置命令；未知命令由此防御性拒绝。 */
const settingsCommand = (value: string): AdapterSettingsCommand | null => value === "device.settings.camera.read" || value === "device.settings.camera.write" || value === "device.settings.transmission.read" || value === "device.settings.transmission.write" ? value : null;
const isOptions = (value: unknown): value is DesktopApplicationOptions => {
  try {
    const source = record(value);
    const media = record(source?.media);
    const hardwareReadiness = record(source?.hardwareReadiness);
    return source !== null
      && record(source.network) !== null
      && record(source.relay) !== null
      && media !== null
      && record(media.dependencies) !== null
      && record(media.options) !== null
      && record(media.startInput) !== null
      && (source.legacyMediaRequired === undefined || typeof source.legacyMediaRequired === "boolean")
      && record(source.mission) !== null
      && record(source.flight) !== null
      && hardwareReadiness !== null
      && typeof hardwareReadiness.lanAddressAvailable === "boolean"
      && typeof hardwareReadiness.legacyMediaAvailable === "boolean"
      && typeof hardwareReadiness.sessionStableAfterMs === "number"
      && Number.isFinite(hardwareReadiness.sessionStableAfterMs)
      && hardwareReadiness.sessionStableAfterMs >= 0
      && validFunction(source.now)
      && validFunction(record(source.mission)?.createMissionId)
      && validFunction(record(source.flight)?.now)
      && record(record(source.flight)?.confirmation) !== null;
  } catch {
    return false;
  }
};
const result = (ok: boolean, value: DesktopApplicationSnapshot, code?: DesktopApplicationCode): DesktopApplicationResult => ok
  ? freeze({ ok: true as const, value })
  : freeze({ ok: false as const, code: code!, value });

function create(raw: unknown): DesktopApplicationCreateResult {
  if (!isOptions(raw)) return freeze({ ok: false as const, code: "INVALID_CONFIGURATION" as const });
  const network = NetworkSettings.create(raw.network);
  if (!network.ok) return freeze({ ok: false as const, code: "INVALID_CONFIGURATION" as const });
  const options = raw;
  try {
    const routeCreated = RouteLibrary.create(options.routeLibrary);
    if (!routeCreated.ok) return freeze({ ok: false as const, code: "INVALID_CONFIGURATION" as const });
    const relay = NodeRuntime.createRelay({
      ...options.relay,
      address: freeze({ host: options.relay.address.host, port: network.value.relayPort }),
    });
    const operations = RelayOperationsAdapter.create({ relay });
    const settingsGateway = operations.settingsGateway();
    const deviceSettings = DeviceConsole.DeviceSettingsPanel.create({
      port: RelayDeviceSettings.create({
        relay: {
          sendCommand: (deviceId, request) => {
            const fields = compatibleSettingsFields(request.fields);
            const name = settingsCommand(request.name);
            /* c8 ignore next -- 面板字段和命令名已由上游契约限定，越权调用仍必须拒绝。 */
            if (fields === null || name === null) return Promise.resolve(freeze({ status: "rejected" as const, detail: "设置命令无效" }));
            return settingsGateway.sendCommand(deviceId, freeze({ name, fields }));
          }
        }
      })
    });
    const missionControl = MissionControl.create({
      routeSource: routeCreated.value,
      relay: freeze({ ...operations.missionGateway(), subscribe: operations.subscribe })
    }, options.mission);
    const mediaPipeline = MediaPipeline.create(options.media.dependencies, {
      ...options.media.options,
      rtmpPort: network.value.listenPort,
    });
    const liveStreamControl = LiveStreamControl.create({
      media: mediaPipeline,
      relay: operations.streamGateway(),
      capabilityGate: DeviceConsole.CapabilityGate,
    });
    const flightControl = FlightControl.create({
      dispatcher: FlightCommandDispatcher.create({
        relay: operations.flightGateway(),
        preflight: { evaluateFlightAction: (input) => MissionControl.PreflightCheck.evaluateFlightAction(input as never) },
        capabilityGate: DeviceConsole.CapabilityGate,
      })
    }, options.flight);
    const runtime = DesktopRuntime.create({
      relay: freeze({
        start: relay.start,
        stop: relay.stop,
        snapshot: () => freeze({ devices: relay.devices() }),
        subscribe: relay.subscribe,
      }),
      media: mediaPipeline,
      live: liveStreamControl,
    }, {
      mediaStartInput: freeze({ ...(options.media.startInput as object), manualHost: network.value.manualHost }),
      ...(options.legacyMediaRequired === undefined ? {} : { mediaRequired: options.legacyMediaRequired }),
    });
    const workflow = OperationWorkflow.create({
      relayOperations: operations,
      routeLibrary: routeCreated.value,
      missionControl,
      liveStreamControl,
      mediaPipeline,
      flightControl,
      deviceSettings,
      hardwareReadiness: options.hardwareReadiness,
      now: options.now,
    });
    return freeze({ ok: true as const, value: instance({ runtime, workflow, operations, routeLibrary: routeCreated.value, missionControl, flightControl }) });
  } catch {
    return freeze({ ok: false as const, code: "DEPENDENCY_FAILURE" as const });
  }
}

function instance(dependencies: Readonly<{
  readonly runtime: DesktopRuntimeInstance;
  readonly workflow: ReturnType<typeof OperationWorkflow.create>;
  readonly operations: ReturnType<typeof RelayOperationsAdapter.create>;
  readonly routeLibrary: Exclude<ReturnType<typeof RouteLibrary.create>, { readonly ok: false }>['value'];
  readonly missionControl: ReturnType<typeof MissionControl.create>;
  readonly flightControl: ReturnType<typeof FlightControl.create>;
}>): DesktopApplicationInstance {
  let phase: DesktopApplicationPhase = "idle";
  let revision = 0;
  let operation: Operation = null;
  let active: Promise<DesktopApplicationResult> | null = null;
  let disposed = false;
  const listeners = new Set<(snapshot: DesktopApplicationSnapshot) => void>();
  const snapshot = (): DesktopApplicationSnapshot => freeze({ phase, revision, runtime: publicSnapshot(copy(dependencies.runtime.snapshot())), workflow: publicSnapshot(copy(dependencies.workflow.snapshot())) });
  const publish = (): void => {
    revision += 1;
    const current = snapshot();
    for (const listener of [...listeners]) { try { listener(current); } catch { /* observer isolation */ } }
  };
  /* c8 ignore next -- 运行时在释放前取消订阅，迟到回调仅是防御性保护。 */
  const runtimeSubscription = dependencies.runtime.subscribe(() => { if (!disposed) publish(); });
  /* c8 ignore next -- 工作流在释放前取消订阅，迟到回调仅是防御性保护。 */
  const workflowSubscription = dependencies.workflow.subscribe(() => { if (!disposed) publish(); });
  const transition = (next: DesktopApplicationPhase): void => { phase = next; publish(); };
  const running = (code: DesktopRuntimeCode | undefined, value: DesktopApplicationSnapshot): DesktopApplicationResult => result(code === undefined, value, code);
  const start = (): Promise<DesktopApplicationResult> => {
    if (disposed) return Promise.resolve(result(false, snapshot(), "DISPOSED"));
    if (operation !== null) return Promise.resolve(result(false, snapshot(), "OPERATION_IN_PROGRESS"));
    if (phase === "running") return Promise.resolve(result(false, snapshot(), "ALREADY_RUNNING"));
    operation = "start";
    transition("starting");
    active = (async () => {
      const started = await dependencies.runtime.start();
      operation = null;
      transition(started.ok ? "running" : "idle");
      return started.ok ? result(true, snapshot()) : running(started.code, snapshot());
    })();
    return active;
  };
  const stop = (): Promise<DesktopApplicationResult> => {
    if (disposed) return Promise.resolve(result(false, snapshot(), "DISPOSED"));
    if (operation !== null) return Promise.resolve(result(false, snapshot(), "OPERATION_IN_PROGRESS"));
    if (phase !== "running") return Promise.resolve(result(false, snapshot(), "NOT_RUNNING"));
    operation = "stop";
    transition("stopping");
    active = (async () => {
      const list = dependencies.missionControl.list;
      if (typeof list === "function") {
        try {
          const lanes = list();
          if (Array.isArray(lanes)) {
            await Promise.all(lanes.map(async (lane) => {
              const deviceId = typeof (lane as { deviceId?: unknown }).deviceId === "string" ? (lane as { deviceId: string }).deviceId : null;
              const phase = typeof (lane as { phase?: unknown }).phase === "string" ? (lane as { phase: string }).phase : "";
              if (deviceId === null) return;
              if (!["starting", "running", "pausing", "paused", "resuming", "stopping", "staging", "staged", "uploading", "uploaded", "disconnected"].includes(phase)) return;
              try { await dependencies.missionControl.stop(deviceId); } catch { /* best-effort stop on desktop shutdown */ }
            }));
          }
        } catch { /* mission inventory failure must not block media/relay stop */ }
      }
      const stopped = await dependencies.runtime.stop();
      operation = null;
      transition("idle");
      if (!stopped.ok) return running(stopped.code, snapshot());
      return result(true, snapshot());
    })();
    return active;
  };
  return freeze({
    start,
    stop,
    snapshot,
    subscribe: (listener) => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      let subscribed = true;
      return () => { if (subscribed) { subscribed = false; listeners.delete(listener); } };
    },
    workflow: () => dependencies.workflow,
    dispose: async () => {
      if (disposed) return;
      if (active !== null) await active;
      if (phase === "running") await stop();
      disposed = true;
      workflowSubscription();
      runtimeSubscription();
      dependencies.workflow.dispose();
      dependencies.missionControl.dispose();
      dependencies.routeLibrary.clear();
      dependencies.flightControl.dispose();
      await dependencies.runtime.dispose();
      dependencies.operations.dispose();
      listeners.clear();
      phase = "disposed";
      revision += 1;
    }
  });
}

export const DesktopApplication = freeze({ create });
