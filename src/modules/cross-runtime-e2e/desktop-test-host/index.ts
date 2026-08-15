import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { NodeRuntime } from "../../../production/node-runtime/index.js";
import { RelayOperationsAdapter, type RelayOperationsAdapterInstance, type RelaySettingsGateway as AdapterRelaySettingsGateway } from "../../../production/relay-operations-adapter/index.js";
import { DesktopRuntime, type DesktopRuntimeInstance } from "../../../production/desktop-runtime/index.js";
import { RelayDeviceSettings } from "../../../adapters/relay-device-settings/index.js";
import { DeviceConsole } from "../../device-console/index.js";
import type { DeviceSettingsPanelInstance } from "../../device-console/device-settings-panel/index.js";
import { GeoMap, type GeoMapInstance } from "../../geo-map/index.js";
import type { GeoBounds } from "../../geo-map/map-engine-adapter/index.js";
import { FlightControl, FlightCommandDispatcher, type FlightControlInstance } from "../../flight-control/index.js";
import { LiveStreamControl, type LiveStreamControlInstance } from "../../live-stream-control/index.js";
import { MediaPipeline, type MediaPipelineInstance } from "../../media-pipeline/index.js";
import { MissionControl, type MissionControlInstance } from "../../mission-control/index.js";
import type { RelayDeviceSnapshot, RelayDiagnosticSink, RelayLinkInstance } from "../../relay-link/index.js";
import type { JsonObject, JsonValue } from "../../relay-link/protocol-core/index.js";
import { DesktopSettings } from "../../desktop-settings/index.js";
import { RouteLibrary, type RouteLibraryInstance } from "../../route-library/index.js";
import { OperationWorkflow } from "../../../production/operation-workflow/index.js";

export type HarnessProfile = "success"
  | "flight-timeout" | "flight-reject" | "flight-throw" | "flight-duplicate" | "flight-late"
  | "mission-upload-timeout" | "mission-upload-reject" | "mission-upload-throw" | "mission-upload-duplicate" | "mission-upload-late"
  | "mission-control-reject" | "mission-control-throw" | "mission-control-timeout" | "mission-control-duplicate" | "mission-control-late"
  | "settings-reject" | "settings-throw" | "settings-timeout" | "settings-duplicate" | "settings-late"
  | "stream-timeout" | "stream-reject" | "stream-throw" | "stream-duplicate" | "stream-late";

export interface HarnessDeviceOptions {
  readonly deviceId: string;
  readonly harnessProfile?: HarnessProfile;
}

export interface DesktopTestHostOptions extends HarnessDeviceOptions {
  readonly mobileProjectRoot: string;
}

export interface DesktopTestHostSnapshot {
  readonly closed: boolean;
  readonly childExited: boolean;
  readonly devices: readonly RelayDeviceSnapshot[];
  readonly recentOutput: readonly string[];
  readonly diagnostics: readonly Parameters<RelayDiagnosticSink["persist"]>[0][];
  readonly mapFocuses: readonly GeoBounds[];
}

export interface DesktopTestHostInstance {
  readonly relayEndpoint: string;
  readonly relay: RelayLinkInstance;
  readonly operations: RelayOperationsAdapterInstance;
  readonly deviceSettings: DeviceSettingsPanelInstance;
  readonly routeLibrary: RouteLibraryInstance;
  readonly missionControl: MissionControlInstance;
  readonly geoMap: GeoMapInstance;
  readonly flightControl: FlightControlInstance;
  readonly mediaPipeline: MediaPipelineInstance;
  readonly liveStreamControl: LiveStreamControlInstance;
  readonly desktopRuntime: DesktopRuntimeInstance;
  readonly workflow: ReturnType<typeof OperationWorkflow.create>;
  startDevice(options: HarnessDeviceOptions): Promise<void>;
  waitForDevice(timeoutMs: number, deviceId?: string): Promise<RelayDeviceSnapshot>;
  sendControl(line: string, deviceId?: string): void;
  snapshot(): DesktopTestHostSnapshot;
  close(): Promise<void>;
}

interface HarnessProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly output: string[];
}

const execFileAsync = promisify(execFile);
const distributions = new Map<string, Promise<void>>();

const validDeviceId = (value: string): boolean =>
  value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);

type AdapterSettingsFields = Parameters<AdapterRelaySettingsGateway["sendCommand"]>[1]["fields"];
const settingsValueCompatible = (value: JsonValue): boolean => {
  if (value.kind === "array") return false;
  if (value.kind !== "object") return true;
  return Object.values(value.fields).every(settingsValueCompatible);
};
const narrowSettingsFields = (fields: JsonObject["fields"]): AdapterSettingsFields | null =>
  Object.values(fields).every(settingsValueCompatible) ? fields as AdapterSettingsFields : null;

const reserveLoopbackPort = async (): Promise<number> => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address === null || typeof address === "string") {
      server.close(() => reject(new Error("Unable to allocate loopback test port")));
      return;
    }
    server.close((error) => error === undefined ? resolvePort(address.port) : reject(error));
  });
});

const ensureDistribution = (root: string): Promise<void> => {
  const known = distributions.get(root);
  if (known !== undefined) return known;
  const build = execFileAsync(process.env.ComSpec ?? "cmd.exe", [
    "/d", "/c", "gradlew.bat", ":cross-runtime-e2e:relay-test-harness:installDist", "--console=plain", "--quiet",
  ], { cwd: root, windowsHide: true, timeout: 120_000, maxBuffer: 2_000_000 }).then(() => undefined);
  distributions.set(root, build);
  return build.catch((failure: unknown) => {
    distributions.delete(root);
    throw new Error(`Harness distribution build failed: ${failure instanceof Error ? failure.name : "unknown"}`);
  });
};

const pushOutput = (target: string[], chunk: Buffer): void => {
  for (const line of chunk.toString("utf8").split(/\r?\n/u).filter(Boolean)) target.push(line.slice(0, 500));
  if (target.length > 40) target.splice(0, target.length - 40);
};

const waitForExit = async (child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> => {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolveExit) => {
    const timeout = setTimeout(() => finish(false), timeoutMs);
    const onExit = (): void => finish(true);
    const finish = (value: boolean): void => { clearTimeout(timeout); child.off("exit", onExit); resolveExit(value); };
    child.once("exit", onExit);
  });
};

const start = async (options: DesktopTestHostOptions): Promise<DesktopTestHostInstance> => {
  const root = resolve(options.mobileProjectRoot);
  if (!existsSync(join(root, "gradlew.bat")) || !validDeviceId(options.deviceId)) throw new Error("Invalid test host configuration");
  await ensureDistribution(root);
  const settings = DesktopSettings.create({
    read: async () => null,
    writeAtomically: async () => undefined,
  });
  const reservedRelayPort = await reserveLoopbackPort();
  const networkUpdate = settings.updateNetwork({
    listenPort: 19_350,
    relayPort: reservedRelayPort,
    manualHost: null,
  });
  if (!networkUpdate.ok) throw new Error("Desktop settings network update failed");
  const network = settings.snapshot().network;
  const diagnostics: Parameters<RelayDiagnosticSink["persist"]>[0][] = [];
  const relay = NodeRuntime.createRelay({
    address: { host: "127.0.0.1", port: network.relayPort }, handshakeTimeoutMs: 10_000,
    maxConnections: 8, commandTimeoutMs: 10_000, missionTimeoutMs: 20_000,
    diagnosticSink: Object.freeze({
      persist: (input: Parameters<RelayDiagnosticSink["persist"]>[0]): boolean => {
        diagnostics.push(input);
        return true;
      },
    }),
  });
  const operations = RelayOperationsAdapter.create({ relay });
  const settingsGateway = operations.settingsGateway();
  const deviceSettings = DeviceConsole.DeviceSettingsPanel.create({
    port: RelayDeviceSettings.create({ relay: {
      sendCommand: (deviceId, request) => {
        if (request.name !== "device.settings.camera.read" && request.name !== "device.settings.camera.write" && request.name !== "device.settings.transmission.read" && request.name !== "device.settings.transmission.write") {
          return Promise.resolve(Object.freeze({ status: "rejected" as const, detail: "设置命令无效" }));
        }
        const fields = narrowSettingsFields(request.fields);
        return fields === null
          ? Promise.resolve(Object.freeze({ status: "rejected" as const, detail: "设置字段无效" }))
          : settingsGateway.sendCommand(deviceId, Object.freeze({ name: request.name, fields }));
      },
    } }),
  });
  const routeLibraryResult = RouteLibrary.create({
    idProvider: (() => { let nextId = 0; return () => `e2e-route-${++nextId}`; })(),
    clock: () => "2026-08-13T00:00:00.000Z",
  });
  if (!routeLibraryResult.ok) throw new Error(`Route library start failed: ${routeLibraryResult.error.code}`);
  const routeLibrary = routeLibraryResult.value;
  const missionGateway = operations.missionGateway();
  const missionControl = MissionControl.create({
    routeSource: routeLibrary,
    relay: Object.freeze({
      ...missionGateway,
      subscribe: operations.subscribe,
    }),
  }, {
    createMissionId: (deviceId, routeId) => `e2e-mission-${deviceId}-${routeId}`,
  });
  const mapFocuses: GeoBounds[] = [];
  const geoMap = GeoMap.create({
    factory: {
      create: () => Object.freeze({
        replaceLayer: () => undefined,
        removeLayer: () => undefined,
        focus: (bounds: GeoBounds) => { mapFocuses.push(Object.freeze({ ...bounds })); },
        dispose: () => undefined,
      }),
    },
  });
  const flightControl = FlightControl.create({
    dispatcher: FlightCommandDispatcher.create({
      relay: operations.flightGateway(),
      preflight: { evaluateFlightAction: (input) => MissionControl.PreflightCheck.evaluateFlightAction(input as never) },
      capabilityGate: DeviceConsole.CapabilityGate,
    }),
  }, {
    now: () => Date.now(),
    confirmation: {
      ttlMs: 10_000,
      createConfirmationId: (() => { let nextId = 0; return () => `e2e-confirm-${++nextId}`; })(),
    },
  });
  const mediaPipeline = MediaPipeline.create({
    rtmp: { listen: () => undefined, close: () => undefined },
    hls: { listen: () => undefined, close: () => undefined },
    fileFacts: { isExecutableFile: () => true },
    processFactory: () => ({
      launch: () => ({ terminate: () => undefined }),
    }),
    player: { setSource: () => undefined, clear: () => undefined },
    clock: () => Date.now(),
  }, {
    rtmpPort: network.listenPort,
    hlsPort: 18_080,
    health: { ingestTimeoutMs: 10_000, playlistTimeoutMs: 10_000 },
  });
  const mediaStartInput = Object.freeze({
    interfaces: [{ name: "e2e-wifi", enabled: true, internal: false, kind: "wifi", ipv4: "192.168.50.10" }],
    manualHost: network.manualHost,
    hlsRootDirectory: "D:/controlled-e2e-hls",
    ffmpegCandidates: [{ source: "bundled", executablePath: "D:/controlled-e2e-ffmpeg.exe" }],
  });
  const liveStreamControl = LiveStreamControl.create({
    media: mediaPipeline,
    relay: operations.streamGateway(),
    capabilityGate: DeviceConsole.CapabilityGate,
  });
  const desktopRuntime = DesktopRuntime.create({
    relay: {
      start: relay.start,
      stop: relay.stop,
      snapshot: () => Object.freeze({ devices: relay.devices() }),
      subscribe: relay.subscribe,
    },
    media: mediaPipeline,
    live: liveStreamControl,
  }, { mediaStartInput });
  const workflow = OperationWorkflow.create({
    relayOperations: operations,
    routeLibrary,
    missionControl,
    liveStreamControl,
    mediaPipeline,
    flightControl,
    deviceSettings,
    now: () => Date.now(),
  } as never);
  const runtimeStarted = await desktopRuntime.start();
  if (!runtimeStarted.ok) throw new Error(`Desktop runtime start failed: ${runtimeStarted.code}`);
  const endpoint = `ws://127.0.0.1:${network.relayPort}/relay`;
  const classPath = join(root, "src", "modules", "cross-runtime-e2e", "relay-test-harness", "build", "install", "relay-test-harness", "lib", "*");
  const children = new Map<string, HarnessProcess>();
  let closed = false;

  const startDevice = async (device: HarnessDeviceOptions): Promise<void> => {
    if (closed || !validDeviceId(device.deviceId) || children.has(device.deviceId)) throw new Error("Invalid test device start request");
    const child = spawn("java", ["-cp", classPath, "com.skycommand.relay.e2e.harness.RelayTestHarnessKt", endpoint, device.deviceId, device.harnessProfile ?? "success"], {
      cwd: root, windowsHide: true, stdio: "pipe",
    });
    const output: string[] = [];
    child.stdout.on("data", (chunk: Buffer) => pushOutput(output, chunk));
    child.stderr.on("data", (chunk: Buffer) => pushOutput(output, chunk));
    children.set(device.deviceId, { child, output });
  };
  await startDevice(options);

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await Promise.all([...children.values()].map(async ({ child }) => {
      if (!child.stdin.destroyed) { child.stdin.write("EXIT\n"); child.stdin.end(); }
      if (!(await waitForExit(child, 5_000))) { child.kill(); await waitForExit(child, 5_000); }
    }));
    missionControl.dispose();
    workflow.dispose();
    routeLibrary.clear();
    geoMap.dispose();
    flightControl.dispose();
    await desktopRuntime.dispose();
    operations.dispose();
  };

  return Object.freeze({
    relayEndpoint: endpoint,
    relay,
    operations,
    deviceSettings,
    routeLibrary,
    missionControl,
    geoMap,
    flightControl,
    mediaPipeline,
    liveStreamControl,
    desktopRuntime,
    workflow,
    startDevice,
    waitForDevice: async (timeoutMs: number, deviceId = options.deviceId): Promise<RelayDeviceSnapshot> => {
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid wait timeout");
      const harness = children.get(deviceId);
      if (harness === undefined) throw new Error("Unknown test device");
      const existing = relay.devices().find((device) => device.deviceId === deviceId);
      if (existing !== undefined) return existing;
      return new Promise((resolveDevice, reject) => {
        let settled = false;
        const finish = (error?: Error, value?: RelayDeviceSnapshot): void => {
          if (settled) return;
          settled = true; clearTimeout(timeout); clearInterval(exitPoll); unsubscribe();
          if (error === undefined) resolveDevice(value!); else reject(error);
        };
        const unsubscribe = relay.subscribe((snapshot) => {
          const device = snapshot.devices.find((candidate) => candidate.deviceId === deviceId);
          if (device !== undefined) finish(undefined, device);
        });
        const exitPoll = setInterval(() => {
          if (harness.child.exitCode !== null || harness.child.signalCode !== null) finish(new Error(`Harness exited: ${harness.output.slice(-5).join(" | ")}`));
        }, 100);
        const timeout = setTimeout(() => finish(new Error(`Harness wait timed out: ${harness.output.slice(-5).join(" | ")}`)), timeoutMs);
      });
    },
    sendControl: (line: string, deviceId = options.deviceId): void => {
      const harness = children.get(deviceId);
      if (closed || harness === undefined || harness.child.stdin.destroyed || !/^[A-Z0-9 _.-]+$/u.test(line)) throw new Error("Invalid harness control request");
      harness.child.stdin.write(`${line}\n`);
    },
    snapshot: (): DesktopTestHostSnapshot => Object.freeze({
      closed,
      childExited: [...children.values()].some(({ child }) => child.exitCode !== null || child.signalCode !== null),
      devices: relay.devices(),
      recentOutput: Object.freeze([...children.values()].flatMap(({ output }) => output).slice(-40)),
      diagnostics: Object.freeze([...diagnostics]),
      mapFocuses: Object.freeze(mapFocuses.map((bounds) => Object.freeze({ ...bounds }))),
    }),
    close,
  });
};

export const DesktopTestHost = Object.freeze({ start });
