import { DeviceGuidance } from "../../modules/device-console/device-guidance/index.js";
import { LinkChain } from "../../modules/device-console/link-chain/index.js";

type MarkerRole = "mission" | "stream" | "both" | "none";
type WorkspaceName = "devices" | "routes" | "flight";
type MissionActionName = "stage" | "upload" | "start" | "pause" | "resume" | "stop";

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

export interface OperatorMissionRoute {
  readonly routeId: string;
  readonly displayName: string;
}

export interface OperatorMissionAction {
  readonly enabled: boolean;
  readonly reason: string | null;
}

export type OperatorMissionActions = Readonly<Record<MissionActionName, OperatorMissionAction>>;

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
  readonly missionRoute: OperatorMissionRoute | null;
  readonly missionActions: OperatorMissionActions;
  readonly guidance: unknown;
  readonly routes: readonly OperatorRouteFact[];
  readonly selectedRoute: OperatorRouteFact | null;
  readonly missionLabel: string;
  readonly streamLabel: string;
  readonly playbackReady: boolean;
  readonly streamCanStart: boolean;
  readonly streamCanStop: boolean;
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
const controlConnection = (device: Record<string, unknown> | undefined): unknown => {
  if (device === undefined) return null;
  return record(read(device, "control")) ?? read(device, "connection");
};
const guidanceOf = (device: Record<string, unknown> | undefined): unknown => {
  if (device === undefined) return null;
  const deviceId = text(read(device, "deviceId"));
  if (deviceId === null) return null;
  const connection = controlConnection(device);
  const link = LinkChain.evaluate({ deviceId, relayConnected: read(connection, "relay") === "online", telemetry: telemetryBits(connection) });
  if (!link.ok) return null;
  const guidance = DeviceGuidance.evaluate({ link: link.value });
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
    ? format === "kml"
      ? "KML 只能预览，不能提交给飞机"
      : "该 KMZ 不是完整 DJI 航线包，仅可预览"
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
const missionRouteOf = (device: Record<string, unknown> | undefined, mission: unknown, routes: readonly OperatorRouteFact[]): OperatorMissionRoute | null => {
  const routeId = text(read(mission, "routeId"));
  if (routeId === null) return null;
  const known = routes.find((route) => route.routeId === routeId);
  if (known !== undefined) return freeze({ routeId, displayName: known.displayName });
  const assignment = read(device, "assignment");
  return freeze({
    routeId,
    displayName: read(assignment, "routeId") === routeId ? text(read(assignment, "routeName")) ?? routeId : routeId,
  });
};
const missionFailureLabel = (value: unknown): string => {
  switch (text(value)) {
    case "MISSION_TRANSFER_FAILED": return "准备航线失败：手机未确认文件已校验保存";
    case "WAYLINE_UPLOAD_FAILED": return "上传至飞机失败：飞机未确认航线";
    case "WAYLINE_START_UNCONFIRMED": return "启动状态不确定：不得重复执行，可停止航线";
    case "WAYLINE_PAUSE_UNCONFIRMED": return "暂停状态不确定：不得重复暂停，可停止航线";
    case "WAYLINE_RESUME_UNCONFIRMED": return "恢复状态不确定：不得重复恢复，可停止航线";
    case "WAYLINE_STOP_UNCONFIRMED": return "停止状态不确定：不得重复停止，请核实飞机状态";
    default: return "任务失败，请重新准备航线";
  }
};
const missionLabelOf = (mission: unknown): string => {
  switch (text(read(mission, "phase"))) {
    case "staging": return "正在准备航线（传输并校验中）";
    case "staged": return "航线已准备到手机（飞机尚未收到）。下一步：上传至飞机";
    case "uploading": return "正在上传至飞机（等待手机确认）";
    case "uploaded": return "航线已上传至飞机。下一步：执行航线";
    case "starting": return "启动已受理，等待飞机实际进入航线";
    case "running": return "正在执行航线";
    case "pausing": return "正在暂停，等待手机确认；如无响应可停止航线";
    case "paused": return "已暂停";
    case "resuming": return "正在恢复，等待手机确认；如无响应可停止航线";
    case "stopping": return "停止已提交，等待手机确认；不得重复停止";
    case "completed": return "已结束";
    case "failed": return missionFailureLabel(read(mission, "failureCode"));
    case "disconnected": return "与手机失联，飞机状态未知；重连后只能停止或重新准备航线";
    default: return "未开始";
  }
};
const streamLabelOf = (device: Record<string, unknown> | undefined): string => {
  if (device === undefined) return "图传未就绪：未选择图传机";
  const streamPhase = text(read(read(device, "stream"), "phase"));
  // 停止命令尚未确认时，播放器的最后一帧不能覆盖控制车道的事实。
  if (streamPhase === "stopping") return "正在停止图传";
  const videoPhase = text(read(read(device, "video"), "phase"));
  if (videoPhase === "ready") return "图传播放中";
  if (videoPhase === "awaiting-playback") return "正在准备画面";
  if (videoPhase === "awaiting-ingest") return "手机已接受推流，等待接收";
  if (videoPhase === "failed") return "图传失败";
  // 手机常回报 START_OK 但不真正推 RTMP；无画面时不得写成「已经有图传」。
  if (streamPhase === "starting" || streamPhase === "streaming") {
    return "手机已接命令，电脑还没收到画面";
  }
  if (streamPhase === "stopping") return "正在停止图传";
  if (streamPhase === "failed") return "图传失败";
  if (streamPhase === "disconnected") return "图传已中断，可重新启动";
  const issue = streamStartIssueOf(device);
  return issue === null ? "图传可启动" : `图传未就绪：${issue.label}`;
};
type StreamStartIssue = Readonly<{ readonly label: string; readonly reason: string }>;
const streamStartIssueOf = (device: Record<string, unknown> | undefined): StreamStartIssue | null => {
  if (device === undefined) return freeze({ label: "未选择图传机", reason: "请选择用于图传的飞机" });
  const connection = controlConnection(device);
  if (read(connection, "sdk") !== "ready") return freeze({ label: "等待手机就绪", reason: "手机尚未就绪，无法启动图传" });
  return null;
};
const streamCanStartOf = (device: Record<string, unknown> | undefined): boolean => {
  if (device === undefined) return false;
  const streamPhase = text(read(read(device, "stream"), "phase"));
  if (streamPhase === "starting" || streamPhase === "streaming") return false;
  return streamStartIssueOf(device) === null;
};
const streamCanStopOf = (device: Record<string, unknown> | undefined): boolean => {
  if (device === undefined) return false;
  const streamPhase = text(read(read(device, "stream"), "phase"));
  // failed 也允许停：启动半成功或遥测抖动后控制态可能已 failed，手机仍可能在推。
  if (streamPhase === "starting" || streamPhase === "streaming" || streamPhase === "stopping" || streamPhase === "failed") return true;
  const videoPhase = text(read(read(device, "video"), "phase"));
  return videoPhase === "ready" || videoPhase === "awaiting-playback" || videoPhase === "awaiting-ingest";
};
const reject = (reason: string): OperatorActionResult => freeze({ ok: false, reason });
const accept = (): OperatorActionResult => freeze({ ok: true });
const waypointSupported = (device: Record<string, unknown> | undefined): boolean => read(read(device, "capabilities"), "waypointMission") === "supported";
const batteryPercent = (device: Record<string, unknown> | undefined): number | null => finite(read(read(device, "connection"), "batteryPercent"));
const controlLinkIssue = (device: Record<string, unknown>): string | null => {
  const connection = controlConnection(device);
  if (read(connection, "sdk") !== "ready") return "手机尚未就绪";
  if (read(connection, "remoteController") !== "connected") return "遥控器未连接";
  if (read(connection, "flightController") !== "connected") return "飞机飞控未连接，请确认飞机已开机";
  if (read(connection, "aircraft") !== "connected") return "飞机尚未连接";
  return null;
};
const deviceById = (view: OperatorView, deviceId: string | null): Record<string, unknown> | undefined =>
  view.devices.flatMap((item) => { const row = record(item); return row !== null && read(row, "deviceId") === deviceId ? [row] : []; })[0];
const flightDevice = (view: OperatorView, action: string): OperatorActionResult | Record<string, unknown> => {
  if (view.workspace === "devices") return reject("请到飞行页执行任务");
  if (view.workspace === "routes") return reject("航线页不执行飞行或图传，请到飞行页操作");
  const streamAction = action.startsWith("stream-");
  const deviceId = streamAction ? view.streamDeviceId : view.missionDeviceId;
  if (deviceId === null) return reject(streamAction ? "请选择用于图传的飞机" : "请选择用于执行任务的飞机");
  const device = deviceById(view, deviceId);
  if (device === undefined) return reject("所选手机已离线");
  return device;
};
const rejected = (value: OperatorActionResult | Record<string, unknown>): value is OperatorActionResult => "ok" in value;
const missionActionState = (result: OperatorActionResult): OperatorMissionAction => freeze({ enabled: result.ok, reason: result.ok ? null : result.reason ?? "当前阶段不能执行此操作" });
const missionActionsOf = (view: unknown): OperatorMissionActions => freeze({
  stage: missionActionState(evaluate("mission-stage", view)),
  upload: missionActionState(evaluate("mission-upload", view)),
  start: missionActionState(evaluate("mission-start", view)),
  pause: missionActionState(evaluate("mission-pause", view)),
  resume: missionActionState(evaluate("mission-resume", view)),
  stop: missionActionState(evaluate("mission-stop", view)),
});

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
  const selectedRoute = routes.find((item) => item.routeId === selectedRouteId) ?? routes[0] ?? null;
  const videoPhase = text(read(read(streamDevice, "video"), "phase"));
  const mission = missionDevice === undefined ? null : read(missionDevice, "mission");
  const view = {
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
    mission,
    missionRoute: missionRouteOf(missionDevice, mission, routes),
    guidance: guidanceOf(missionDevice),
    routes,
    selectedRoute,
    missionLabel: missionLabelOf(missionDevice === undefined ? null : read(missionDevice, "mission")),
    streamLabel: streamLabelOf(streamDevice),
    playbackReady: videoPhase === "ready",
    streamCanStart: streamCanStartOf(streamDevice),
    streamCanStop: streamCanStopOf(streamDevice),
  };
  return freeze({ ...view, missionActions: missionActionsOf(view) });
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
      const issue = streamStartIssueOf(device);
      if (issue !== null) return reject(issue.reason);
    }
    return accept();
  }
  if (name === "flight-confirm" || name === "flight-cancel") return accept();
  if (name === "flight-takeoff" || name === "flight-land" || name === "flight-return-home") {
    const linkIssue = controlLinkIssue(device);
    if (linkIssue !== null) return reject(linkIssue);
    if (name === "flight-takeoff") {
      const battery = batteryPercent(device);
      if (battery === null) return reject("尚未取得所选飞机的电池遥测");
      if (battery < 20) return reject("电量低于 20%，不能起飞");
      const flightState = read(read(device, "connection"), "flightState");
      if (flightState === "flying") return reject("飞机已在空中，不能起飞");
      if (flightState !== "grounded") return reject("尚未确认飞机是否在地面，不能起飞");
      const motorsOn = read(read(device, "connection"), "motorsOn");
      if (motorsOn === true) return reject("电机已启动，不能起飞");
      if (motorsOn !== false) return reject("尚未确认电机是否关闭，不能起飞");
    }
    if (name === "flight-land" || name === "flight-return-home") {
      const flightState = read(read(device, "connection"), "flightState");
      if (flightState === "unknown" || flightState === null || flightState === undefined) return reject("尚未确认飞机是否在空中");
      if (flightState === "grounded") return reject(name === "flight-land" ? "飞机已在地面，无需降落" : "飞机已在地面，不能返航");
    }
    return accept();
  }
  if (name === "mission-stage") {
    const phase = text(read(current.mission, "phase"));
    if (phase !== null && phase !== "idle" && phase !== "completed" && phase !== "failed" && phase !== "disconnected") return reject("当前任务尚未结束，不能重新准备航线");
    return current.selectedRoute?.executable === true ? accept() : reject(current.selectedRoute?.blockedReason ?? "当前航线不能提交给飞机");
  }
  if (name === "mission-upload") {
    const phase = text(read(current.mission, "phase"));
    if (phase !== "staged") return reject("请先将航线传输到手机");
    const linkIssue = controlLinkIssue(device);
    if (linkIssue !== null) return reject(linkIssue);
    return waypointSupported(device) ? accept() : reject("所选机型未上报航线能力");
  }
  if (name === "mission-pause") {
    return text(read(current.mission, "phase")) === "running" ? accept() : reject("当前阶段不能暂停");
  }
  if (name === "mission-resume") {
    return text(read(current.mission, "phase")) === "paused" ? accept() : reject("当前阶段不能恢复");
  }
  if (name === "mission-stop") {
    const phase = text(read(current.mission, "phase"));
    return phase === "starting" || phase === "running" || phase === "pausing" || phase === "paused" || phase === "resuming" || phase === "disconnected" ? accept() : reject("当前阶段不能停止航线");
  }
  if (name !== "mission-start") return reject("未知操作");
  if (!waypointSupported(device)) return reject("所选机型未上报航线能力");
  const battery = batteryPercent(device);
  if (battery === null) return reject("尚未取得所选飞机的电池遥测");
  if (battery < 20) return reject("电量低于 20%，禁止启动或继续任务");
  const phase = text(read(current.mission, "phase"));
  if (phase !== "uploaded") return reject("请先将当前航线上传到所选飞机");
  const linkIssue = controlLinkIssue(device);
  if (linkIssue !== null) return reject(linkIssue);
  if (read(read(device, "connection"), "flightState") === "flying") return reject("飞机已在空中，禁止启动航线");
  if (read(read(device, "connection"), "flightState") !== "grounded") return reject("尚未确认飞机是否在地面，禁止启动航线");
  const motorsOn = read(read(device, "connection"), "motorsOn");
  if (motorsOn === true) return reject("电机已启动，禁止启动航线");
  if (motorsOn !== false) return reject("尚未确认电机是否关闭，禁止启动航线");
  return accept();
}

export const OperatorConsole = freeze({ project, evaluate });
