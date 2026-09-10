import flvjs from "flv.js";
import { OperatorConsole } from "../index.js";
import {
  ARM_HOLD_MS,
  adoptPendingConfirmation,
  buttonLabel,
  confirmationMatchesClick,
  expireArm,
  flightConfirmDispatch,
  interpretArmClick,
  isArmableAction,
  isSameClickFlightConfirm,
  sameClickConfirmDispatch,
  type ArmedCommand,
} from "../action-arm/index.js";
import {
  commandReachStatus,
  directAlertStatus,
  directProcessStatus,
  hudAltitude,
  hudBattery,
  hudFlying,
  hudMotors,
  hudText,
  interruptStatus,
  missionExecutionNowStatus,
  missionUploadOrActionStatus,
  streamErrorStatus,
  streamPaintStatus,
  streamPushStatus,
} from "../flight-now-status/index.js";
import { operationFeedback, type OperationFeedback } from "./operation-feedback.js";
import { createBackgroundRefresh, createRenderScheduler } from "./render-scheduler.js";
import { clearRoutePreview, drawnPreviewId, ensureRouteMap, locateDrawnRoute, routeMapNotice, setRouteMapVisible, showRoutePreview, type RouteMapPreview } from "./route-map.js";

type WorkspaceName = "devices" | "routes" | "flight";
type FlightPanelName = "stream" | "mission" | "direct-flight";
type MissionStartIntent = Readonly<{ deviceId: string; missionId: string; routeId: string; routeName: string }>;
type FlightConfirmationIntent = Readonly<{ deviceId: string; action: string; confirmationId: string; expiresAtMs: number }>;
type PhoneLinkProbeReport =
  | Readonly<{ readonly status: "measured"; readonly sampleCount: 10; readonly currentRttMs: number; readonly medianRttMs: number; readonly maximumRttMs: number; readonly jitterMs: number }>
  | Readonly<{ readonly status: "unavailable" | "timed-out" | "disconnected"; readonly sampleCount: number }>;
type PhoneLinkProbeCacheEntry = Readonly<{
  readonly connectionEpoch: number;
  readonly report: PhoneLinkProbeReport;
}>;
type RendererBridge = {
  readonly invoke: (name: string, input?: unknown) => Promise<unknown>;
  readonly relayHint?: string;
  readonly incidentLog?: string;
  readonly selectRouteFile?: () => Promise<{ ok?: boolean; fileName?: string; bytes?: Uint8Array }>;
};

const state: { workspace: WorkspaceName; flightPanel: FlightPanelName; missionDeviceId: string | null; streamDeviceId: string | null } = {
  workspace: "devices",
  flightPanel: "stream",
  missionDeviceId: null,
  streamDeviceId: null,
};

let lastSnapshot: unknown = {};
let lastRelayHint = "";
let lastRoutePreview: { readonly routeId: string; readonly preview: RouteMapPreview } | null = null;
let lastDeviceDetailHtml: string | null = null;
let lastPlaybackIdentity = "off";

const bridge = (): RendererBridge => {
  const api = (window as unknown as { skyCommand?: RendererBridge }).skyCommand;
  if (api === undefined || typeof api.invoke !== "function") throw new Error("渲染进程只能通过 skyCommand.invoke 访问网关");
  return api;
};

const renderAbortError = (): Error => {
  const error = new Error("Renderer redraw was superseded");
  error.name = "AbortError";
  return error;
};

const awaitCurrentRender = <T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> => {
  if (signal === undefined) return operation;
  if (signal.aborted) return Promise.reject(renderAbortError());
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => { cleanup(); reject(renderAbortError()); };
    const cleanup = (): void => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    void operation.then(
      (value) => { cleanup(); signal.aborted ? reject(renderAbortError()) : resolve(value); },
      (error: unknown) => { cleanup(); reject(error); },
    );
  });
};

const unwrap = (result: unknown): unknown => {
  if (result === null || typeof result !== "object" || !("ok" in result) || !("value" in result) || (result as { ok: unknown }).ok !== true) return result;
  return (result as { value?: unknown }).value;
};

const unwrapAll = (result: unknown): unknown => {
  let current = result;
  for (let step = 0; step < 4; step += 1) {
    const next = unwrap(current);
    if (next === current) return current;
    current = next;
  }
  return current;
};

const safeRenderInvoke = async (name: string, input: unknown, signal?: AbortSignal): Promise<unknown | null> => {
  try {
    return await awaitCurrentRender(bridge().invoke(name, input), signal);
  } catch {
    return null;
  }
};

const read = (value: unknown, key: string): unknown => value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined;
const text = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 ? value : null;
const selectedFlightDevice = (view: ReturnType<typeof OperatorConsole.project>, deviceId: string | null): Record<string, unknown> | undefined =>
  (view.devices as readonly unknown[]).find((device): device is Record<string, unknown> =>
    device !== null && typeof device === "object" && !Array.isArray(device) && read(device, "deviceId") === deviceId,
  );
const connectionOf = (device: Record<string, unknown> | undefined): unknown => device === undefined ? null : read(device, "connection");
const relayStatus = (device: Record<string, unknown> | undefined): string => {
  if (device === undefined) return "未选择手机";
  const value = read(connectionOf(device), "relay");
  return value === "online" ? "在线" : value === "offline" ? "离线" : "状态未知";
};
const msdkStatus = (device: Record<string, unknown> | undefined): string => {
  if (device === undefined) return "未选择手机";
  const value = read(connectionOf(device), "msdk");
  if (value === "ready") return "已就绪";
  if (value === "starting") return "初始化中";
  if (value === "failed") return "初始化失败";
  if (value === "stopped") return "已停止";
  return "状态未知";
};
const linkStatus = (device: Record<string, unknown> | undefined, field: string): string => {
  if (device === undefined) return "未选择手机";
  const value = read(connectionOf(device), field);
  return value === "connected" ? "已连接" : value === "disconnected" ? "已断开" : "状态未知";
};
const flightStateStatus = (device: Record<string, unknown> | undefined): string => {
  if (device === undefined) return "未选择手机";
  const value = read(connectionOf(device), "flightState");
  return value === "flying" ? "飞行中" : value === "grounded" ? "地面" : value === "unknown" ? "状态未知" : "尚未取得";
};
const booleanStatus = (device: Record<string, unknown> | undefined, field: string, positive: string, negative: string): string => {
  if (device === undefined) return "未选择手机";
  const value = read(connectionOf(device), field);
  return value === true ? positive : value === false ? negative : "尚未取得";
};
const batteryStatus = (device: Record<string, unknown> | undefined): string => {
  if (device === undefined) return "未选择手机";
  const value = read(connectionOf(device), "batteryPercent");
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}%` : "尚未取得";
};
const enumStatus = (device: Record<string, unknown> | undefined, field: string): string => {
  if (device === undefined) return "未选择手机";
  return text(read(connectionOf(device), field)) ?? "尚未取得";
};
const cameraFrameFact = (source: unknown): unknown => read(source, "cameraFrames");
const cameraFrameStatus = (source: unknown): string => {
  switch (read(cameraFrameFact(source), "state")) {
    case "unavailable": return "当前未启用帧观察（UNAVAILABLE）";
    case "unobserved": return "已监听，尚未收到相机编码帧（UNOBSERVED）";
    case "receiving": return "正在收到相机编码帧（RECEIVING）";
    case "stalled": return "曾收到帧，当前未见新帧（STALLED）";
    default: return "手机端尚未提供帧观察";
  }
};
const cameraFrameGenerationStatus = (source: unknown): string => {
  const generation = finiteNumber(read(cameraFrameFact(source), "generation"));
  return generation === null || !Number.isSafeInteger(generation) || generation < 0 ? "尚未取得" : String(generation);
};
const cameraFrameCountStatus = (source: unknown): string => {
  const count = finiteNumber(read(cameraFrameFact(source), "receivedFrameCount"));
  return count === null || !Number.isSafeInteger(count) || count < 0 ? "尚未收到有效帧" : `${count} 帧`;
};
const cameraFrameAgeStatus = (source: unknown): string => {
  const age = finiteNumber(read(cameraFrameFact(source), "lastFrameAgeMillis"));
  return age === null || !Number.isSafeInteger(age) || age < 0 ? "尚未取得" : `${age} ms`;
};
const cameraFrameFormatStatus = (source: unknown): string => {
  const frames = cameraFrameFact(source);
  const codec = optionalText(read(frames, "codec"));
  const width = finiteNumber(read(frames, "width"));
  const height = finiteNumber(read(frames, "height"));
  const frameRate = finiteNumber(read(frames, "frameRate"));
  const format = width === null || height === null ? null : `${width} x ${height}`;
  const rate = frameRate === null ? null : `${frameRate} fps`;
  const parts = [codec, format, rate].filter((part): part is string => part !== null);
  return parts.length === 0 ? "尚未取得" : parts.join(" · ");
};
const directFlightObservationStatus = (device: Record<string, unknown> | undefined, operation: "takeoff" | "landing" | "return-home"): string => {
  if (device === undefined) return "未选择手机";
  const connection = connectionOf(device);
  const flying = read(connection, "flightState");
  const motorsOn = read(connection, "motorsOn");
  if (operation === "takeoff") {
    if (flying === "flying" && motorsOn === true) return "已观测到飞行中且电机已启动";
    return "尚未观测到起飞完成";
  }
  if (operation === "landing") {
    if (flying === "grounded" && motorsOn === false) return "已观测到未飞行且电机已关闭";
    if (read(connection, "landingConfirmationNeeded") === true) return "MSDK 报告需要确认继续降落";
    return "尚未观测到落地完成";
  }
  const mode = optionalText(read(connection, "flightMode"));
  return mode === null ? "尚未取得飞行模式或位置" : `当前飞行模式：${mode}；返航实际过程仍需持续观察`;
};
const landingProgressStatus = (landingPhase: string | null, device: Record<string, unknown> | undefined): string => {
  if (device === undefined) return "未选择手机";
  const connection = connectionOf(device);
  const flying = read(connection, "flightState");
  const motorsOn = read(connection, "motorsOn");
  if (landingPhase === "idle" || landingPhase === null) return "未请求降落";
  if (landingPhase === "stopped") return "自动降落已停止；请持续观察飞行状态";
  if (landingPhase === "state-unknown") return "降落命令已被接受，但飞行状态当前未知";
  if (landingPhase === "confirmed-grounded" || (flying === "grounded" && motorsOn === false)) {
    return "已确认落地（MSDK 持续状态：未飞行且电机关闭）";
  }
  const protection = text(read(connection, "landingProtectionState"));
  const mode = text(read(connection, "flightMode"));
  if (protection === "NOT_SAFE_TO_LAND") return "DJI 降落保护报告当前不适合降落，自动降落已暂停";
  if (read(connection, "landingConfirmationNeeded") === true) {
    return "DJI 要求确认继续降落，等待持续飞行状态确认";
  }
  if (mode === "CONFIRM_LANDING") return "DJI 正在确认继续降落，等待持续飞行状态确认";
  if (mode === "AUTO_LANDING") return "DJI 正在自动降落，等待持续飞行状态确认";
  return "DJI 已接受降落命令，等待持续飞行状态确认";
};
const missionIntegerStatus = (device: Record<string, unknown> | undefined, field: string): string => {
  if (device === undefined) return "未选择手机";
  const value = read(connectionOf(device), field);
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : "尚未取得";
};
const selectedRouteStatus = (view: ReturnType<typeof OperatorConsole.project>): string =>
  text(read(read(view, "selectedRoute"), "displayName")) ?? "尚未选择";
const assignedMissionRouteStatus = (view: ReturnType<typeof OperatorConsole.project>): string =>
  text(read(read(view, "missionRoute"), "displayName")) ?? "当前没有桌面任务";
const missionExecutionLabels: Readonly<Record<string, string>> = Object.freeze({
  NOT_STARTED: "手机已暂存，尚未启动",
  STARTING: "手机任务正在启动",
  EXECUTING: "手机报告执行中",
  PAUSED: "手机报告已暂停",
  STOPPING: "手机任务正在停止",
  FINISHED: "手机报告已结束",
  FAILED: "手机报告执行失败",
});
const missionPhoneExecutionStatus = (device: Record<string, unknown> | undefined): string => {
  if (device === undefined) return "未选择手机";
  const value = text(read(connectionOf(device), "missionExecution"));
  if (value === null) return "尚未取得";
  return missionExecutionLabels[value] === undefined ? `手机返回未知任务状态（${value}）` : `${missionExecutionLabels[value]}（${value}）`;
};
const missionUploadProgressStatus = (device: Record<string, unknown> | undefined): string => {
  if (device === undefined) return "未选择手机";
  const progress = read(connectionOf(device), "missionUploadProgress");
  if (typeof progress !== "number" || !Number.isSafeInteger(progress) || progress < 0 || progress > 100) return "未报告上传";
  return progress === 100 ? "已报告 100%（不代表已执行）" : `上传中 ${progress}%`;
};
const missionDjiExecutionLabels: Readonly<Record<string, string>> = Object.freeze({
  IDLE: "DJI 报告空闲",
  READY: "DJI 报告就绪",
  UPLOADING: "DJI 正在上传航线",
  PREPARING: "DJI 正在准备航线",
  RECOVERING: "DJI 正在恢复任务",
  ENTER_WAYLINE: "DJI 报告进入首航点",
  EXECUTING: "DJI 报告执行中",
  PAUSED: "DJI 报告已暂停",
  INTERRUPTED: "DJI 报告已中断",
  FINISHED: "DJI 报告已完成",
  RETURN_TO_START_POINT: "DJI 正在返回起点",
  DISCONNECTED: "DJI 报告执行链路断开",
  NOT_SUPPORTED: "当前设备不支持航线执行",
  UNKNOWN: "DJI 返回未知执行状态",
});
const missionDjiExecutionStatus = (device: Record<string, unknown> | undefined): string => {
  if (device === undefined) return "未选择手机";
  const value = text(read(connectionOf(device), "missionDjiExecutionState"));
  if (value === null) return "当前任务暂无 DJI 执行观察";
  return missionDjiExecutionLabels[value] === undefined ? `DJI 返回未识别执行状态（${value}）` : `${missionDjiExecutionLabels[value]}（${value}）`;
};
const missionWaypointIndexStatus = (device: Record<string, unknown> | undefined): string => {
  if (device === undefined) return "未选择手机";
  const value = read(connectionOf(device), "currentWaypointIndex");
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? `航点 ${value}` : "尚未取得";
};
const missionWaylineIdStatus = (device: Record<string, unknown> | undefined): string => {
  if (device === undefined) return "未选择手机";
  const value = read(connectionOf(device), "waylineId");
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : "尚未取得";
};
const missionExecutingFileStatus = (device: Record<string, unknown> | undefined): string => {
  if (device === undefined) return "未选择手机";
  return text(read(connectionOf(device), "waylineExecutingMissionFileName")) ?? "尚未取得";
};
const missionWaypointActionStatus = (device: Record<string, unknown> | undefined): string => {
  if (device === undefined) return "未选择手机";
  const connection = connectionOf(device);
  const phase = text(read(connection, "waypointActionPhase"));
  const actionId = read(connection, "waypointActionId");
  if (phase === null || typeof actionId !== "number" || !Number.isSafeInteger(actionId) || actionId < 0) return "尚未取得";
  const group = read(connection, "waypointActionGroup");
  const groupText = typeof group === "number" && Number.isSafeInteger(group) && group >= 0 ? `动作组 ${group} / ` : "";
  const phaseText = phase === "START" ? "进行中" : phase === "FINISH" ? "已结束" : phase;
  const errorCode = text(read(connection, "waypointActionErrorCode"));
  const errorDescription = text(read(connection, "waypointActionErrorDescription"));
  const errorText = errorCode !== null ? `；${errorCode}${errorDescription !== null ? ` ${errorDescription}` : ""}` : "";
  return `${groupText}动作 ${actionId} · ${phaseText}${errorText}`;
};
const missionWaylineInterruptStatus = (device: Record<string, unknown> | undefined): string => {
  if (device === undefined) return "未选择手机";
  const code = text(read(connectionOf(device), "waylineInterruptErrorCode"));
  const description = text(read(connectionOf(device), "waylineInterruptErrorDescription"));
  if (code === null && description === null) return "尚未取得";
  return [code, description].filter((part): part is string => part !== null).join(" ");
};
const missionMilestoneStatus = (view: ReturnType<typeof OperatorConsole.project>, field: "startPointReached" | "routeExecutionStarted"): string => {
  if (view.missionDeviceId === null) return "未选择手机";
  const mission = read(view, "mission");
  if (mission === null || typeof mission !== "object") return "当前没有桌面任务";
  return read(mission, field) === true ? "DJI 已确认" : "尚未确认";
};
const knownStatus = (value: string): string | null =>
  value === "尚未取得" || value === "未选择手机" || value === "未报告上传" || value === "当前任务暂无 DJI 执行观察" ? null : value;

const renderFlightStatus = (name: string, value: string): void => {
  const node = document.querySelector(`[data-flight-status="${name}"]`);
  if (node instanceof HTMLElement) node.textContent = value;
};
const renderFlightHud = (name: string, value: string): void => {
  const node = document.querySelector(`[data-flight-hud="${name}"]`);
  if (node instanceof HTMLElement) node.textContent = value;
};
function renderFlightPanelStatus(view: ReturnType<typeof OperatorConsole.project>): void {
  const streamDevice = selectedFlightDevice(view, view.streamDeviceId);
  const missionDevice = selectedFlightDevice(view, view.missionDeviceId);
  const streamConnection = connectionOf(streamDevice);
  const live = read(streamConnection, "live");
  const streaming = read(live, "streaming");
  const player = document.getElementById("video");
  const painting = streamDevice !== undefined && player instanceof HTMLVideoElement && isPainting(player);
  renderFlightStatus("stream-reach", commandReachStatus({
    selected: streamDevice !== undefined,
    relayOnline: relayStatus(streamDevice) === "在线",
    msdkReady: msdkStatus(streamDevice) === "已就绪",
    airLinkConnected: linkStatus(streamDevice, "airLink") === "已连接",
    cameraConnected: linkStatus(streamDevice, "camera") === "已连接",
  }));
  renderFlightStatus("stream-push", streamPushStatus({
    selected: streamDevice !== undefined,
    streaming: streaming === true ? true : streaming === false ? false : null,
    resolution: text(read(live, "resolution")),
    fps: typeof read(live, "fps") === "number" || typeof read(live, "fps") === "string" ? read(live, "fps") as string | number : null,
  }));
  renderFlightStatus("stream-paint", streamPaintStatus({ selected: streamDevice !== undefined, painting }));
  const runtimeError = read(live, "runtimeError");
  renderFlightStatus("stream-msdk-runtime-error", streamErrorStatus({
    selected: streamDevice !== undefined,
    code: text(read(runtimeError, "code")),
    description: text(read(runtimeError, "description")),
  }));

  const missionConnection = connectionOf(missionDevice);
  renderFlightStatus("mission-reach", commandReachStatus({
    selected: missionDevice !== undefined,
    relayOnline: relayStatus(missionDevice) === "在线",
    msdkReady: msdkStatus(missionDevice) === "已就绪",
  }));
  renderFlightStatus("mission-execution-now", missionExecutionNowStatus({
    selected: missionDevice !== undefined,
    execution: knownStatus(missionDjiExecutionStatus(missionDevice)),
    waypoint: knownStatus(missionWaypointIndexStatus(missionDevice)),
    fileName: knownStatus(missionExecutingFileStatus(missionDevice)),
  }));
  const uploadRaw = read(missionConnection, "missionUploadProgress");
  renderFlightStatus("mission-upload-or-action", missionUploadOrActionStatus({
    selected: missionDevice !== undefined,
    uploadPercent: typeof uploadRaw === "number" && Number.isSafeInteger(uploadRaw) ? uploadRaw : null,
    action: knownStatus(missionWaypointActionStatus(missionDevice)),
  }));
  renderFlightStatus("mission-wayline-interrupt", interruptStatus({
    selected: missionDevice !== undefined,
    code: text(read(missionConnection, "waylineInterruptErrorCode")),
    description: text(read(missionConnection, "waylineInterruptErrorDescription")),
  }));

  const directConnection = connectionOf(missionDevice);
  const flying = text(read(directConnection, "flightState"));
  const motorsOn = read(directConnection, "motorsOn");
  const directRthState = read(directConnection, "lowBatteryRthState");
  renderFlightStatus("direct-reach", commandReachStatus({
    selected: missionDevice !== undefined,
    relayOnline: relayStatus(missionDevice) === "在线",
    msdkReady: msdkStatus(missionDevice) === "已就绪",
  }));
  renderFlightStatus("direct-process", directProcessStatus({
    selected: missionDevice !== undefined,
    flying,
    motorsOn: motorsOn === true ? true : motorsOn === false ? false : null,
    flightMode: text(read(directConnection, "flightMode")),
    landingConfirmationNeeded: read(directConnection, "landingConfirmationNeeded") === true,
    lowBatteryRthState: text(directRthState),
  }));
  renderFlightStatus("direct-landing-protection", enumStatus(missionDevice, "landingProtectionState") === "尚未取得" ? "—" : enumStatus(missionDevice, "landingProtectionState"));
  renderFlightStatus("direct-landing-confirmation", booleanStatus(missionDevice, "landingConfirmationNeeded", "需要确认", "不需要"));
  const rthLabel = directRthState === "UNKNOWN"
    ? "未知（MSDK 返回 UNKNOWN）"
    : lowBatteryRthLabel(directRthState);
  const rthRemain = directRthState === "UNKNOWN" ? null : durationLabel(read(directConnection, "remainingFlightTimeSeconds"));
  renderFlightStatus("direct-low-battery-rth", rthLabel === null ? "—" : rthRemain === null ? rthLabel : `${rthLabel} · ${rthRemain}`);
  renderFlightStatus("direct-alert", directAlertStatus({
    selected: missionDevice !== undefined,
    takeoffFailure: knownStatus(enumStatus(missionDevice, "takeoffFailureError")),
    motorStartFailure: knownStatus(enumStatus(missionDevice, "motorStartFailureError")),
    visionWarning: knownStatus(enumStatus(missionDevice, "visionSystemWarning")),
  }));

  const pose = read(directConnection, "pose");
  renderFlightHud("flying", hudFlying(flying));
  renderFlightHud("motors", hudMotors(motorsOn === true ? true : motorsOn === false ? false : null));
  renderFlightHud("battery", hudBattery(read(directConnection, "batteryPercent")));
  renderFlightHud("altitude", hudAltitude(read(pose, "altitudeMeters")));
  renderFlightHud("gps", hudText(read(directConnection, "gpsSignalLevel")));
  renderFlightHud("mode", hudText(read(directConnection, "flightMode")));
}

function renderFlightPanelVisibility(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-flight-panel]").forEach((button) => {
    const active = button.dataset.flightPanel === state.flightPanel;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll<HTMLElement>("[data-flight-panel-view]").forEach((panel) => {
    panel.hidden = panel.dataset.flightPanelView !== state.flightPanel;
  });
}

const renderFlightConfirmationFallback = (): void => {
  pendingFlightConfirmation = adoptPendingConfirmation(pendingFlightConfirmation, null, Date.now());
};

const renderMissionStartConfirmationFallback = (): void => {
  /* 确认意图保留在 pendingMissionStart / armedCommand，不再写入独立确认框。 */
};

const clearArmTimer = (): void => {
  if (armExpiryTimer !== null) {
    window.clearTimeout(armExpiryTimer);
    armExpiryTimer = null;
  }
};

const scheduleArmExpiry = (): void => {
  clearArmTimer();
  if (armedCommand === null) return;
  const remain = ARM_HOLD_MS - (Date.now() - armedCommand.armedAtMs);
  armExpiryTimer = window.setTimeout(() => { void expireArmedCommand(); }, Math.max(0, remain));
};

const cancelArmedBackend = async (): Promise<void> => {
  if (armedCommand === null) return;
  if (armedCommand.action === "mission-start") {
    pendingMissionStart = null;
    return;
  }
  const confirmation = pendingFlightConfirmation;
  if (confirmation === null) return;
  pendingFlightConfirmation = null;
  await run("flight-cancel", "flight-cancel", { deviceId: confirmation.deviceId, confirmationId: confirmation.confirmationId }, undefined, `flight-${confirmation.action}`);
};

const expireArmedCommand = async (): Promise<void> => {
  if (armedCommand === null) return;
  await cancelArmedBackend();
  armedCommand = null;
  clearArmTimer();
  await render();
};

type OperationFeedbackRecord = Readonly<{
  readonly deviceId: string | null;
  readonly connectionEpoch: number | null;
  readonly feedback: OperationFeedback;
}>;
const feedbackByAction = new Map<string, OperationFeedbackRecord>();
// `operationFeedback` owns the wording, including the literal "DJI MSDK 回调" for
// an actual structured callback. The renderer only chooses the correct operation lane.

const el = (id: string): HTMLElement => {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`缺少 ${id}`);
  return node;
};

const show = (message: string): void => { el("status").textContent = message; };

const feedbackForDevice = (action: string, deviceId: string | null, connectionEpoch: number | null, feedback: OperationFeedback): void => {
  feedbackByAction.set(action, Object.freeze({ deviceId, connectionEpoch, feedback }));
};

const feedbackDeviceEpoch = (view: ReturnType<typeof OperatorConsole.project>, deviceId: string | null): number | null => {
  if (deviceId === null) return null;
  const device = (view.devices as readonly unknown[]).find((item) => read(item, "deviceId") === deviceId);
  const epoch = read(device, "connectionEpoch");
  return typeof epoch === "number" && Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : null;
};

const captureFeedback = (action: string, deviceId: string | null, connectionEpoch: number | null, value: unknown): OperationFeedback => {
  const feedback = operationFeedback(action, value);
  feedbackForDevice(action, deviceId, connectionEpoch, feedback);
  return feedback;
};

const renderOperationFeedback = (action: string, deviceId: string | null, connectionEpoch: number | null): void => {
  const node = document.querySelector(`[data-operation-feedback="${action}"]`);
  if (!(node instanceof HTMLElement)) return;
  const record = feedbackByAction.get(action);
  const visible = record !== undefined && record.deviceId === deviceId && (deviceId === null || record.connectionEpoch === connectionEpoch);
  node.textContent = visible ? record.feedback.message : "";
  if (visible) {
    node.dataset.feedbackSource = record.feedback.source;
    node.dataset.feedbackOutcome = record.feedback.outcome;
  } else {
    delete node.dataset.feedbackSource;
    delete node.dataset.feedbackOutcome;
  }
};

const flightActionLabel = (action: unknown): string => {
  if (action === "takeoff") return "起飞";
  if (action === "land") return "降落";
  if (action === "confirm-landing") return "确认继续降落";
  if (action === "return-home" || action === "returnHome" || action === "rth") return "返航";
  if (action === "stop-takeoff") return "停止自动起飞";
  if (action === "stop-auto-landing") return "停止自动降落";
  return typeof action === "string" && action.length > 0 ? action : "该动作";
};

const operatorNotice = (value: unknown): string => {
  const inner = unwrap(value);
  const codeOf = (source: unknown): string | null => typeof read(source, "code") === "string" ? read(source, "code") as string : null;
  const reasonOf = (source: unknown): string | null => typeof read(source, "reason") === "string" ? read(source, "reason") as string : null;
  const reason = reasonOf(inner) ?? reasonOf(value);
  const code = codeOf(inner) ?? codeOf(value);
  const platformError = read(inner, "platformError") ?? read(value, "platformError");
  if (code === "HARDWARE_NOT_READY") {
    const blockers = read(inner, "blockers") ?? read(value, "blockers");
    if (Array.isArray(blockers)) {
      const messages = blockers.map((item) => read(item, "message")).filter((message): message is string => typeof message === "string" && message.length > 0);
      if (messages.length > 0) return messages.join("；");
    }
    return "电脑图传接收条件未满足";
  }
  if (reason === "ANOTHER_VIDEO_TRANSPORT_ACTIVE") return "另一路图传正在使用，请先停止";
  if (reason === "VIDEO_TRANSPORT_FAILED") return "图传未能完成";
  if (reason === "VIDEO_TRANSPORT_UNAVAILABLE") return "图传当前不可用";
  if (code === "FLIGHT_ACTION_REJECTED") {
    const djiCode = text(read(platformError, "code"));
    const description = text(read(platformError, "description"));
    return description === null ? "DJI 拒绝了该飞行命令" : `DJI 拒绝${flightActionLabel(read(inner, "action"))}：${description}${djiCode === null ? "" : `（${djiCode}）`}`;
  }
  if (code === "RESULT_UNCONFIRMED") return "未收到 DJI 本次命令的最终结果；请以遥控器和飞行器实际状态为准";
  if (code === "FLIGHT_ACTION_INVOCATION_FAILED") return "手机在取得 DJI 命令结果前发生错误；本次命令未获确认";
  if (code === "RELAY_REJECTED") return "手机拒绝了该命令，请在手机上看原因后重试";
  if (read(inner, "ok") === true && read(inner, "action") === "land") return "DJI 已接受自动降落，正在等待 MSDK 回报落地或继续确认";
  if (code === "CAPABILITY_BLOCKED") {
    if (reason === "RELAY_OFFLINE") return "手机已离线，无法发送图传命令";
    if (reason === "SDK_NOT_READY") return "手机端 DJI 尚未就绪，无法启动图传";
    if (reason === "AIRLINK_OFFLINE") return "AirLink 未连接，未调用 DJI MSDK 启动图传";
    if (reason === "AIRLINK_CONNECTION_UNKNOWN") return "AirLink 状态未知，未调用 DJI MSDK 启动图传";
    if (reason === "CAMERA_OFFLINE") return "主相机未连接，未调用 DJI MSDK 启动图传";
    if (reason === "CAMERA_CONNECTION_UNKNOWN") return "主相机状态未知，未调用 DJI MSDK 启动图传";
    return "图传命令此刻不可达，请确认手机中继与 MSDK 状态后重试";
  }
  if (code === "OPERATION_IN_PROGRESS") return "上一条命令还在处理，请稍候";
  if (code === "VIDEO_NOT_READY") return "画面还没出来，请稍候或重新启动图传";
  if (code === "STATUS_REFRESH_FAILED") return "本次状态快照未通过验证，请确认手机仍在线后重试";
  if (code === "DISCONNECTED") return "手机已离线，请先在设备页连上手机";
  if (code === "DEPENDENCY_FAILURE") return "暂时无法完成，请稍后重试";
  if (read(inner, "ok") === true) return "已发送到手机";
  if (read(value, "ok") === true && read(inner, "ok") !== false) return "已发送到手机";
  return code === null ? "已发送到手机" : "暂时无法完成，请稍后重试";
};

let flvPlayer: ReturnType<typeof flvjs.createPlayer> | null = null;
let attachedUrl: string | null = null;
let flvFatalStreak = 0;
let flvRecoverTimer: number | null = null;
let lastPlaybackHealthAt = 0;
let attachedAtMs = 0;
let lastPaintAtMs = 0;
let lastSeenCurrentTime = 0;
let selectedPlaybackDeviceId: string | null = null;
let pendingMissionStart: MissionStartIntent | null = null;
let pendingFlightConfirmation: FlightConfirmationIntent | null = null;
let armedCommand: ArmedCommand | null = null;
let armExpiryTimer: number | null = null;
let videoPlayRetryTimer: number | null = null;
let videoPlayEventsBoundTo: HTMLVideoElement | null = null;
const phoneLinkProbes = new Map<string, PhoneLinkProbeCacheEntry>();
let phoneLinkProbeInFlightDeviceId: string | null = null;

const NO_FRAME_MS = 8_000;
const STALL_MS = 12_000;

const clearFlvRecoverTimer = (): void => {
  if (flvRecoverTimer === null) return;
  window.clearTimeout(flvRecoverTimer);
  flvRecoverTimer = null;
};

const isPainting = (video: HTMLVideoElement): boolean =>
  video.videoWidth > 0 && !video.paused && Number.isFinite(video.currentTime) && video.currentTime > 0;

const clearVideoPlayRetry = (): void => {
  if (videoPlayRetryTimer === null) return;
  window.clearTimeout(videoPlayRetryTimer);
  videoPlayRetryTimer = null;
};

const scheduleVideoPlay = (video: HTMLVideoElement): void => {
  clearVideoPlayRetry();
  videoPlayRetryTimer = window.setTimeout(() => {
    videoPlayRetryTimer = null;
    if (flvPlayer === null || attachedUrl === null) return;
    if (!video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
    void video.play().catch((error: unknown) => {
      const name = error instanceof Error ? error.name : "";
      if (name === "NotAllowedError") show("自动播放被拦截，请点一下上方画面");
    });
  }, 0);
};

const bindVideoPlayEvents = (video: HTMLVideoElement): void => {
  if (videoPlayEventsBoundTo === video) return;
  const onReady = (): void => { scheduleVideoPlay(video); };
  for (const event of ["loadedmetadata", "loadeddata", "canplay", "playing"] as const) {
    video.addEventListener(event, onReady);
  }
  videoPlayEventsBoundTo = video;
  (video as HTMLVideoElement & { __skyCommandPlayReady?: () => void }).__skyCommandPlayReady = onReady;
};

const unbindVideoPlayEvents = (video: HTMLVideoElement): void => {
  const onReady = (video as HTMLVideoElement & { __skyCommandPlayReady?: () => void }).__skyCommandPlayReady;
  if (onReady === undefined) return;
  for (const event of ["loadedmetadata", "loadeddata", "canplay", "playing"] as const) {
    video.removeEventListener(event, onReady);
  }
  delete (video as HTMLVideoElement & { __skyCommandPlayReady?: () => void }).__skyCommandPlayReady;
  if (videoPlayEventsBoundTo === video) videoPlayEventsBoundTo = null;
};

const detachVideo = (): void => {
  clearFlvRecoverTimer();
  clearVideoPlayRetry();
  const video = el("video") as HTMLVideoElement;
  unbindVideoPlayEvents(video);
  if (flvPlayer !== null) {
    try { flvPlayer.pause(); } catch { /* ignore */ }
    try { flvPlayer.unload(); } catch { /* ignore */ }
    try { flvPlayer.detachMediaElement(); } catch { /* ignore */ }
    try { flvPlayer.destroy(); } catch { /* ignore */ }
    flvPlayer = null;
  }
  attachedUrl = null;
  lastPlaybackIdentity = "off";
  attachedAtMs = 0;
  lastPaintAtMs = 0;
  lastSeenCurrentTime = 0;
  selectedPlaybackDeviceId = null;
  video.removeAttribute("src");
  video.srcObject = null;
  video.load();
};

const playVideo = (video: HTMLVideoElement): void => {
  video.muted = true;
  video.defaultMuted = true;
  video.volume = 0;
  video.setAttribute("playsinline", "");
  scheduleVideoPlay(video);
};

const softReloadFlv = (video: HTMLVideoElement): boolean => {
  const url = attachedUrl;
  if (url === null) return false;
  // unload/load 容易叠两条 HTTP；整段销毁再挂可保证单连接。
  try {
    detachVideo();
    attachVideo(url);
    playVideo(video);
    return flvPlayer !== null;
  } catch {
    return false;
  }
};

const chaseLiveEdge = (video: HTMLVideoElement): void => {
  if (flvPlayer === null || attachedUrl === null || !isPainting(video)) return;
  try {
    if (video.buffered.length === 0) return;
    const end = video.buffered.end(video.buffered.length - 1);
    if (!Number.isFinite(end)) return;
    const lag = end - video.currentTime;
    // 直播积压超过约 1.2s 就追到前沿，避免「一顿一顿往前赶」。
    if (lag > 1.2) video.currentTime = Math.max(0, end - 0.25);
  } catch { /* ignore */ }
};

const scheduleFlvReattach = (retryUrl: string): void => {
  clearFlvRecoverTimer();
  const delayMs = Math.min(5_000, 800 * (2 ** Math.min(flvFatalStreak - 1, 3)));
  flvRecoverTimer = window.setTimeout(() => {
    flvRecoverTimer = null;
    attachVideo(retryUrl);
  }, delayMs);
};

const recoverStuckFlv = (video: HTMLVideoElement, url: string, reason: string): void => {
  if (flvRecoverTimer !== null) return;
  flvFatalStreak += 1;
  if (flvFatalStreak <= 3 && softReloadFlv(video)) {
    show(`${reason}，正在自动恢复…`);
    return;
  }
  show(`${reason}，正在重新连接…`);
  detachVideo();
  scheduleFlvReattach(url);
};

const notePaintProgress = (video: HTMLVideoElement): void => {
  if (!isPainting(video)) return;
  const current = video.currentTime;
  if (lastPaintAtMs === 0 || Math.abs(current - lastSeenCurrentTime) >= 0.05) {
    lastPaintAtMs = Date.now();
    lastSeenCurrentTime = current;
    flvFatalStreak = 0;
  }
};

const watchPlaybackStall = (video: HTMLVideoElement): void => {
  if (attachedUrl === null || flvPlayer === null || flvRecoverTimer !== null) return;
  const now = Date.now();
  notePaintProgress(video);
  chaseLiveEdge(video);
  if (isPainting(video)) {
    if (lastPaintAtMs > 0 && now - lastPaintAtMs > STALL_MS) {
      recoverStuckFlv(video, attachedUrl, "画面停住");
    }
    return;
  }
  if (attachedAtMs > 0 && now - attachedAtMs > NO_FRAME_MS) {
    recoverStuckFlv(video, attachedUrl, "长时间未出画");
  }
};

const reportPlaybackHealth = (video: HTMLVideoElement): void => {
  const now = Date.now();
  if (now - lastPlaybackHealthAt < 2_000) return;
  lastPlaybackHealthAt = now;
  notePaintProgress(video);
  if (isPainting(video)) {
    show(video.videoWidth > 0 ? `图传正常播放中（${video.videoWidth}×${video.videoHeight}）` : "图传正常播放中");
    return;
  }
  if (attachedUrl !== null && flvPlayer !== null) {
    show("图传已启动，正在等待画面…若长时间无画面请点「停止图传」后重试");
  }
};

const attachVideo = (url: string): void => {
  const video = el("video") as HTMLVideoElement;
  if (attachedUrl === url && flvPlayer !== null) {
    if (isPainting(video)) {
      notePaintProgress(video);
      reportPlaybackHealth(video);
      return;
    }
    if (video.paused) playVideo(video);
    // 已附着但不出画：不得直接 return，交给卡死看门狗做软恢复/重挂。
    watchPlaybackStall(video);
    reportPlaybackHealth(video);
    return;
  }
  clearFlvRecoverTimer();
  detachVideo();
  attachedUrl = url;
  attachedAtMs = Date.now();
  lastPaintAtMs = 0;
  lastSeenCurrentTime = 0;
  const play = (): void => {
    playVideo(video);
    reportPlaybackHealth(video);
  };
  try {
    if (!url.includes(".flv") || !flvjs.isSupported()) {
      detachVideo();
      show("当前电脑无法播放图传画面，请重启 Sky Command 后再试");
      return;
    }
    flvPlayer = flvjs.createPlayer(
      { type: "flv", isLive: true, hasAudio: false, hasVideo: true, url },
      // 小 stash 缓毛刺/网络抖动；过大则延迟明显。背压策略已在 HTTP-FLV 侧按关键frame 续写。
      { enableStashBuffer: false, stashInitialSize: 128, lazyLoad: false, autoCleanupSourceBuffer: true },
    );
    bindVideoPlayEvents(video);
    flvPlayer.on(flvjs.Events.MEDIA_INFO, () => { scheduleVideoPlay(video); });
    flvPlayer.on(flvjs.Events.ERROR, () => {
      flvFatalStreak += 1;
      const retryUrl = attachedUrl;
      if (retryUrl === null) return;
      if (flvFatalStreak <= 3 && softReloadFlv(video)) {
        show("图传不稳定，正在自动恢复…");
        return;
      }
      show("图传中断，正在重新连接…");
      detachVideo();
      scheduleFlvReattach(retryUrl);
    });
    flvPlayer.attachMediaElement(video);
    flvPlayer.load();
    play();
  } catch {
    detachVideo();
    show("图传播放器初始化失败，正在自动重试…");
  }
};

const accepted = (value: unknown): boolean => value !== null && typeof value === "object" && (value as { ok?: unknown }).ok === true;

const confirmationFromResult = (value: unknown, fallbackDeviceId: string | null, fallbackAction: string): FlightConfirmationIntent | null => {
  const body = unwrapAll(value);
  const confirmation = read(body, "confirmation");
  const confirmationId = text(read(confirmation, "confirmationId"));
  const deviceId = text(read(confirmation, "deviceId")) ?? fallbackDeviceId;
  const action = text(read(confirmation, "action")) ?? text(read(body, "action")) ?? fallbackAction;
  if (confirmationId === null || deviceId === null || action === null) return null;
  const expiresAt = read(confirmation, "expiresAtMs");
  const expiresAtMs = typeof expiresAt === "number" && Number.isFinite(expiresAt) ? expiresAt : Date.now() + 15_000;
  return Object.freeze({ deviceId, action, confirmationId, expiresAtMs });
};

const playbackUrl = (value: unknown): string | null => {
  const body = unwrap(value);
  if (body !== null && typeof body === "object" && read(body, "ok") === false) return null;
  const url = read(body, "url");
  if (typeof url === "string" && url.trim().length > 0) return url;
  const nested = unwrap(body);
  const nestedUrl = read(nested, "url");
  return typeof nestedUrl === "string" && nestedUrl.trim().length > 0 ? nestedUrl : null;
};

async function ensurePlayback(view: ReturnType<typeof OperatorConsole.project>, signal?: AbortSignal): Promise<void> {
  if (!view.playbackReady || view.streamDeviceId === null) {
    lastPlaybackIdentity = "off";
    if (attachedUrl !== null) detachVideo();
    return;
  }
  const identity = `on:${view.streamDeviceId}`;
  if (identity === lastPlaybackIdentity && attachedUrl !== null && flvPlayer !== null) return;
  const playbackResult = await safeRenderInvoke("video-playback", { deviceId: view.streamDeviceId }, signal);
  if (playbackResult === null) return;
  const url = playbackUrl(playbackResult);
  if (url === null) return;
  attachVideo(url);
  if (flvPlayer === null || attachedUrl !== url) return;
  if (selectedPlaybackDeviceId !== view.streamDeviceId) {
    const selected = unwrap(await safeRenderInvoke("stream-select", { deviceId: view.streamDeviceId }, signal));
    if (!accepted(selected)) return;
    selectedPlaybackDeviceId = view.streamDeviceId;
  }
  lastPlaybackIdentity = identity;
  watchPlaybackStall(el("video") as HTMLVideoElement);
}

const connectionLabel = (connection: unknown, key: string, ok: string, disconnected: string, unknownLabel: string): string => {
  const value = read(connection, key);
  if (value === "ready" || value === "connected" || value === "online") return ok;
  if (value === "disconnected") return disconnected;
  return unknownLabel;
};

const connected = (connection: unknown, key: string): boolean => {
  const value = read(connection, key);
  return value === "ready" || value === "connected" || value === "online";
};

const msdkFact = (connection: unknown): { readonly label: string; readonly ok: boolean } => {
  switch (read(connection, "msdk")) {
    case "ready": return { label: "MSDK 已就绪", ok: true };
    case "starting": return { label: "MSDK 正在初始化", ok: false };
    case "failed": return { label: "MSDK 初始化失败", ok: false };
    case "stopped": return { label: "MSDK 已停止", ok: false };
    default: return { label: "MSDK 状态未知", ok: false };
  }
};

const pairingFact = (connection: unknown): { readonly label: string; readonly ok: boolean } => {
  switch (read(connection, "pairingState")) {
    case "PAIRED": return { label: "已对频", ok: true };
    case "PAIRING": return { label: "对频中", ok: false };
    case "STOPPING": return { label: "正在结束对频", ok: false };
    case "FAILED": return { label: "对频失败", ok: false };
    case "IDLE": return { label: "未对频", ok: false };
    case "UNKNOWN": return { label: "对频状态未知", ok: false };
    default: return { label: "对频状态未知", ok: false };
  }
};

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

const statusRow = (name: string, label: string, ok: boolean): string =>
  `<div class="connection-status-row"><span class="connection-status-name">${escapeHtml(name)}</span><span class="connection-status-value${ok ? " ok" : ""}">${escapeHtml(label)}</span></div>`;

const finiteNumber = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const nonNegativeFinite = (value: unknown): value is number => {
  const number = finiteNumber(value);
  return number !== null && number >= 0;
};
const phoneLinkProbeReport = (value: unknown): PhoneLinkProbeReport => {
  const status = read(value, "status");
  const sampleCount = finiteNumber(read(value, "sampleCount"));
  if (status === "measured" && sampleCount === 10) {
    const currentRttMs = read(value, "currentRttMs");
    const medianRttMs = read(value, "medianRttMs");
    const maximumRttMs = read(value, "maximumRttMs");
    const jitterMs = read(value, "jitterMs");
    if (nonNegativeFinite(currentRttMs) && nonNegativeFinite(medianRttMs) && nonNegativeFinite(maximumRttMs) && nonNegativeFinite(jitterMs) && maximumRttMs >= currentRttMs && maximumRttMs >= medianRttMs) {
      return Object.freeze({ status, sampleCount, currentRttMs, medianRttMs, maximumRttMs, jitterMs });
    }
  }
  if ((status === "unavailable" || status === "timed-out" || status === "disconnected") && sampleCount !== null && Number.isInteger(sampleCount) && sampleCount >= 0 && sampleCount <= 10) {
    return Object.freeze({ status, sampleCount });
  }
  return Object.freeze({ status: "unavailable", sampleCount: 0 });
};
const connectionEpochOf = (device: unknown): number => {
  const value = read(device, "connectionEpoch");
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : -1;
};
const probeForConnectionEpoch = (deviceId: string | null, connectionEpoch: number): PhoneLinkProbeReport | undefined => {
  if (deviceId === null || connectionEpoch < 0) return undefined;
  const cached = phoneLinkProbes.get(deviceId);
  return cached?.connectionEpoch === connectionEpoch ? cached.report : undefined;
};
const milliseconds = (value: number): string => `${Math.round(value * 10) / 10}`;
const phoneLinkProbeLabel = (report: PhoneLinkProbeReport | undefined, measuring: boolean): string => {
  if (measuring) return "测量中：正在发送 10 次 WebSocket PING";
  if (report === undefined) return "尚未测量";
  if (report.status === "measured") return `当前 ${milliseconds(report.currentRttMs)} ms · 中位 ${milliseconds(report.medianRttMs)} ms · 最大 ${milliseconds(report.maximumRttMs)} ms · 抖动 ${milliseconds(report.jitterMs)} ms`;
  if (report.status === "timed-out") return `不可测：第 ${report.sampleCount + 1} 次 WebSocket PING 在 1 秒内未收到 PONG`;
  if (report.status === "disconnected") return "不可测：手机连接已断开";
  return "不可测：未获得有效 WebSocket PING/PONG 回应";
};
const optionalText = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 ? value : null;
const durationLabel = (value: unknown): string | null => {
  const seconds = finiteNumber(value);
  if (seconds === null || !Number.isInteger(seconds) || seconds <= 0) return null;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
};
const lowBatteryRthLabel = (value: unknown): string | null => {
  if (value === "IDLE") return "未触发";
  if (value === "COUNTING_DOWN") return "正在倒计时";
  if (value === "EXECUTED") return "已执行";
  if (value === "CANCELLED") return "已取消";
  if (value === "UNKNOWN") return "未知（MSDK 返回 UNKNOWN）";
  return null;
};
const msdkEnumLabel = (value: unknown): string | null => {
  const raw = optionalText(value);
  if (raw === null) return null;
  return raw === "UNKNOWN" ? "未知（MSDK 返回 UNKNOWN）" : raw;
};
const msdkBooleanLabel = (value: unknown): string | null => {
  if (value === true) return "是（MSDK 返回 true）";
  if (value === false) return "否（MSDK 返回 false）";
  return null;
};
const flightFactsUnconfirmed = (connection: unknown): boolean => read(connection, "flightController") === "unknown";
const telemetryTimeKnown = (connection: unknown): boolean => finiteNumber(read(connection, "telemetryReceivedAtMs")) !== null;
const telemetryTimeLabel = (connection: unknown): string => {
  const receivedAtMs = finiteNumber(read(connection, "telemetryReceivedAtMs"));
  if (receivedAtMs === null) return flightFactsUnconfirmed(connection) ? "尚未收到有效状态，飞控状态当前未确认" : "尚未收到有效状态";
  const ageSeconds = Math.max(0, Math.floor((Date.now() - receivedAtMs) / 1_000));
  const clock = new Date(receivedAtMs).toLocaleTimeString("zh-CN", { hour12: false });
  if (flightFactsUnconfirmed(connection)) return `上次更新于 ${clock}（${ageSeconds <= 2 ? "刚刚" : `${ageSeconds} 秒前`}），飞控状态当前未确认`;
  return ageSeconds <= 2 ? `刚刚（${clock}）` : `${ageSeconds} 秒前（${clock}）`;
};

const flightControllerStatusRows = (connection: unknown): string => {
  const pose = read(connection, "pose");
  const rthStateValue = read(connection, "lowBatteryRthState");
  const rthState = lowBatteryRthLabel(rthStateValue);
  const remaining = rthStateValue === "UNKNOWN" || rthState === null ? null : durationLabel(read(connection, "remainingFlightTimeSeconds"));
  const flightMode = msdkEnumLabel(read(connection, "flightMode"));
  const altitude = finiteNumber(read(pose, "altitudeMeters"));
  const latitude = finiteNumber(read(pose, "latitude"));
  const longitude = finiteNumber(read(pose, "longitude"));
  const flightState = read(connection, "flightState") === "grounded" ? "地面" : read(connection, "flightState") === "flying" ? "飞行中" : "尚未确认";
  const motors = read(connection, "motorsOn") === true ? "已启动" : read(connection, "motorsOn") === false ? "已关闭" : "尚未确认";
  const gpsSignal = msdkEnumLabel(read(connection, "gpsSignalLevel"));
  const satelliteCount = finiteNumber(read(connection, "gpsSatelliteCount"));
  const visionSensor = msdkBooleanLabel(read(connection, "visionSensorUsed"));
  const landingConfirmation = msdkBooleanLabel(read(connection, "landingConfirmationNeeded"));
  const takeoffFailure = msdkEnumLabel(read(connection, "takeoffFailureError"));
  const motorStartFailure = msdkEnumLabel(read(connection, "motorStartFailureError"));
  return [
    statusRow("飞控连接 [FlightControllerKey.KeyConnection]", connectionLabel(connection, "flightController", "飞控已连接", "飞控未连接", "飞控状态未知"), connected(connection, "flightController")),
    statusRow("飞行状态 [FlightControllerKey.KeyIsFlying]", flightState, false),
    statusRow("电机 [FlightControllerKey.KeyAreMotorsOn]", motors, false),
    statusRow("低电量返航状态 [FlightControllerKey.KeyLowBatteryRTHInfo]", rthState ?? "尚未取得", rthState !== null),
    statusRow("低电量返航预估 [FlightControllerKey.KeyLowBatteryRTHInfo]", rthStateValue === "UNKNOWN" ? "不适用（无有效返航预估）" : remaining ?? "尚未取得", remaining !== null),
    statusRow("飞行模式 [FlightControllerKey.KeyFCFlightMode]", flightMode ?? "尚未取得", flightMode !== null),
    statusRow("GPS 信号 [FlightControllerKey.KeyGPSSignalLevel]", gpsSignal ?? "尚未取得", gpsSignal !== null),
    statusRow("GPS 卫星数 [FlightControllerKey.KeyGPSSatelliteCount]", satelliteCount === null ? "尚未取得" : String(satelliteCount), satelliteCount !== null),
    statusRow("视觉传感器 [FlightControllerKey.KeyIsVisionSensorUsed]", visionSensor ?? "尚未取得", visionSensor !== null),
    statusRow("降落确认 [FlightControllerKey.KeyIsLandingConfirmationNeeded]", landingConfirmation ?? "尚未取得", landingConfirmation !== null),
    statusRow("起飞失败原因 [FlightControllerKey.KeyTakeoffFailureError]", takeoffFailure ?? "尚未取得", takeoffFailure !== null),
    statusRow("电机启动失败原因 [FlightControllerKey.KeyMotorStartFailureError]", motorStartFailure ?? "尚未取得", motorStartFailure !== null),
    statusRow("相对起飞点高度 [FlightControllerKey.KeyAltitude]", altitude === null ? "尚未取得" : `${altitude.toFixed(1)} 米`, altitude !== null),
    statusRow("位置 [FlightControllerKey.KeyAircraftLocation]", latitude === null || longitude === null ? "尚未取得" : `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`, latitude !== null && longitude !== null),
  ].join("");
};

const flightAssistantStatusRows = (connection: unknown): string => {
  const visionSystemWarning = msdkEnumLabel(read(connection, "visionSystemWarning"));
  const visionPositioning = msdkBooleanLabel(read(connection, "visionPositioningEnabled"));
  const landingProtection = msdkEnumLabel(read(connection, "landingProtectionState"));
  return [
    statusRow("视觉系统警告 [FlightAssistantKey.KeyVisionSystemWarning]", visionSystemWarning ?? "尚未取得", visionSystemWarning !== null),
    statusRow("视觉定位 [FlightAssistantKey.KeyVisionPositioningEnabled]", visionPositioning ?? "尚未取得", visionPositioning !== null),
    statusRow("降落保护状态 [FlightAssistantKey.KeyLandingProtectionState]", landingProtection ?? "尚未取得", landingProtection !== null),
  ].join("");
};

const videoTransportStatusRows = (connection: unknown): string => {
  const live = read(connection, "live");
  const resolution = optionalText(read(live, "resolution"));
  const fps = finiteNumber(read(live, "fps"));
  const bitrate = finiteNumber(read(live, "videoBitrateKbps"));
  const rtt = finiteNumber(read(live, "rttMillis"));
  const packetLoss = finiteNumber(read(live, "packetLoss"));
  const packetCacheLength = finiteNumber(read(live, "packetCacheLength"));
  const streaming = read(live, "streaming") === true ? "MSDK 报告正在推流" : read(live, "streaming") === false ? "MSDK 报告未推流" : "尚未取得";
  return [
    statusRow("AirLink 连接 [AirLinkKey.KeyConnection]", connectionLabel(connection, "airLink", "AirLink 已连接", "AirLink 未连接", "AirLink 状态未知"), connected(connection, "airLink")),
    statusRow("主相机连接 [CameraKey.KeyConnection, LEFT_OR_MAIN]", connectionLabel(connection, "camera", "主相机已连接", "主相机未连接", "主相机状态未知"), connected(connection, "camera")),
    statusRow("MSDK 图传观测 [手机 MSDK 图传运行观测]", streaming, read(live, "streaming") === true),
    statusRow("图传分辨率 [手机 MSDK 图传运行观测]", resolution ?? "尚未取得", resolution !== null),
    statusRow("图传帧率 [手机 MSDK 图传运行观测]", fps === null ? "尚未取得" : `${fps} fps`, fps !== null),
    statusRow("图传码率 [手机 MSDK 图传运行观测]", bitrate === null ? "尚未取得" : `${bitrate} Kbps`, bitrate !== null),
    statusRow("图传丢包 [LiveStreamStatus.packetLoss]", packetLoss === null ? "尚未取得" : String(packetLoss), packetLoss !== null),
    statusRow("图传缓存长度 [LiveStreamStatus.packetCacheLen]", packetCacheLength === null ? "尚未取得" : String(packetCacheLength), packetCacheLength !== null),
    statusRow("MSDK 运行期错误 [LiveStreamStatusListener.onError]", liveRuntimeErrorStatus(connection), false),
    statusRow("图传往返时间 [手机 MSDK 图传运行观测]", rtt === null ? "尚未取得" : `${rtt} ms`, rtt !== null),
  ].join("") + cameraFrameStatusRows(connection);
};

const batteryStatusRows = (connection: unknown): string => {
  const battery = finiteNumber(read(connection, "batteryPercent"));
  const batteryConnection = connectionLabel(connection, "battery", "已连接", "已断开", "状态未知");
  return [
    statusRow("主电池连接 [BatteryKey.KeyConnection, LEFT_OR_MAIN]", batteryConnection, connected(connection, "battery")),
    statusRow("电量 [BatteryKey.KeyChargeRemainingInPercent, LEFT_OR_MAIN]", battery === null ? "尚未取得" : `${battery}%`, battery !== null),
  ].join("");
};

const deviceInformationRows = (connection: unknown): string => {
  const aircraftModel = optionalText(read(connection, "aircraftModel"));
  const remoteControllerModel = optionalText(read(connection, "remoteControllerModel"));
  return [
    statusRow("机型 [ProductKey.KeyProductType]", aircraftModel ?? "尚未取得", aircraftModel !== null),
    statusRow("遥控器型号 [RemoteControllerKey.KeyRemoteControllerType]", remoteControllerModel ?? "尚未取得", remoteControllerModel !== null),
    statusRow("状态更新时间 [桌面接收时间]", telemetryTimeLabel(connection), telemetryTimeKnown(connection) && !flightFactsUnconfirmed(connection)),
  ].join("");
};

const missionRuntimeLabel = (mission: unknown): string => {
  switch (read(mission, "phase")) {
    case "staging": return "准备中";
    case "staged": return "已暂存到手机";
    case "uploading": return "上传中";
    case "uploaded": return "已上传至飞机";
    case "starting": return "启动中，等待飞机确认";
    case "running": return "执行中";
    case "pausing": return "暂停中";
    case "paused": return "已暂停";
    case "resuming": return "恢复中";
    case "stopping": return "停止中";
    case "completed": return "已完成";
    case "failed": return "失败";
    case "disconnected": return "链路中断";
    case "idle": return "未开始";
    default: return "状态未知";
  }
};

const streamRuntimeLabel = (device: unknown): string => {
  const stream = read(device, "stream");
  const live = read(read(device, "connection"), "live");
  switch (read(stream, "phase")) {
    case "starting": return "启动中";
    case "stopping": return "停止中";
    case "failed": return "失败";
    case "disconnected": return "链路中断";
    case "streaming":
      return read(live, "streaming") === true ? "推流中" : read(live, "streaming") === false ? "已接收启动命令，等待推流" : "已接收启动命令，等待状态确认";
    case "idle":
      return read(live, "streaming") === true ? "MSDK 报告推流中（非当前控制会话）" : "已停止";
    default: return "状态未知";
  }
};

const playbackRuntimeLabel = (device: unknown, streamDeviceId: string | null): string => {
  if (read(device, "deviceId") !== streamDeviceId) return "未选为当前播放器";
  const video = read(device, "video");
  switch (read(video, "phase")) {
    case "awaiting-ingest": return "等待流进入";
    case "awaiting-playback": return "等待播放器";
    case "failed": return "播放失败";
    case "ready": {
      if (read(video, "selected") !== true) return "等待播放器";
      const player = document.getElementById("video");
      if (!(player instanceof HTMLVideoElement)) return "播放器未就绪";
      if (player.error !== null) return "播放器报告错误";
      if (isPainting(player)) return "正在解码并出画";
      if (player.buffered.length > 0 || player.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        return "已收到媒体数据，等待解码或出画";
      }
      return "等待媒体数据";
    }
    case "unavailable": return "未开始";
    default: return "状态未知";
  }
};

const liveStreamingStatus = (device: Record<string, unknown> | undefined): string => {
  if (device === undefined) return "未选择手机";
  const streaming = read(read(connectionOf(device), "live"), "streaming");
  return streaming === true ? "MSDK 报告正在推流" : streaming === false ? "MSDK 报告未推流" : "尚未取得";
};
const liveMetricStatus = (device: Record<string, unknown> | undefined, field: string, unit = ""): string => {
  if (device === undefined) return "未选择手机";
  const value = read(read(connectionOf(device), "live"), field);
  const number = finiteNumber(value);
  if (number !== null) return `${number}${unit}`;
  return optionalText(value) ?? "尚未取得";
};
const liveRuntimeErrorStatus = (connection: unknown): string => {
  const runtimeError = read(read(connection, "live"), "runtimeError");
  const code = optionalText(read(runtimeError, "code"));
  const description = optionalText(read(runtimeError, "description"));
  return code !== null && description !== null
    ? `错误码：${code}；错误说明：${description}`
    : "未收到运行期错误";
};
const desktopMediaServiceStatus = (view: ReturnType<typeof OperatorConsole.project>, service: "rtmpIngest" | "httpFlv"): string => {
  switch (read(read(view, "media"), service)) {
    case "listening": return "正在监听";
    case "idle": return "未启动";
    case "failed": return "服务失败";
    default: return "尚未取得";
  }
};
const rtmpArrivalStatus = (device: Record<string, unknown> | undefined): string => {
  if (device === undefined) return "未选择手机";
  switch (read(read(device, "video"), "phase")) {
    case "ready": return "已观测到当前设备 RTMP 流";
    case "awaiting-ingest": return "尚未观测到当前设备 RTMP 流";
    case "awaiting-playback": return "已接收流，等待播放器";
    case "failed": return "流接收或健康检查失败";
    default: return "当前设备尚无媒体流";
  }
};
const desktopPlayerSourceStatus = (device: Record<string, unknown> | undefined): string => {
  if (device === undefined) return "未选择手机";
  switch (read(read(device, "video"), "playerPhase")) {
    case "playing": return "已选择当前 HTTP-FLV 数据源";
    case "failed": return "播放器数据源失败";
    case "idle": return "当前设备未被播放器选择";
    default: return "尚未取得";
  }
};
const cameraFrameStatusRows = (connection: unknown): string => [
  statusRow("相机编码帧状态 [ICameraStreamManager.ReceiveStreamListener]", cameraFrameStatus(connection), read(cameraFrameFact(connection), "state") === "receiving"),
  statusRow("帧观察代次 [生产 RTMP 会话代次]", cameraFrameGenerationStatus(connection), false),
  statusRow("有效编码帧数量 [ReceiveStreamListener]", cameraFrameCountStatus(connection), read(cameraFrameFact(connection), "receivedFrameCount") !== 0),
  statusRow("最新帧年龄 [手机本地单调时钟]", cameraFrameAgeStatus(connection), false),
  statusRow("最新帧格式 [DJI StreamInfo]", cameraFrameFormatStatus(connection), false),
].join("");
const desktopMediaStatusRows = (view: ReturnType<typeof OperatorConsole.project>, device: Record<string, unknown>, streamDeviceId: string | null): string => [
  statusRow("RTMP 接收服务 [桌面 media-pipeline]", desktopMediaServiceStatus(view, "rtmpIngest"), desktopMediaServiceStatus(view, "rtmpIngest") === "正在监听"),
  statusRow("HTTP-FLV 服务 [桌面 media-pipeline]", desktopMediaServiceStatus(view, "httpFlv"), desktopMediaServiceStatus(view, "httpFlv") === "正在监听"),
  statusRow("当前设备 RTMP 接收 [桌面 rtmp-ingest]", rtmpArrivalStatus(device), read(read(device, "video"), "phase") === "ready"),
  statusRow("播放器数据源 [桌面 video-player]", desktopPlayerSourceStatus(device), read(read(device, "video"), "playerPhase") === "playing"),
  statusRow("实际渲染 [HTMLVideoElement]", playbackRuntimeLabel(device, streamDeviceId), false),
].join("");

const runtimeStatusRows = (view: ReturnType<typeof OperatorConsole.project>, device: Record<string, unknown>, streamDeviceId: string | null): string => [
  statusRow("任务 [手机任务运行状态]", missionRuntimeLabel(read(device, "mission")), false),
  statusRow("当前航点 [WaylineExecutingInfo.getCurrentWaypointIndex]", missionWaypointIndexStatus(device), false),
  statusRow("航线 ID [WaylineExecutingInfo.getWaylineID]", missionWaylineIdStatus(device), false),
  statusRow("飞机正在执行的文件 [WaylineExecutingInfo.getMissionFileName]", missionExecutingFileStatus(device), false),
  statusRow("航点动作 [WaypointActionListener]", missionWaypointActionStatus(device), false),
  statusRow("航线中断原因 [WaylineExecutingInfoListener]", missionWaylineInterruptStatus(device), false),
  statusRow("手机推流 [手机图传运行状态]", streamRuntimeLabel(device), false),
].join("") + desktopMediaStatusRows(view, device, streamDeviceId);

async function projectView(signal?: AbortSignal): Promise<ReturnType<typeof OperatorConsole.project>> {
  const snapshotResult = unwrap(await awaitCurrentRender(bridge().invoke("state-snapshot"), signal));
  lastSnapshot = unwrap(snapshotResult) ?? lastSnapshot;
  try {
    const hintResult = unwrap(await awaitCurrentRender(bridge().invoke("network-hint"), signal));
    const listed = read(hintResult, "hints");
    const liveHints = Array.isArray(listed) ? listed.filter((item): item is string => typeof item === "string" && item.startsWith("ws://")) : [];
    if (liveHints.length > 0) lastRelayHint = liveHints.join(" 或 ");
  } catch {
    /* keep the last reachable hint */
  }
  const view = projectCached();
  state.missionDeviceId = view.missionDeviceId;
  state.streamDeviceId = view.streamDeviceId;
  return view;
}

const projectCached = (): ReturnType<typeof OperatorConsole.project> => OperatorConsole.project({
  snapshot: lastSnapshot,
  selection: { missionDeviceId: state.missionDeviceId, streamDeviceId: state.streamDeviceId },
  workspace: state.workspace,
  relayHint: lastRelayHint.length > 0 ? lastRelayHint : bridge().relayHint,
});

const blocked = (action: string, reason: string, deviceId: string | null = null, connectionEpoch: number | null = null): void => {
  const feedback = captureFeedback(action, deviceId, connectionEpoch, { ok: false, code: "DESKTOP_BLOCKED", reason });
  show(feedback.message);
  void bridge().invoke("diagnostics-record", { action, reason });
};

async function run(
  action: string,
  invokeName: string,
  input: unknown,
  knownView?: ReturnType<typeof OperatorConsole.project>,
  feedbackAction = action,
): Promise<void> {
  const view = knownView ?? await projectView();
  const decision = OperatorConsole.evaluate(action, view);
  const deviceId = text(read(input, "deviceId"));
  const connectionEpoch = feedbackDeviceEpoch(view, deviceId);
  if (!decision.ok) { blocked(action, decision.reason ?? "无法执行", deviceId, connectionEpoch); return; }
  let result: unknown;
  try {
    result = await bridge().invoke(invokeName, input);
  } catch {
    result = { ok: false, code: "DEPENDENCY_FAILURE" };
  }
  if (invokeName === "flight-request") {
    const requestedAction = text(read(input, "action")) ?? "takeoff";
    const confirmation = confirmationFromResult(result, deviceId, requestedAction);
    if (confirmation !== null) pendingFlightConfirmation = confirmation;
  } else if ((action === "flight-confirm" || action === "flight-cancel") && accepted(unwrapAll(result))) {
    pendingFlightConfirmation = null;
  }
  const feedback = captureFeedback(feedbackAction, deviceId, connectionEpoch, result);
  show(feedback.message);
  await render();
}

const createMissionStartIntent = (view: ReturnType<typeof OperatorConsole.project>): MissionStartIntent | null => {
  const deviceId = view.missionDeviceId;
  const missionId = text(read(view.mission, "missionId"));
  const route = view.missionRoute;
  return deviceId !== null && missionId !== null && route !== null
    ? Object.freeze({ deviceId, missionId, routeId: route.routeId, routeName: route.displayName })
    : null;
};

const requestMissionStartConfirmation = async (view: ReturnType<typeof OperatorConsole.project>): Promise<void> => {
  const decision = OperatorConsole.evaluate("mission-start", view);
  if (!decision.ok) { blocked("mission-start", decision.reason ?? "无法执行航线", view.missionDeviceId, feedbackDeviceEpoch(view, view.missionDeviceId)); return; }
  const intent = createMissionStartIntent(view);
  if (intent === null) {
    blocked("mission-start", "已上传任务的身份不完整，请重新准备并上传航线", view.missionDeviceId, feedbackDeviceEpoch(view, view.missionDeviceId));
    return;
  }
  pendingMissionStart = intent;
  captureFeedback("mission-start", intent.deviceId, feedbackDeviceEpoch(view, intent.deviceId), {
    ok: true,
    value: { ok: true, code: "CONFIRMATION_REQUIRED", action: "start", confirmation: { deviceId: intent.deviceId, action: "start" } },
  });
  show("等待人工确认：执行航线尚未调用 DJI MSDK");
  await render();
};

const confirmMissionStart = async (): Promise<void> => {
  const intent = pendingMissionStart;
  pendingMissionStart = null;
  if (intent === null) { await render(); return; }
  let view: ReturnType<typeof OperatorConsole.project>;
  try {
    view = await projectView();
  } catch {
    pendingMissionStart = intent;
    show("界面读取失败，确认未发送；请确认手机仍连接后重试");
    renderMissionStartConfirmationFallback();
    return;
  }
  if (
    view.missionDeviceId !== intent.deviceId ||
    text(read(view.mission, "missionId")) !== intent.missionId ||
    view.missionRoute?.routeId !== intent.routeId
  ) {
    blocked("mission-start", "任务、目标飞机或航线已变化，请重新确认", view.missionDeviceId, feedbackDeviceEpoch(view, view.missionDeviceId));
    await render();
    return;
  }
  await run("mission-start", "mission-start", { deviceId: intent.deviceId }, view);
};

function renderDevices(view: ReturnType<typeof OperatorConsole.project>): void {
  const devices = view.devices as readonly Record<string, unknown>[];
  const count = el("connection-count");
  count.textContent = devices.length > 0 ? `${devices.length} 台手机已连接` : "等待手机连接";
  count.classList.toggle("online", devices.length > 0);
  el("device-list").replaceChildren(...devices.map((device) => {
    const node = document.createElement("div");
    node.className = "device";
    if (device.deviceId === view.missionDeviceId) node.classList.add("inspected");
    const connection = device.connection ?? {};
    const msdk = msdkFact(connection);
    node.innerHTML = `<strong>${escapeHtml(String(device.deviceId))}</strong><div class="muted">${msdk.label} · ${connectionLabel(connection, "remoteController", "遥控器已连接", "遥控器未连接", "遥控器状态未知")} · ${connectionLabel(connection, "flightController", "飞控已连接", "飞控未连接", "飞控状态未知")}</div>`;
    node.addEventListener("click", () => { state.missionDeviceId = String(device.deviceId); void render(); });
    return node;
  }));
  const inspected = devices.find((item) => item.deviceId === view.missionDeviceId);
  const refresh = el("device-refresh") as HTMLButtonElement;
  refresh.disabled = inspected === undefined;
  refresh.title = inspected === undefined ? "请先选择已连接的手机" : "读取当前手机状态";
  const measure = el("device-link-measure") as HTMLButtonElement;
  const inspectedDeviceId = inspected === undefined ? null : String(inspected.deviceId);
  const inspectedEpoch = connectionEpochOf(inspected);
  const phoneLinkProbe = probeForConnectionEpoch(inspectedDeviceId, inspectedEpoch);
  const measuring = inspectedDeviceId !== null && phoneLinkProbeInFlightDeviceId === inspectedDeviceId;
  measure.disabled = inspectedDeviceId === null || measuring;
  measure.title = inspectedDeviceId === null ? "请先选择已连接的手机" : measuring ? "正在测量手机连接" : "仅测量电脑与手机的 WebSocket 往返时间";
  const connection = inspected === undefined ? {} : inspected.connection as Record<string, unknown> ?? {};
  const msdk = msdkFact(connection);
  const pairing = pairingFact(connection);
  const html = inspected === undefined
    ? "从左侧选择已连接的手机。"
    : `<p class="muted">编号 ${escapeHtml(String(inspected.deviceId))}</p>
      <h3 class="device-status-heading">连接状态</h3>
      <div class="connection-status-list" aria-label="连接状态">
        ${statusRow("电脑到手机中继 [桌面 Relay Session]", "中继在线", true)}
        ${statusRow("手机连接质量 [WebSocket PING/PONG]", phoneLinkProbeLabel(phoneLinkProbe, measuring), !measuring && phoneLinkProbe?.status === "measured")}
        ${statusRow("MSDK 生命周期 [SDKManager]", msdk.label, msdk.ok)}
        ${statusRow("遥控器连接 [RemoteControllerKey.KeyConnection]", connectionLabel(connection, "remoteController", "遥控器已连接", "遥控器未连接", "遥控器状态未知"), connected(connection, "remoteController"))}
        ${statusRow("对频状态 [RemoteControllerKey.KeyPairingStatus]", pairing.label, pairing.ok)}
      </div>
      <h3 class="device-status-heading">飞控状态 [FlightControllerKey]</h3>
      <div class="connection-status-list" aria-label="飞控状态">${flightControllerStatusRows(connection)}</div>
      <h3 class="device-status-heading">飞行辅助状态 [FlightAssistantKey]</h3>
      <div class="connection-status-list" aria-label="飞行辅助状态">${flightAssistantStatusRows(connection)}</div>
      <h3 class="device-status-heading">图传状态 [AirLinkKey / CameraKey]</h3>
      <div class="connection-status-list" aria-label="图传状态">${videoTransportStatusRows(connection)}</div>
      <h3 class="device-status-heading">电池状态 [BatteryKey]</h3>
      <div class="connection-status-list" aria-label="电池状态">${batteryStatusRows(connection)}</div>
      <h3 class="device-status-heading">设备信息</h3>
      <div class="connection-status-list" aria-label="设备信息">${deviceInformationRows(connection)}</div>
      <h3 class="device-status-heading">运行状态</h3>
      <div class="connection-status-list" aria-label="运行状态">${runtimeStatusRows(view, inspected, view.streamDeviceId)}</div>
      <p class="muted">对频仅用于新增飞机或更换遥控器。这里只显示手机回报的结果。</p>`;
  if (html !== lastDeviceDetailHtml) {
    el("device-detail").innerHTML = html;
    lastDeviceDetailHtml = html;
  }
  el("device-guide").textContent = `电脑和手机连同一 Wi-Fi。在手机上填写 ${view.relayHint}，点保存并启动。已对频的飞机会在开机后自动连接；只有新增飞机或更换遥控器时，才在手机上开始对频。电脑关掉后，需要在手机上重新连接。`;
}

function renderRoutes(view: ReturnType<typeof OperatorConsole.project>): void {
  const selected = view.selectedRoute;
  const hasRoute = view.routes.length > 0;
  el("route-picker-wrap").hidden = !hasRoute;
  el("route-details").hidden = selected === null || selected === undefined;
  el("route-empty").hidden = hasRoute;
  const select = el("route-select") as HTMLSelectElement;
  select.replaceChildren(...view.routes.map((route) => Object.assign(document.createElement("option"), {
    value: route.routeId,
    textContent: route.displayName,
    selected: selected?.routeId === route.routeId,
  })));
  if (selected !== null && selected !== undefined) select.value = selected.routeId;
  select.onchange = async () => {
    const decision = OperatorConsole.evaluate("select-route", view);
    if (!decision.ok) { show(decision.reason ?? "无法选择航线"); return; }
    await bridge().invoke("route-select", { routeId: select.value });
    await render();
  };
  if (selected === null || selected === undefined) {
    el("route-file-name").textContent = "";
    el("route-meta").textContent = "";
    el("route-executable").textContent = "";
    el("route-executable").classList.remove("is-blocked");
    el("route-summary").textContent = hasRoute ? "请选择要预览的航线" : "尚未导入航迹文件";
    return;
  }
  el("route-file-name").textContent = selected.displayName;
  const executableLabel = selected.executable
    ? "可提交给飞机"
    : (selected.blockedReason ?? "当前航线不能提交给飞机");
  el("route-meta").textContent = selected.executable
    ? "桌面文件检查已通过，飞机仍可能在上传或执行时拒绝"
    : `${executableLabel} · 要飞这条航线需要 Wayline 导出的 KMZ`;
  el("route-executable").textContent = executableLabel;
  el("route-executable").classList.toggle("is-blocked", selected.executable !== true);
}

function renderFlight(view: ReturnType<typeof OperatorConsole.project>): void {
  // Cancel any renderer-local FLV retry after the phone has queued recovery stop.
  if (view.streamSourceUnavailable) detachVideo();
  const devices = view.devices as readonly Record<string, unknown>[];
  const fill = (id: string, selected: string | null, onChange: (value: string) => void): void => {
    const select = el(id) as HTMLSelectElement;
    select.replaceChildren(...[
      Object.assign(document.createElement("option"), { value: "", textContent: "未选择" }),
      ...devices.map((device) => Object.assign(document.createElement("option"), {
        value: String(device.deviceId),
        textContent: String(device.deviceId),
        selected: device.deviceId === selected,
      })),
    ]);
    select.onchange = () => { onChange(select.value || ""); void render(); };
  };
  fill("mission-select", view.missionDeviceId, (value) => { state.missionDeviceId = value.length > 0 ? value : null; });
  fill("direct-flight-select", view.missionDeviceId, (value) => { state.missionDeviceId = value.length > 0 ? value : null; });
  fill("stream-select", view.streamDeviceId, (value) => { state.streamDeviceId = value.length > 0 ? value : null; });
  renderFlightPanelStatus(view);
  renderFlightPanelVisibility();
  const missionButtonActions = Object.freeze({
    stage: "mission-stage",
    upload: "mission-upload",
    start: "mission-start",
    pause: "mission-pause",
    resume: "mission-resume",
    stop: "mission-stop",
  } as const);
  for (const [action, dataAction] of Object.entries(missionButtonActions) as Array<[keyof typeof missionButtonActions, string]>) {
    const button = document.querySelector(`button[data-action="${dataAction}"]`);
    if (!(button instanceof HTMLButtonElement)) continue;
    const availability = view.missionActions[action];
    button.disabled = !availability.enabled;
    button.title = availability.enabled ? button.textContent ?? "" : availability.reason ?? "当前阶段不能执行此操作";
    renderOperationFeedback(dataAction, view.missionDeviceId, feedbackDeviceEpoch(view, view.missionDeviceId));
  }
  const streamStopping = view.streamLabel === "正在停止图传";
  const streamHasDjiRuntimeError = view.streamLabel.startsWith("DJI MSDK 图传运行回调：");
  el("stream-label").textContent = view.streamLabel;
  el("stream-label").classList.toggle("ok", !streamStopping && !streamHasDjiRuntimeError && (view.playbackReady || view.streamCanStart));
  const startButton = document.querySelector('button[data-action="stream-start"]');
  if (startButton instanceof HTMLButtonElement) {
    startButton.disabled = !view.streamCanStart;
    startButton.textContent = streamStopping && view.streamCanStart ? "停止后重启图传" : "启动图传";
    startButton.title = view.streamCanStart
      ? streamStopping
        ? "手机确认停止后自动重新启动图传"
        : "图传可请求启动：手机中继、MSDK、AirLink 和主相机均已就绪；发送前会检查电脑接收端，实际推流和出画仍分别确认"
      : view.streamLabel;
  }
  const stopButton = document.querySelector('button[data-action="stream-stop"]');
  if (stopButton instanceof HTMLButtonElement) {
    const canStop = !view.streamSourceUnavailable && !streamStopping && (view.streamCanStop || attachedUrl !== null);
    stopButton.disabled = !canStop;
    stopButton.title = canStop ? "停止图传" : view.streamSourceUnavailable ? "图传源已断开，手机已自动停止图传" : streamStopping ? "正在等待手机确认停止" : "当前没有进行中的图传";
  }
  renderOperationFeedback("stream-start", view.streamDeviceId, feedbackDeviceEpoch(view, view.streamDeviceId));
  renderOperationFeedback("stream-stop", view.streamDeviceId, feedbackDeviceEpoch(view, view.streamDeviceId));
  armedCommand = expireArm(armedCommand, Date.now());
  if (armedCommand === null) clearArmTimer();
  for (const action of ["flight-takeoff", "flight-land", "flight-confirm-landing", "flight-return-home", "flight-stop-takeoff", "flight-stop-auto-landing"] as const) {
    const button = document.querySelector(`button[data-action="${action}"]`);
    if (!(button instanceof HTMLButtonElement)) continue;
    const decision = OperatorConsole.evaluate(action, view);
    button.disabled = !decision.ok;
    if (isArmableAction(action)) {
      button.textContent = buttonLabel(action, armedCommand);
      button.dataset.arm = armedCommand?.action === action ? "armed" : "idle";
    }
    button.title = decision.ok ? button.textContent ?? "" : decision.reason ?? "当前状态不允许此操作";
    renderOperationFeedback(action, view.missionDeviceId, feedbackDeviceEpoch(view, view.missionDeviceId));
  }
  const startMission = document.querySelector('button[data-action="mission-start"]');
  if (startMission instanceof HTMLButtonElement) {
    startMission.textContent = buttonLabel("mission-start", armedCommand);
    startMission.dataset.arm = armedCommand?.action === "mission-start" ? "armed" : "idle";
  }
  const landingDevice = devices.find((device) => device.deviceId === view.missionDeviceId);
  void landingDevice;
  pendingFlightConfirmation = adoptPendingConfirmation(pendingFlightConfirmation, view.confirmation, Date.now());
  const intent = pendingMissionStart;
  const currentMissionId = text(read(view.mission, "missionId"));
  if (
    intent !== null && (
      view.missionDeviceId !== intent.deviceId ||
      currentMissionId !== intent.missionId ||
      view.missionRoute?.routeId !== intent.routeId
    )
  ) {
    pendingMissionStart = null;
    if (armedCommand?.action === "mission-start") {
      armedCommand = null;
      clearArmTimer();
    }
  }
}

const deepUnwrap = (value: unknown, key: string): unknown => {
  let current: unknown = value;
  for (let step = 0; step < 4; step += 1) {
    if (read(current, key) !== undefined) return current;
    const next = unwrap(current);
    if (next === current) return current;
    current = next;
  }
  return current;
};

const previewGeometry = (value: unknown): { polyline: RouteMapPreview["polyline"]; startMarker: RouteMapPreview["startMarker"]; endMarker: RouteMapPreview["endMarker"] } | null => {
  const current = deepUnwrap(value, "polyline");
  const polyline = read(current, "polyline");
  const startMarker = read(current, "startMarker");
  const endMarker = read(current, "endMarker");
  if (!Array.isArray(polyline) || polyline.length < 2 || startMarker === undefined || endMarker === undefined) return null;
  const points = polyline.flatMap((item) => {
    const longitude = read(item, "longitude");
    const latitude = read(item, "latitude");
    const altitude = read(item, "altitude");
    return typeof longitude === "number" && typeof latitude === "number"
      ? [{ longitude, latitude, altitude: typeof altitude === "number" ? altitude : null }]
      : [];
  });
  const marker = (source: unknown) => {
    const longitude = read(source, "longitude");
    const latitude = read(source, "latitude");
    const altitude = read(source, "altitude");
    return typeof longitude === "number" && typeof latitude === "number"
      ? { longitude, latitude, altitude: typeof altitude === "number" ? altitude : null }
      : null;
  };
  const start = marker(startMarker);
  const end = marker(endMarker);
  return points.length >= 2 && start !== null && end !== null ? { polyline: points, startMarker: start, endMarker: end } : null;
};

const settledInvoke = async (name: string, input: unknown, signal: AbortSignal): Promise<unknown> => {
  try {
    return await awaitCurrentRender(bridge().invoke(name, input), signal);
  } catch {
    return undefined;
  }
};

async function fetchOnce(signal: AbortSignal): Promise<void> {
  const snapshotTask = settledInvoke("state-snapshot", undefined, signal);
  const hintTask = settledInvoke("network-hint", undefined, signal);
  const streamTask = settledInvoke("stream-refresh", undefined, signal);
  const [snapshotResult, hintResult] = await Promise.all([snapshotTask, hintTask, streamTask]);
  if (signal.aborted) return;
  const snapshot = unwrap(unwrap(snapshotResult));
  if (snapshot !== undefined && snapshot !== null) lastSnapshot = snapshot;
  const listed = read(unwrap(hintResult), "hints");
  const liveHints = Array.isArray(listed) ? listed.filter((item): item is string => typeof item === "string" && item.startsWith("ws://")) : [];
  if (liveHints.length > 0) lastRelayHint = liveHints.join(" 或 ");
  const view = projectCached();
  state.missionDeviceId = view.missionDeviceId;
  state.streamDeviceId = view.streamDeviceId;
  const routeId = view.selectedRoute?.routeId ?? null;
  if (state.workspace === "routes" && routeId !== null && lastRoutePreview?.routeId !== routeId) {
    const preview = previewGeometry(await settledInvoke("route-preview", { routeId }, signal));
    if (preview !== null) lastRoutePreview = { routeId, preview };
  }
}

function applyRouteMap(view: ReturnType<typeof OperatorConsole.project>): void {
  const visible = state.workspace === "routes";
  setRouteMapVisible(visible);
  if (!visible) return;
  void ensureRouteMap(el("map")).then(() => {
    if (state.workspace !== "routes") {
      setRouteMapVisible(false);
      return;
    }
    setRouteMapVisible(true);
    el("map-notice").textContent = routeMapNotice();
    const routeId = view.selectedRoute?.routeId ?? null;
    if (routeId === null) {
      if (drawnPreviewId() !== null) clearRoutePreview();
      return;
    }
    const cached = lastRoutePreview?.routeId === routeId ? lastRoutePreview.preview : null;
    if (cached === null) {
      el("route-summary").textContent = `${view.selectedRoute?.displayName ?? ""} · ${routeMapNotice()}`;
      return;
    }
    if (drawnPreviewId() !== routeId) showRoutePreview(routeId, cached);
    el("map-notice").textContent = routeMapNotice();
    el("route-summary").textContent = `${view.selectedRoute?.displayName ?? ""} · ${cached.polyline.length} 个航点`;
  }).catch((error: unknown) => { console.error("[sky-render]", error); });
}

const paintOnce = (): void => {
  document.querySelectorAll("nav button").forEach((button) => {
    button.classList.toggle("active", (button as HTMLButtonElement).dataset.workspace === state.workspace);
  });
  document.querySelectorAll("main").forEach((node) => {
    node.classList.toggle("active", node.id === `workspace-${state.workspace}`);
  });
  const view = projectCached();
  state.missionDeviceId = view.missionDeviceId;
  state.streamDeviceId = view.streamDeviceId;
  try { renderDevices(view); } catch (error) { console.error("[sky-render]", error); }
  try { renderRoutes(view); } catch (error) { console.error("[sky-render]", error); }
  try { renderFlight(view); } catch (error) { console.error("[sky-render]", error); }
  try { applyRouteMap(view); } catch (error) { console.error("[sky-render]", error); }
  void ensurePlayback(view);
};

const paintScheduler = createRenderScheduler(async () => { paintOnce(); }, { deadlineMs: 60_000 });
const snapshotRefresh = createBackgroundRefresh(fetchOnce, {
  deadlineMs: 5_000,
  intervalMs: 1_000,
  onFetched: () => { void paintScheduler.request(); },
});
const render = async (): Promise<void> => {
  try {
    await paintScheduler.request();
  } catch (error) {
    console.error("[sky-render]", error);
    renderFlightConfirmationFallback();
    renderMissionStartConfirmationFallback();
  }
  void snapshotRefresh.request();
};

document.querySelectorAll("nav button").forEach((button) => {
  button.addEventListener("click", () => {
    const workspace = (button as HTMLButtonElement).dataset.workspace;
    if (workspace === "devices" || workspace === "routes" || workspace === "flight") state.workspace = workspace;
    void render();
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-flight-panel]").forEach((button) => {
  button.addEventListener("click", () => {
    const panel = button.dataset.flightPanel;
    if (panel !== "stream" && panel !== "mission" && panel !== "direct-flight") return;
    if (panel !== state.flightPanel && armedCommand !== null) void expireArmedCommand();
    state.flightPanel = panel;
    void render();
  });
});

el("device-refresh").addEventListener("click", async () => {
  const view = await projectView();
  const deviceId = view.missionDeviceId;
  if (deviceId === null) { show("请先选择已连接的手机"); return; }
  const button = el("device-refresh") as HTMLButtonElement;
  button.disabled = true;
  try {
    const result = unwrap(await bridge().invoke("device-refresh", { deviceId }));
    show(accepted(result) ? "已读取当前手机状态，请查看各项状态" : operatorNotice(result));
  } catch {
    show("状态刷新失败，请检查手机连接后重试");
  } finally {
    await render();
  }
});

el("device-link-measure").addEventListener("click", async () => {
  const view = await projectView();
  const deviceId = view.missionDeviceId;
  if (deviceId === null) { show("请先选择已连接的手机"); return; }
  if (phoneLinkProbeInFlightDeviceId !== null) { show("正在测量手机连接，请等待本次结果"); return; }
  const selectedDevice = (view.devices as readonly Record<string, unknown>[]).find((device) => device.deviceId === deviceId);
  if (selectedDevice === undefined) { show("手机连接已变更，请稍后重试"); return; }
  const connectionEpoch = connectionEpochOf(selectedDevice);
  phoneLinkProbeInFlightDeviceId = deviceId;
  try {
    await render();
    const report = phoneLinkProbeReport(deepUnwrap(await bridge().invoke("device-link-measure", { deviceId }), "status"));
    phoneLinkProbes.set(deviceId, Object.freeze({ connectionEpoch, report }));
    show(report.status === "measured" ? "已完成手机连接测量，请查看连接状态" : phoneLinkProbeLabel(report, false));
  } catch {
    const report = Object.freeze({ status: "unavailable" as const, sampleCount: 0 });
    phoneLinkProbes.set(deviceId, Object.freeze({ connectionEpoch, report }));
    show("手机连接测量失败，请检查中继连接后重试");
  } finally {
    phoneLinkProbeInFlightDeviceId = null;
    try { await render(); } catch { /* The measurement lock was released before a best-effort redraw. */ }
  }
});

el("route-import").addEventListener("click", async () => {
  const button = el("route-import") as HTMLButtonElement;
  const view = await projectView();
  const decision = OperatorConsole.evaluate("import-route", view);
  if (!decision.ok) { blocked("import-route", decision.reason ?? "无法导入"); return; }
  const pick = bridge().selectRouteFile;
  if (pick === undefined) { show("当前桌面程序不能选择航迹文件"); return; }
  button.disabled = true;
  try {
    const selected = await pick();
    if (selected.ok !== true || typeof selected.fileName !== "string" || selected.bytes === undefined) return;
    const imported = deepUnwrap(await bridge().invoke("route-import", { fileName: selected.fileName, bytes: selected.bytes }), "status");
    const status = read(imported, "status");
    const routeId = read(read(imported, "route"), "routeId");
    if (status !== "imported" || typeof routeId !== "string") {
      const error = read(imported, "error");
      const detail = typeof read(error, "message") === "string"
        ? read(error, "message") as string
        : typeof read(error, "code") === "string"
          ? `（${read(error, "code") as string}）`
          : "";
      show(detail.length > 0 ? `航线导入失败${detail.startsWith("（") ? detail : `：${detail}`}` : "航线导入失败，请确认是 Wayline 导出的 KML/KMZ");
      await render();
      return;
    }
    await bridge().invoke("route-select", { routeId });
    show(read(imported, "duplicate") === true ? "该航线已经导入过，已重新选中。" : `已导入 ${selected.fileName}`);
    await render();
  } finally {
    button.disabled = false;
  }
});

el("route-locate").addEventListener("click", () => { locateDrawnRoute(); });
el("route-remove").addEventListener("click", async () => {
  const view = await projectView();
  const routeId = view.selectedRoute?.routeId;
  if (routeId === undefined || routeId === null) { show("请先选择要删除的航线"); return; }
  const decision = OperatorConsole.evaluate("remove-route", view);
  if (!decision.ok) { blocked("remove-route", decision.reason ?? "无法删除"); return; }
  const removed = unwrap(await bridge().invoke("route-remove", { routeId }));
  if (accepted(removed) !== true && read(removed, "ok") === false) {
    show("当前航线无法删除");
    await render();
    return;
  }
  clearRoutePreview();
  const remaining = await projectView();
  const next = remaining.routes.find((route) => route.routeId !== routeId);
  if (next !== undefined) await bridge().invoke("route-select", { routeId: next.routeId });
  show(next !== undefined ? `已删除，当前为 ${next.displayName}` : "已删除当前航线");
  await render();
});

  document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", async () => {
    const action = (button as HTMLButtonElement).dataset.action ?? "";
    let view: ReturnType<typeof OperatorConsole.project>;
    try {
      view = await projectView();
    } catch {
      show("界面读取失败，本次操作未发送；请确认手机仍连接后重试");
      renderFlightConfirmationFallback();
      renderMissionStartConfirmationFallback();
      return;
    }
    const armDecision = interpretArmClick(armedCommand, action, Date.now());
    if (isArmableAction(action)) {
      if (armDecision.kind === "ignore") return;
      if (armDecision.kind === "confirm") {
        if (action === "mission-start") {
          if (pendingMissionStart === null) return;
          armedCommand = null;
          clearArmTimer();
          await confirmMissionStart();
          return;
        }
        const dispatch = flightConfirmDispatch(pendingFlightConfirmation, {
          deviceId: view.missionDeviceId,
          uiAction: action,
          nowMs: Date.now(),
        });
        if (dispatch.kind === "wait") return;
        armedCommand = null;
        clearArmTimer();
        await run("flight-confirm", "flight-confirm", { deviceId: dispatch.confirmation.deviceId, confirmationId: dispatch.confirmation.confirmationId }, undefined, action);
        return;
      }
      if (armDecision.kind !== "arm") return;
      if (armedCommand !== null && armedCommand.action !== action) await cancelArmedBackend();
      armedCommand = armDecision.next;
      if (action === "mission-start") {
        await requestMissionStartConfirmation(view);
        if (pendingMissionStart === null) {
          armedCommand = null;
          clearArmTimer();
        } else scheduleArmExpiry();
        return;
      }
      await run(action, "flight-request", { deviceId: view.missionDeviceId, action: action.replace("flight-", "") }, view);
      if (!confirmationMatchesClick(pendingFlightConfirmation, { deviceId: view.missionDeviceId, uiAction: action, nowMs: Date.now() })) {
        armedCommand = null;
        clearArmTimer();
      } else scheduleArmExpiry();
      return;
    }
    if (armedCommand !== null) {
      await cancelArmedBackend();
      armedCommand = null;
      clearArmTimer();
    }
    const streamAction = action.startsWith("stream-");
    const deviceId = streamAction ? view.streamDeviceId : view.missionDeviceId;
    if (action === "stream-select") {
      await run(action, "stream-select", { deviceId }, view);
      show("图传已选中，等待本页出画");
      return;
    }
    if (action === "stream-stop") detachVideo();
    const names: Record<string, string> = {
      "mission-stage": "mission-stage",
      "mission-upload": "mission-upload",
      "mission-pause": "mission-pause",
      "mission-resume": "mission-resume",
      "mission-stop": "mission-stop",
      "stream-start": "stream-start",
      "stream-stop": "stream-stop",
      "flight-confirm-landing": "flight-request",
      "flight-stop-takeoff": "flight-request",
      "flight-stop-auto-landing": "flight-request",
    };
    const invokeName = names[action];
    if (invokeName === undefined) return;
    const input = invokeName === "flight-request"
      ? { deviceId, action: action.replace("flight-", "") }
      : { deviceId };
    if (action === "mission-stage" && view.selectedRoute !== null && deviceId !== null) {
      const assigned = unwrap(await bridge().invoke("assignment-assign", { deviceId, routeId: view.selectedRoute.routeId }));
      if (!accepted(assigned)) {
        blocked("assignment-assign", "航线未能赋给所选手机，未开始传输", deviceId, feedbackDeviceEpoch(view, deviceId));
        return;
      }
    }
    const previousConfirmationId = pendingFlightConfirmation?.confirmationId ?? null;
    await run(action, invokeName, input, view);
    if (isSameClickFlightConfirm(action)) {
      const dispatch = sameClickConfirmDispatch(pendingFlightConfirmation, previousConfirmationId, {
        deviceId,
        uiAction: action,
        nowMs: Date.now(),
      });
      if (dispatch.kind === "dispatch") {
        await run("flight-confirm", "flight-confirm", { deviceId: dispatch.confirmation.deviceId, confirmationId: dispatch.confirmation.confirmationId }, undefined, action);
      }
    }
  });
});

void snapshotRefresh.request();
