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

export interface OperatorLaneProgress {
  readonly headline: string;
  readonly command: string;
  readonly effect: string;
  readonly next: string;
}

export interface OperatorProgress {
  readonly mission: OperatorLaneProgress;
  readonly stream: OperatorLaneProgress;
  readonly flight: OperatorLaneProgress;
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
  readonly missionRoute: OperatorMissionRoute | null;
  readonly missionActions: OperatorMissionActions;
  readonly guidance: unknown;
  readonly routes: readonly OperatorRouteFact[];
  readonly selectedRoute: OperatorRouteFact | null;
  readonly missionLabel: string;
  readonly streamLabel: string;
  readonly progress: OperatorProgress;
  /** The phone has already requested recovery stop after the MSDK video source disappeared. */
  readonly streamSourceUnavailable: boolean;
  readonly playbackReady: boolean;
  readonly streamCanStart: boolean;
  readonly streamCanStop: boolean;
  /** Shared desktop media-service facts, independent of an individual phone stream. */
  readonly media: unknown;
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
  ...(read(connection, "msdk") === "ready" ? { sdkAvailability: "READY" } : read(connection, "msdk") === "starting" ? { sdkAvailability: "STARTING" } : read(connection, "msdk") === "stopped" ? { sdkAvailability: "STOPPED" } : read(connection, "msdk") === "failed" ? { sdkAvailability: "FAILED" } : {}),
  ...(read(connection, "remoteController") === "connected" ? { remoteController: "CONNECTED" } : read(connection, "remoteController") === "disconnected" ? { remoteController: "DISCONNECTED" } : {}),
  ...(read(connection, "flightController") === "connected" ? { flightController: "CONNECTED" } : read(connection, "flightController") === "disconnected" ? { flightController: "DISCONNECTED" } : {}),
});
const controlConnection = (device: Record<string, unknown> | undefined): unknown => {
  if (device === undefined) return null;
  return record(read(device, "control")) ?? read(device, "connection");
};
// The workflow's `connection` is the current raw MSDK projection. `control` is
// a stricter display/diagnostic compatibility projection and may be incomplete;
// it must not make an otherwise READY MSDK invocation look unreachable.
const invocationConnection = (device: Record<string, unknown> | undefined): unknown => {
  if (device === undefined) return null;
  const connection = record(read(device, "connection"));
  return connection !== null && read(connection, "msdk") !== undefined ? connection : controlConnection(device);
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
      : "该 KMZ 未通过与手机端一致的提交检查（需 wpmz/waylines.wpml、配套模板、恰好一条航线），仅可预览"
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
    case "WAYLINE_STOP_UNCONFIRMED": return "停止状态不确定：恢复手机和 MSDK 连接后可再次尝试停止";
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
    case "stopping": return "停止已提交，等待手机确认；结果未确认且连接恢复后可再次尝试停止";
    case "completed": return "已结束";
    case "failed": return missionFailureLabel(read(mission, "failureCode"));
    case "disconnected": return "与手机失联，飞机状态未知；重连后只能停止或重新准备航线";
    default: return "未开始";
  }
};
const streamSourceUnavailableOf = (device: Record<string, unknown> | undefined): boolean =>
  text(read(read(device, "stream"), "phase")) === "failed" && text(read(read(device, "stream"), "failureCode")) === "SOURCE_UNAVAILABLE";
const streamRuntimeErrorOf = (device: Record<string, unknown> | undefined): Readonly<{ readonly code: string; readonly description: string }> | null => {
  const error = read(read(read(device, "connection"), "live"), "runtimeError");
  const code = text(read(error, "code"));
  const description = text(read(error, "description"));
  return code === null || description === null ? null : freeze({ code, description });
};
const streamLabelOf = (device: Record<string, unknown> | undefined): string => {
  if (device === undefined) return "图传未就绪：未选择图传机";
  const streamPhase = text(read(read(device, "stream"), "phase"));
  // 停止命令尚未确认时，播放器的最后一帧不能覆盖控制车道的事实。
  if (streamPhase === "stopping") return "正在停止图传";
  if (streamSourceUnavailableOf(device)) return "图传源已断开，请恢复后手动启动图传";
  const runtimeError = streamRuntimeErrorOf(device);
  if (runtimeError !== null) return `DJI MSDK 图传运行回调：错误码：${runtimeError.code}；错误说明：${runtimeError.description}`;
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
  if (issue !== null) return `图传未就绪：${issue.label}`;
  const sourceState = text(read(read(device, "capabilities"), "liveVideo"));
  if (sourceState === "unsupported") return "图传可尝试启动（图传源当前报告未就绪）";
  if (sourceState !== "supported") return "图传可尝试启动（图传源状态未知）";
  return "图传可请求启动";
};
type StreamStartIssue = Readonly<{ readonly label: string; readonly reason: string }>;
const streamStartIssueOf = (device: Record<string, unknown> | undefined): StreamStartIssue | null => {
  if (device === undefined) return freeze({ label: "未选择图传机", reason: "请选择用于图传的飞机" });
  const connection = invocationConnection(device);
  const msdk = read(connection, "msdk");
  const sdkReady = msdk === undefined ? read(connection, "sdk") === "ready" : msdk === "ready";
  if (!sdkReady) return freeze({ label: "等待手机就绪", reason: "手机尚未就绪，无法启动图传" });
  const airLink = read(connection, "airLink");
  if (airLink !== "connected") return freeze({
    label: airLink === "disconnected" ? "AirLink 未连接" : "AirLink 状态未知",
    reason: airLink === "disconnected" ? "AirLink 未连接，无法启动图传" : "AirLink 状态未知，无法启动图传",
  });
  const camera = read(connection, "camera");
  if (camera !== "connected") return freeze({
    label: camera === "disconnected" ? "主相机未连接" : "主相机状态未知",
    reason: camera === "disconnected" ? "主相机未连接，无法启动图传" : "主相机状态未知，无法启动图传",
  });
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
  // This terminal state already has one recovery stop queued on the phone.
  if (streamSourceUnavailableOf(device)) return false;
  const streamPhase = text(read(read(device, "stream"), "phase"));
  // failed 也允许停：启动半成功或遥测抖动后控制态可能已 failed，手机仍可能在推。
  if (streamPhase === "starting" || streamPhase === "streaming" || streamPhase === "stopping" || streamPhase === "failed") return true;
  const videoPhase = text(read(read(device, "video"), "phase"));
  return videoPhase === "ready" || videoPhase === "awaiting-playback" || videoPhase === "awaiting-ingest";
};
const reject = (reason: string): OperatorActionResult => freeze({ ok: false, reason });
const accept = (): OperatorActionResult => freeze({ ok: true });
const msdkInvocationIssue = (device: Record<string, unknown>): string | null => {
  const connection = invocationConnection(device);
  const msdk = read(connection, "msdk");
  if (msdk !== undefined) return msdk === "ready" ? null : "手机尚未就绪";
  return read(connection, "sdk") === "ready" ? null : "手机尚未就绪";
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
const lastResultOf = (mission: unknown): Readonly<{ readonly operation: string | null; readonly ok: boolean | null; readonly code: string | null }> => {
  const last = record(read(mission, "lastResult"));
  return freeze({
    operation: text(read(last, "operation")),
    ok: last === null ? null : read(last, "ok") === true,
    code: text(read(last, "code")),
  });
};
const missionOperationLabel = (operation: string | null): string => {
  if (operation === "stage") return "准备航线";
  if (operation === "upload") return "上传至飞机";
  if (operation === "start") return "执行航线";
  if (operation === "pause") return "暂停航线";
  if (operation === "resume") return "恢复航线";
  if (operation === "stop") return "停止航线";
  return "航线操作";
};
const missionCommandOf = (mission: unknown, phase: string | null): string => {
  const last = lastResultOf(mission);
  if (last.code !== null && last.code.endsWith("_UNCONFIRMED")) return `${missionOperationLabel(last.operation)}结果未确认：不能判断飞机是否已执行`;
  if (last.ok === false && last.code === "WAYLINE_ACTION_REJECTED") return `${missionOperationLabel(last.operation)}被 DJI 明确拒绝`;
  if (last.ok === false && last.code === "PREFLIGHT_BLOCKED") return `${missionOperationLabel(last.operation)}未发出：手机或 MSDK 不可达`;
  if (phase === "staging") return "正在把航线传到手机并校验";
  if (phase === "uploading") return "正在把航线上传到飞机，等待 DJI 确认";
  if (phase === "starting") return "DJI 已接受执行航线，不等于飞机已进入航线";
  if (phase === "pausing") return "暂停命令已发出，等待 DJI 确认";
  if (phase === "resuming") return "恢复命令已发出，等待 DJI 确认";
  if (phase === "stopping") return "停止命令已发出，等待 DJI 确认";
  if (last.ok === true) return `${missionOperationLabel(last.operation)}调用已完成`;
  return "当前没有进行中的航线命令";
};
const missionEffectOf = (mission: unknown, phase: string | null): string => {
  if (read(mission, "routeExecutionStarted") === true || phase === "running") return "飞机正在执行航线";
  if (read(mission, "startPointReached") === true) return "飞机已进入首航点，尚未确认开始执行航线";
  if (phase === "starting") return "尚未收到当前任务的航线实际开始执行";
  if (phase === "paused") return "航线已暂停";
  if (phase === "uploaded") return "飞机已收到航线，尚未执行";
  if (phase === "staged") return "航线只在手机上，飞机尚未收到";
  if (phase === "completed") return "航线已结束";
  if (phase === "failed") return "任务失败，飞机效果以遥控器和飞机为准";
  if (phase === "disconnected") return "与手机失联，飞机状态未知";
  if (phase === "idle" || phase === null) return "没有当前任务效果";
  return "等待手机确认此次命令的设备效果";
};
const missionNextOf = (actions: OperatorMissionActions, phase: string | null, unconfirmedOperation: string | null): string => {
  if (unconfirmedOperation === "start") return "可再点执行。也可停止航线";
  if (unconfirmedOperation === "pause" || unconfirmedOperation === "resume") return "不得重复同一命令。可再点执行，也可停止航线";
  if (unconfirmedOperation === "stop") return "停止结果未确认。恢复手机和 MSDK 后可再次尝试停止";
  if (phase === "starting") return "等待进入航线。可停止，也可再点执行";
  if (actions.upload.enabled) return "下一步：点「上传至飞机」";
  if (actions.start.enabled) return "下一步：点「执行航线」";
  if (actions.pause.enabled) return "下一步：可暂停或停止航线";
  if (actions.resume.enabled) return "下一步：可恢复或停止航线";
  if (actions.stage.enabled) return "下一步：点「准备航线」";
  if (actions.stop.enabled) return "现在只能停止航线";
  return "当前没有可执行的航线命令";
};
const missionProgressOf = (mission: unknown, deviceId: string | null, actions: OperatorMissionActions, headline: string): OperatorLaneProgress => {
  if (deviceId === null) return freeze({ headline: "未选择任务机", command: "没有可发送的航线命令", effect: "没有当前任务", next: "请选择任务手机" });
  const phase = text(read(mission, "phase"));
  const last = lastResultOf(mission);
  const unconfirmed = last.code !== null && last.code.endsWith("_UNCONFIRMED") ? last.operation : null;
  return freeze({ headline, command: missionCommandOf(mission, phase), effect: missionEffectOf(mission, phase), next: missionNextOf(actions, phase, unconfirmed) });
};
const streamCommandOf = (device: Record<string, unknown> | undefined, playbackReady: boolean, sourceUnavailable: boolean, headline: string): string => {
  const phase = text(read(read(device, "stream"), "phase"));
  const failure = text(read(read(device, "stream"), "failureCode"));
  if (sourceUnavailable) return "图传源已断开，手机已排队恢复性停止";
  if (failure !== null && failure.endsWith("_UNCONFIRMED")) return "图传命令结果未确认：不能判断手机是否仍在推流";
  if (phase === "stopping") return "停止图传已发出，等待手机确认";
  if (phase === "starting" || phase === "streaming") return playbackReady ? "DJI 已接受启动图传" : "DJI 已接受启动图传，不等于电脑已收到画面";
  if (headline.startsWith("DJI MSDK 图传运行回调：")) return "启动后的运行回调报错，不是本次按钮的完成回执";
  if (phase === "failed") return "图传命令失败";
  return "当前没有进行中的图传命令";
};
const streamEffectOf = (playbackReady: boolean, device: Record<string, unknown> | undefined, sourceUnavailable: boolean): string => {
  const videoPhase = text(read(read(device, "video"), "phase"));
  if (sourceUnavailable) return "本地画面已失效，需要恢复后手动再启";
  if (playbackReady) return "电脑正在播放画面";
  if (videoPhase === "awaiting-playback") return "电脑已收到可播放地址，画面尚未挂上";
  if (videoPhase === "awaiting-ingest") return "手机已接受推流，电脑还在等 RTMP";
  const phase = text(read(read(device, "stream"), "phase"));
  if (phase === "starting" || phase === "streaming") return "电脑还没有可播放画面";
  if (phase === "stopping") return "停止尚未确认，最后一帧不能当成仍在图传";
  return "没有可播放画面";
};
const streamNextOf = (canStart: boolean, canStop: boolean, sourceUnavailable: boolean, phase: string | null, playbackReady: boolean): string => {
  if (sourceUnavailable) return "恢复 AirLink 和主相机后，再点「启动图传」";
  if (phase === "stopping") return canStart ? "等待停止确认。确认后可点「停止后重启图传」" : "等待停止确认。完成后才能重新启动";
  if (canStop || playbackReady) return "要结束请点「停止图传」";
  if (canStart) return "下一步：点「启动图传」";
  return "现在不能启动图传";
};
const streamProgressOf = (device: Record<string, unknown> | undefined, headline: string, canStart: boolean, canStop: boolean, playbackReady: boolean, sourceUnavailable: boolean): OperatorLaneProgress => {
  if (device === undefined) return freeze({ headline: "图传未就绪：未选择图传机", command: "没有可发送的图传命令", effect: "没有可播放画面", next: "请选择图传手机" });
  const phase = text(read(read(device, "stream"), "phase"));
  return freeze({
    headline,
    command: streamCommandOf(device, playbackReady, sourceUnavailable, headline),
    effect: streamEffectOf(playbackReady, device, sourceUnavailable),
    next: streamNextOf(canStart, canStop, sourceUnavailable, phase, playbackReady),
  });
};
const flightActionName = (action: string | null): string => {
  if (action === "takeoff") return "起飞";
  if (action === "land") return "降落";
  if (action === "confirm-landing") return "确认继续降落";
  if (action === "return-home") return "返航";
  if (action === "stop-takeoff") return "停止自动起飞";
  if (action === "stop-auto-landing") return "停止自动降落";
  return action ?? "飞行动作";
};
const flightProgressOf = (device: Record<string, unknown> | undefined, confirmation: OperatorConfirmation | null): OperatorLaneProgress => {
  if (device === undefined) return freeze({ headline: "未选择任务机", command: "没有可发送的飞行动作", effect: "没有当前飞行效果", next: "请选择任务手机" });
  const landing = text(read(read(device, "landing"), "phase"));
  const flying = text(read(read(device, "connection"), "flightState"));
  const motorsOn = read(read(device, "connection"), "motorsOn");
  if (confirmation !== null) {
    const label = flightActionName(confirmation.action);
    return freeze({
      headline: `等待人工确认：${label} 尚未调用 DJI`,
      command: `${label}尚未调用 DJI，只生成了本地确认`,
      effect: "飞机状态尚未因这次点击改变",
      next: "看确认框：确认后才会下发，取消则不发送",
    });
  }
  if (landing === "awaiting-msdk") {
    return freeze({
      headline: "DJI 已接受降落，等待落地确认",
      command: "DJI 已接受自动降落，不等于已经落地",
      effect: "仍在等待未飞行且电机关闭",
      next: "持续观察降落过程；需要时可停止自动降落",
    });
  }
  if (landing === "confirmation-required") {
    return freeze({
      headline: "DJI 要求确认继续降落",
      command: "降落已在进行，DJI 正在等确认继续降落",
      effect: "尚未确认落地",
      next: "下一步：确认继续降落，或停止自动降落",
    });
  }
  if (landing === "confirmed-grounded") {
    return freeze({
      headline: "已确认落地",
      command: "最近一次降落命令已被 DJI 接受",
      effect: "MSDK 持续状态：未飞行且电机关闭",
      next: "降落已完成，可进行下一步作业",
    });
  }
  if (landing === "stopped") {
    return freeze({
      headline: "自动降落已停止",
      command: "停止自动降落已提交",
      effect: "请以遥控器和飞行状态为准",
      next: "持续观察飞行状态后再决定下一步",
    });
  }
  if (landing === "state-unknown") {
    return freeze({
      headline: "降落命令已被接受，但飞行状态当前未知",
      command: "DJI 已接受降落",
      effect: "飞控状态不足以确认落地",
      next: "以遥控器为准，必要时停止自动降落",
    });
  }
  if (flying === "flying") {
    return freeze({
      headline: "飞机在空中，当前没有待确认的直接飞行动作",
      command: "当前没有进行中的直接飞行命令",
      effect: motorsOn === false ? "MSDK 报告在飞，电机状态未启动" : "MSDK 报告飞机在飞",
      next: "可请求降落、返航或停止类动作",
    });
  }
  return freeze({
    headline: "当前没有进行中的直接飞行动作",
    command: "当前没有进行中的直接飞行命令",
    effect: flying === "grounded" ? "MSDK 报告在地面" : "没有已确认的直接飞行效果",
    next: "可请求起飞、降落或返航",
  });
};
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
  const streamSourceUnavailable = streamSourceUnavailableOf(streamDevice);
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
    streamSourceUnavailable,
    playbackReady: videoPhase === "ready" && !streamSourceUnavailable,
    streamCanStart: streamCanStartOf(streamDevice),
    streamCanStop: streamCanStopOf(streamDevice),
    media: read(read(snapshot, "workflow"), "media"),
  };
  const missionActions = missionActionsOf(view);
  const progress = freeze({
    mission: missionProgressOf(mission, missionDeviceId, missionActions, view.missionLabel),
    stream: streamProgressOf(streamDevice, view.streamLabel, view.streamCanStart, view.streamCanStop, view.playbackReady, streamSourceUnavailable),
    flight: flightProgressOf(missionDevice, view.confirmation),
  });
  return freeze({ ...view, missionActions, progress });
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
    if (name === "stream-stop" && streamSourceUnavailableOf(device)) return reject("图传源已断开，手机已自动停止图传");
    return accept();
  }
  if (name === "flight-confirm" || name === "flight-cancel") return accept();
  if (name === "flight-takeoff" || name === "flight-land" || name === "flight-confirm-landing" || name === "flight-return-home" || name === "flight-stop-takeoff" || name === "flight-stop-auto-landing") {
    const linkIssue = msdkInvocationIssue(device);
    if (linkIssue !== null) return reject(linkIssue);
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
    const msdkIssue = msdkInvocationIssue(device);
    return msdkIssue === null ? accept() : reject(msdkIssue);
  }
  if (name === "mission-pause") {
    if (text(read(current.mission, "phase")) !== "running") return reject("当前阶段不能暂停");
    const msdkIssue = msdkInvocationIssue(device);
    return msdkIssue === null ? accept() : reject(msdkIssue);
  }
  if (name === "mission-resume") {
    if (text(read(current.mission, "phase")) !== "paused") return reject("当前阶段不能恢复");
    const msdkIssue = msdkInvocationIssue(device);
    return msdkIssue === null ? accept() : reject(msdkIssue);
  }
  if (name === "mission-stop") {
    const phase = text(read(current.mission, "phase"));
    if (phase !== "starting" && phase !== "running" && phase !== "pausing" && phase !== "paused" && phase !== "resuming" && phase !== "stopping" && phase !== "disconnected") return reject("当前阶段不能停止航线");
    const msdkIssue = msdkInvocationIssue(device);
    return msdkIssue === null ? accept() : reject(msdkIssue);
  }
  if (name !== "mission-start") return reject("未知操作");
  const phase = text(read(current.mission, "phase"));
  if (phase !== "uploaded" && phase !== "starting" && phase !== "pausing" && phase !== "resuming") return reject("请先将当前航线上传到所选飞机");
  const msdkIssue = msdkInvocationIssue(device);
  return msdkIssue === null ? accept() : reject(msdkIssue);
}

export const OperatorConsole = freeze({ project, evaluate });
