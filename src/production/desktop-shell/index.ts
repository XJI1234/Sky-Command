import { AppShell, type AppShellInstance, type AppShellOptions, type ShellResult, type ShellSnapshot } from "../../modules/app-shell/index.js";
import type { LifecyclePort } from "../../modules/app-shell/process-lifecycle/index.js";
import type { WindowPort } from "../../modules/app-shell/window-manager/index.js";
import type { RendererPort } from "../../modules/app-shell/renderer-host/index.js";
import type { RuntimePathsInput } from "../../modules/app-shell/runtime-paths/index.js";
import type { BridgeResult, IpcHandlers } from "../../modules/app-shell/ipc-bridge/index.js";
import type { DesktopUiGatewayInstance } from "../desktop-ui-gateway/index.js";

export interface DesktopShellPorts {
  readonly applicationGateway: DesktopUiGatewayInstance;
  readonly lifecycle: LifecyclePort;
  readonly window: WindowPort;
  readonly renderer: RendererPort;
  readonly paths: RuntimePathsInput;
}

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);

const gatewayMethods = freeze({
  "state-snapshot": "state.snapshot",
  "network-hint": "network.hint",
  "route-import": "route.import",
  "route-preview": "route.preview",
  "route-select": "route.select",
  "route-remove": "route.remove",
  "assignment-assign": "assignment.assign",
  "assignment-clear": "assignment.clear",
  "mission-stage": "mission.stage",
  "mission-upload": "mission.upload",
  "mission-start": "mission.start",
  "mission-pause": "mission.pause",
  "mission-resume": "mission.resume",
  "mission-stop": "mission.stop",
  "stream-start": "stream.start",
  "stream-stop": "stream.stop",
  "stream-refresh": "stream.refresh",
  "stream-select": "stream.select",
  "stream-clear": "stream.clear",
  "webrtc-start": "webrtc.start",
  "webrtc-stop": "webrtc.stop",
  "webrtc-refresh": "webrtc.refresh",
  "webrtc-stream-start": "webrtc.stream-start",
  "webrtc-stream-stop": "webrtc.stream-stop",
  "webrtc-stream-select": "webrtc.stream-select",
  "webrtc-stream-clear": "webrtc.stream-clear",
  "settings-transmission-read": "settings.transmission.read",
  "settings-transmission-write": "settings.transmission.write",
  "settings-camera-read": "settings.camera.read",
  "settings-camera-write": "settings.camera.write",
  "flight-request": "flight.request",
  "flight-confirm": "flight.confirm",
  "flight-cancel": "flight.cancel",
  "video-playback": "video.playback",
  "diagnostics-record": "diagnostics.record",
} as const);

export type DesktopShellIpcName = keyof typeof gatewayMethods;

function ipcHandlers(gateway: DesktopUiGatewayInstance): IpcHandlers {
  const handlers: Record<string, (input: unknown) => Promise<unknown>> = {};
  for (const [name, method] of Object.entries(gatewayMethods)) {
    handlers[name] = (input) => gateway.invoke(method, input);
  }
  return freeze(handlers);
}

function create(ports: DesktopShellPorts, options: AppShellOptions): AppShellInstance {
  return AppShell.create({
    lifecycle: ports.lifecycle,
    window: ports.window,
    renderer: ports.renderer,
    paths: ports.paths,
    ipc: ipcHandlers(ports.applicationGateway),
  }, options);
}

export const DesktopShell = freeze({
  create,
  ipcHandlers,
  methods: gatewayMethods,
});

export type { AppShellInstance, BridgeResult, ShellResult, ShellSnapshot };
