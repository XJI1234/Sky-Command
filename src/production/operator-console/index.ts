import { DeviceGuidance } from "../../modules/device-console/device-guidance/index.js";
import { LinkChain } from "../../modules/device-console/link-chain/index.js";

type MarkerRole = "mission" | "stream" | "both" | "none";
type WorkspaceName = "devices" | "routes" | "flight";

export interface OperatorSelection {
  readonly missionDeviceId: string | null;
  readonly streamDeviceId: string | null;
}

export interface OperatorMarker {
  readonly deviceId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly altitudeMeters: number | null;
  readonly role: MarkerRole;
}

export interface OperatorConfirmation {
  readonly deviceId: string;
  readonly action: string;
  readonly confirmationId: string;
  readonly expiresAtMs: number;
}

export interface OperatorRouteFact {
  readonly routeId: string;
  readonly displayName: string;
  readonly format: string | null;
  readonly classification: string | null;
  readonly executable: boolean;
  readonly previewable: boolean;
  readonly blockedReason: string | null;
}

export interface OperatorActionResult {
  readonly ok: boolean;
  readonly reason?: string;
}

export interface OperatorView {
  readonly workspace: WorkspaceName;
  readonly relayHint: string;
  readonly devices: readonly unknown[];
  readonly missionDeviceId: string | null;
  readonly streamDeviceId: string | null;
  readonly playingVideoDeviceId: string | null;
  readonly markers: readonly OperatorMarker[];
  readonly confirmation: OperatorConfirmation | null;
  readonly mission: unknown;
  readonly guidance: unknown;
  readonly routes: readonly OperatorRouteFact[];
  readonly selectedRoute: OperatorRouteFact | null;
  readonly missionLabel: string;
  readonly streamLabel: string;
  readonly playbackReady: boolean;
}

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const read = (value: unknown, key: string): unknown => { try { return record(value)?.[key]; } catch { return undefined; } };
const text = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 ? value : null;
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const devicesOf = (snapshot: unknown): readonly Record<string, unknown>[] => {
  const workflow = read(snapshot, "workflow");
  const devices = read(workflow, "devices");
  return Array.isArray(devices) ? devices.flatMap((item) => { const row = record(item); return row === null || !text(read(row, "deviceId")) ? [] : [row]; }) : [];
};
const stillOnline = (devices: readonly Record<string, unknown>[], deviceId: string | null): string | null =>
  deviceId !== null && devices.some((item) => read(item, "deviceId") === deviceId) ? deviceId : null;
const resolveSelection = (devices: readonly Record<string, unknown>[], selected: string | null): string | null => {
  const current = stillOnline(devices, selected);
  if (current !== null) return current;
  if (selected !== null) return null;
  return devices.length === 1 ? text(read(devices[0], "deviceId")) : null;
};
const poseMarker = (device: Record<string, unknown>, role: MarkerRole): OperatorMarker | null => {
  const pose = read(read(device, "connection"), "pose");
  const latitude = finite(read(pose, "latitude"));
  const longitude = finite(read(pose, "longitude"));
  if (latitude === null || longitude === null) return null;
  return freeze({ deviceId: text(read(device, "deviceId"))!, latitude, longitude, altitudeMeters: finite(read(pose, "altitudeMeters")), role });
};
const confirmationOf = (device: Record<string, unknown> | undefined): OperatorConfirmation | null => {
  if (device === undefined) return null;
  const pending = record(read(device, "pendingFlightAction"));
  const deviceId = text(read(pending, "deviceId"));
  const action = text(read(pending, "action"));
  const confirmationId = text(read(pending, "confirmationId"));
  const expiresAtMs = finite(read(pending, "expiresAtMs"));
  return deviceId !== null && action !== null && confirmationId !== null && expiresAtMs !== null
    ? freeze({ deviceId, action, confirmationId, expiresAtMs })
    : null;
};
const telemetryBits = (connection: unknown) => freeze({
  ...(read(connection, "sdk") === "ready" ? { sdkRegistered: true } : read(connection, "sdk") === "not-ready" ? { sdkRegistered: false } : {}),
  ...(read(connection, "remoteController") === "connected" ? { remoteControllerConnected: true } : read(connection, "remoteController") === "disconnected" ? { remoteControllerConnected: false } : {}),
  ...(read(connection, "flightController") === "connected" ? { flightControllerConnected: true } : read(connection, "flightController") === "disconnected" ? { flightControllerConnected: false } : {}),
  ...(read(connection, "aircraft") === "connected" ? { connected: true } : read(connection, "aircraft") === "disconnected" ? { connected: false } : {}),
});
const guidanceOf = (device: Record<string, unknown> | undefined): unknown => {
  if (device === undefined) return null;
  const deviceId = text(read(device, "deviceId"));
  if (deviceId === null) return null;
  const connection = read(device, "connection");
  const link = LinkChain.evaluate({ deviceId, relayConnected: read(connection, "relay") === "online", telemetry: telemetryBits(connection) });
  if (!link.ok) return null;
  const pairingState = text(read(connection, "pairingState")) ?? "UNKNOWN";
  const guidance = DeviceGuidance.evaluate({ link: link.value, pairingState });
  return guidance.ok ? guidance.value : null;
};
const markerRole = (deviceId: string, missionDeviceId: string | null, streamDeviceId: string | null, playingVideoDeviceId: string | null): MarkerRole => {
  const mission = deviceId === missionDeviceId;
  const stream = deviceId === streamDeviceId || deviceId === playingVideoDeviceId;
  return mission && stream ? "both" : mission ? "mission" : stream ? "stream" : "none";
};
const workspaceOf = (value: unknown): WorkspaceName => value === "routes" || value === "flight" ? value : "devices";
const routeFact = (value: unknown): OperatorRouteFact | null => {
  const row = record(value);
  const routeId = text(read(row, "routeId"));
  if (routeId === null) return null;
  const format = text(read(row, "format"));
  const classification = text(read(row, "classification"));
  const previewOnly = format === "kml" || classification === "preview-only";
  const executable = classification === "upload-candidate";
  const blockedReason = previewOnly
    ? "KML 只能预览，不能提交给飞机"
    : executable
      ? null
      : "尚未取得该航线的可执行性事实";
  return freeze({
    routeId,
    displayName: text(read(row, "displayName")) ?? routeId,
    format,
    classification,
    executable,
    previewable: true,
    blockedReason,
  });
};
const routesOf = (snapshot: unknown): readonly OperatorRouteFact[] => {
  const routes = read(read(snapshot, "workflow"), "routes");
  return freeze(Array.isArray(routes) ? routes.flatMap((item) => { const fact = routeFact(item); return fact === null ? [] : [fact]; }) : []);
};
const missionLabelOf = (mission: unknown): string => {
  switch (text(read(mission, "phase"))) {
    case "staging": return "正在传输到手机";
    case "staged": return "已传输到手机（飞机尚未收到）";
    case "uploading": return "正在上传到飞机";
    case "uploaded": return "已上传到飞机";
    case "starting": return "启动中（等待航线阶段回报）";
    case "running": return "正在执行航线";
    case "pausing": return "正在暂停";
    case "paused": return "已暂停";
    case "resuming": return "正在恢复";
    case "stopping": return "正在停止";
    case "completed": return "已结束";
    case "failed": return "已失败";
    case "disconnected": return "设备失效，需重新上传";
    default: return "未开始";
  }
};
const streamLabelOf = (device: Record<string, unknown> | undefined): string => {
  const videoPhase = text(read(read(device, "video"), "phase"));
  if (videoPhase === "ready") return "已获取 HLS，可附着播放器";
  if (videoPhase === "awaiting-playlist") return "桌面等待 HLS 播放列表";
  if (videoPhase === "awaiting-ingest") return "手机已接受推流，等待接收";
  if (videoPhase === "failed") return "图传失败";
  const streamPhase = text(read(read(device, "stream"), "phase"));
  if (streamPhase === "starting" || streamPhase === "streaming") return "手机已接受推流命令";
  return "空闲";
};
const reject = (reason: string): OperatorActionResult => freeze({ ok: false, reason });
const accept = (): OperatorActionResult => freeze({ ok: true });
const aircraftConnected = (device: Record<string, unknown> | undefined): boolean => read(read(device, "connection"), "aircraft") === "connected";
const waypointSupported = (device: Record<string, unknown> | undefined): boolean => read(read(device, "capabilities"), "waypointMission") === "supported";
const batteryPercent = (device: Record<string, unknown> | undefined): number | null => finite(read(read(device, "connection"), "batteryPercent"));
const deviceById = (view: OperatorView, deviceId: string | null): Record<string, unknown> | undefined =>
  view.devices.flatMap((item) => { const row = record(item); return row !== null && read(row, "deviceId") === deviceId ? [row] : []; })[0];
const flightDevice = (view: OperatorView, action: string): OperatorActionResult | Record<string, unknown> => {
  if (view.workspace === "devices") return reject("请到飞行页执行任务");
  if (view.workspace === "routes") return reject("航线页不执行飞行或图传，请到飞行页操作");
  const deviceId = action.startsWith("stream-") ? view.streamDeviceId : view.missionDeviceId;
  if (deviceId === null) return reject(action.startsWith("stream-") ? "请选择用于图传的飞机" : "请选择用于执行任务的飞机");
  const device = deviceById(view, deviceId);
  if (device === undefined) return reject("所选手机已离线");
  if (action !== "mission-stage" && !aircraftConnected(device)) return reject("飞机尚未连接");
  return device;
};
const rejected = (value: OperatorActionResult | Record<string, unknown>): value is OperatorActionResult => "ok" in value;

function project(input: unknown): OperatorView {
  const source = record(input);
  const snapshot = source === null ? null : read(source, "snapshot");
  const selection = record(source === null ? null : read(source, "selection"));
  const devices = devicesOf(snapshot);
  const missionDeviceId = resolveSelection(devices, text(read(selection, "missionDeviceId")));
  const streamDeviceId = resolveSelection(devices, text(read(selection, "streamDeviceId")));
  const playingVideoDeviceId = stillOnline(devices, text(read(read(snapshot, "workflow"), "selectedVideoDeviceId")));
  const missionDevice = devices.find((item) => read(item, "deviceId") === missionDeviceId);
  const streamDevice = devices.find((item) => read(item, "deviceId") === streamDeviceId);
  const routes = routesOf(snapshot);
  const selectedRouteId = text(read(read(snapshot, "workflow"), "selectedRouteId"));
  const selectedRoute = routes.find((item) => item.routeId === selectedRouteId) ?? null;
  const videoPhase = text(read(read(streamDevice, "video"), "phase"));
  return freeze({
    workspace: workspaceOf(source === null ? null : read(source, "workspace")),
    relayHint: text(source === null ? null : read(source, "relayHint")) ?? "ws://<电脑IPv4>:8080/relay",
    devices: freeze(devices.map((item) => freeze({ ...item }))),
    missionDeviceId,
    streamDeviceId,
    playingVideoDeviceId,
    markers: freeze(devices.flatMap((item) => {
      const marker = poseMarker(item, markerRole(text(read(item, "deviceId"))!, missionDeviceId, streamDeviceId, playingVideoDeviceId));
      return marker === null ? [] : [marker];
    })),
    confirmation: confirmationOf(missionDevice),
    mission: missionDevice === undefined ? null : read(missionDevice, "mission"),
    guidance: guidanceOf(missionDevice),
    routes,
    selectedRoute,
    missionLabel: missionLabelOf(missionDevice === undefined ? null : read(missionDevice, "mission")),
    streamLabel: streamLabelOf(streamDevice),
    playbackReady: videoPhase === "ready",
  });
}

function evaluate(action: unknown, view: unknown): OperatorActionResult {
  const name = text(action);
  const current = record(view) as OperatorView | null;
  if (name === null || current === null) return reject("操作无效");
  if (name === "pairing-start" || name === "pairing-stop") {
    return reject("请到手机上开始或停止对频。");
  }
  if (name === "import-route" || name === "select-route" || name === "remove-route") {
    return current.workspace === "routes" ? accept() : reject("请到航线页导入或管理航线");
  }
  const device = flightDevice(current, name);
  if (rejected(device)) return device;
  if (name === "stream-start" || name === "stream-stop" || name === "stream-select") {
    if (name === "stream-start") {
      if (read(read(device, "connection"), "remoteController") !== "connected") return reject("遥控器未连接，无法启动图传");
      if (read(read(device, "connection"), "flightController") !== "connected") return reject("飞机尚未连接，无法启动图传");
    }
    return accept();
  }
  if (name === "flight-takeoff" || name === "flight-land" || name === "flight-return-home" || name === "flight-confirm" || name === "flight-cancel") return accept();
  if (name === "mission-stage") {
    return current.selectedRoute?.executable === true ? accept() : reject(current.selectedRoute?.blockedReason ?? "当前航线不能提交给飞机");
  }
  if (name === "mission-upload") {
    const phase = text(read(current.mission, "phase"));
    return phase === "staged" ? accept() : reject("请先将航线传输到手机");
  }
  if (name === "mission-pause") {
    return text(read(current.mission, "phase")) === "running" ? accept() : reject("当前阶段不能暂停");
  }
  if (name === "mission-resume") {
    return text(read(current.mission, "phase")) === "paused" ? accept() : reject("当前阶段不能恢复");
  }
  if (name === "mission-stop") {
    const phase = text(read(current.mission, "phase"));
    return phase === "starting" || phase === "running" || phase === "paused" ? accept() : reject("当前阶段不能停止航线");
  }
  if (name !== "mission-start") return reject("未知操作");
  if (!waypointSupported(device)) return reject("所选机型未上报航线能力");
  const battery = batteryPercent(device);
  if (battery === null) return reject("尚未取得所选飞机的电池遥测");
  if (battery < 20) return reject("电量低于 20%，禁止启动或继续任务");
  const phase = text(read(current.mission, "phase"));
  if (phase !== "uploaded") return reject("请先将当前航线上传到所选飞机");
  if (read(read(device, "connection"), "sdk") === "not-ready") return reject("手机尚未就绪");
  if (read(read(device, "connection"), "remoteController") !== "connected") return reject("遥控器未连接");
  if (read(read(device, "connection"), "flightController") !== "connected") return reject("飞机尚未连接");
  if (read(read(device, "connection"), "flightState") === "flying") return reject("飞机已在空中，禁止启动航线");
  return accept();
}

export const OperatorConsole = freeze({ project, evaluate });
