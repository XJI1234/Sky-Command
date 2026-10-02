const freeze = <const T extends object>(value: T): Readonly<T> => Object.freeze(value);

export const EMPTY_STATUS = "—";

const text = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 ? value : null;
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;

export function commandReachStatus(input: Readonly<{
  readonly selected: boolean;
  readonly relayOnline: boolean;
  readonly msdkReady: boolean;
  readonly airLinkConnected?: boolean;
  readonly cameraConnected?: boolean;
}>): string {
  if (!input.selected) return "未选择手机";
  if (!input.relayOnline) return "中继未连接";
  if (!input.msdkReady) return "MSDK 未就绪";
  if (input.airLinkConnected === false) return "AirLink 未连接";
  if (input.cameraConnected === false) return "主相机未连接";
  return input.airLinkConnected === true && input.cameraConnected === true ? "可推流" : "可下发";
}

export function streamPushStatus(input: Readonly<{
  readonly selected: boolean;
  readonly streaming: boolean | null;
  readonly resolution: string | null;
  readonly fps: string | number | null;
}>): string {
  if (!input.selected) return "未选择手机";
  if (input.streaming === true) {
    const details = [input.resolution, input.fps === null ? null : `${input.fps} fps`].filter((part): part is string => part !== null && part.length > 0);
    return details.length > 0 ? `推流中 · ${details.join(" · ")}` : "推流中";
  }
  if (input.streaming === false) return "未推流";
  return EMPTY_STATUS;
}

export function streamPaintStatus(input: Readonly<{ readonly selected: boolean; readonly painting: boolean | null }>): string {
  if (!input.selected) return "未选择手机";
  if (input.painting === true) return "正在出画";
  if (input.painting === false) return "未出画";
  return EMPTY_STATUS;
}

export function streamErrorStatus(input: Readonly<{
  readonly selected: boolean;
  readonly code: string | null;
  readonly description: string | null;
}>): string {
  if (!input.selected) return "未选择手机";
  if (input.code === null && input.description === null) return EMPTY_STATUS;
  return [input.code, input.description].filter((part): part is string => part !== null).join(" ");
}

export function missionExecutionNowStatus(input: Readonly<{
  readonly selected: boolean;
  readonly execution: string | null;
  readonly waypoint: string | null;
  readonly fileName: string | null;
}>): string {
  if (!input.selected) return "未选择手机";
  const parts = [input.execution, input.waypoint, input.fileName].filter((part): part is string => part !== null && part.length > 0);
  return parts.length > 0 ? parts.join(" · ") : EMPTY_STATUS;
}

export function missionUploadOrActionStatus(input: Readonly<{
  readonly selected: boolean;
  readonly uploadPercent: number | null;
  readonly action: string | null;
}>): string {
  if (!input.selected) return "未选择手机";
  if (typeof input.uploadPercent === "number" && Number.isSafeInteger(input.uploadPercent) && input.uploadPercent >= 0 && input.uploadPercent < 100) {
    return `上传中 ${input.uploadPercent}%`;
  }
  if (input.action !== null && input.action.length > 0) return input.action;
  return EMPTY_STATUS;
}

export function interruptStatus(input: Readonly<{
  readonly selected: boolean;
  readonly code: string | null;
  readonly description: string | null;
}>): string {
  return streamErrorStatus(input);
}

export function directProcessStatus(input: Readonly<{
  readonly selected: boolean;
  readonly flying: string | null;
  readonly motorsOn: boolean | null;
  readonly flightMode: string | null;
  readonly landingConfirmationNeeded: boolean | null;
  readonly lowBatteryRthState: string | null;
}>): string {
  if (!input.selected) return "未选择手机";
  if (input.flying === "grounded" && input.motorsOn === false) return "地面";
  if (input.motorsOn === true && input.flying !== "flying") return "起飞中";
  if (input.flying === "flying") {
    const mode = input.flightMode ?? "";
    if (mode === "AUTO_LANDING" || mode === "CONFIRM_LANDING" || input.landingConfirmationNeeded === true) return "降落中";
    if (mode === "GO_HOME" || mode === "AUTO_RETURN" || input.lowBatteryRthState === "COUNTING_DOWN" || input.lowBatteryRthState === "EXECUTED") {
      return "返航中";
    }
    return "飞行中";
  }
  return EMPTY_STATUS;
}

export function directAlertStatus(input: Readonly<{
  readonly selected: boolean;
  readonly takeoffFailure: string | null;
  readonly motorStartFailure: string | null;
  readonly visionWarning: string | null;
}>): string {
  if (!input.selected) return "未选择手机";
  if (input.takeoffFailure !== null && input.takeoffFailure.length > 0) return input.takeoffFailure;
  if (input.motorStartFailure !== null && input.motorStartFailure.length > 0) return input.motorStartFailure;
  if (input.visionWarning !== null && input.visionWarning.length > 0) return input.visionWarning;
  return EMPTY_STATUS;
}

export function hudFlying(state: string | null): string {
  if (state === "flying") return "飞行中";
  if (state === "grounded") return "未飞行";
  return EMPTY_STATUS;
}

export function hudMotors(motorsOn: boolean | null): string {
  if (motorsOn === true) return "电机开";
  if (motorsOn === false) return "电机关";
  return EMPTY_STATUS;
}

export function hudBattery(percent: unknown): string {
  const value = finite(percent);
  return value !== null && value >= 0 && value <= 100 ? `${Math.round(value)}%` : EMPTY_STATUS;
}

export function hudAltitude(meters: unknown): string {
  const value = finite(meters);
  return value === null ? EMPTY_STATUS : `${value.toFixed(1)} m`;
}

export function hudText(value: unknown): string {
  return text(value) ?? EMPTY_STATUS;
}

const TAKEOFF_MODES = new Set(["AUTO_TAKEOFF"]);
const LAND_MODES = new Set(["AUTO_LANDING", "FORCE_LANDING"]);
const HOME_MODES = new Set(["GO_HOME", "AUTO_RETURN"]);
const PHONE_MISSION = new Set(["STARTING", "EXECUTING", "PAUSED"]);
const DJI_MISSION = new Set(["PREPARING", "RECOVERING", "ENTER_WAYLINE", "EXECUTING", "PAUSED", "RETURN_TO_START_POINT"]);
const DJI_MISSION_IDLE = new Set(["IDLE", "READY", "UPLOADING", "FINISHED", "INTERRUPTED", "DISCONNECTED", "NOT_SUPPORTED", "UNKNOWN"]);

export function monitorAircraftStatus(input: Readonly<{
  readonly flying: string | null;
  readonly motorsOn: boolean | null;
  readonly flightMode: string | null;
  readonly landingConfirmationNeeded: boolean | null;
  readonly landingProtectionState: string | null;
  readonly lowBatteryRthState: string | null;
  readonly missionExecution: string | null;
  readonly djiMissionState: string | null;
  readonly waypointIndex: number | null;
  readonly flightController: string | null;
}>): Readonly<{ readonly label: string; readonly detail: string }> {
  if (input.flightController === "disconnected") return { label: "飞控未连接", detail: "" };
  const mode = input.flightMode;
  const flying = input.flying === "flying" || input.flying === "grounded" ? input.flying : null;
  const djiActive = input.djiMissionState !== null && DJI_MISSION.has(input.djiMissionState);
  const djiIdle = input.djiMissionState !== null && DJI_MISSION_IDLE.has(input.djiMissionState);
  const phoneActive = input.missionExecution !== null && PHONE_MISSION.has(input.missionExecution);
  const missionActive = djiActive || (phoneActive && !djiIdle);
  const aircraftExecuting = input.djiMissionState === "EXECUTING" || input.djiMissionState === "ENTER_WAYLINE" || input.djiMissionState === "RETURN_TO_START_POINT";
  const paused = input.djiMissionState === "PAUSED" || (input.missionExecution === "PAUSED" && !aircraftExecuting);
  const starting = !paused && (
    input.djiMissionState === "PREPARING"
    || input.djiMissionState === "RECOVERING"
    || input.djiMissionState === "ENTER_WAYLINE"
    || (input.missionExecution === "STARTING" && !aircraftExecuting && input.djiMissionState !== "PAUSED")
  );
  const protection = input.landingProtectionState === "NOT_SAFE_TO_LAND" ? "当前不适合降落" : "";
  const waypoint = typeof input.waypointIndex === "number" && Number.isSafeInteger(input.waypointIndex) && input.waypointIndex >= 0
    ? `航点 ${input.waypointIndex}`
    : "";
  const returningHome = (mode !== null && HOME_MODES.has(mode)) || (flying === "flying" && input.lowBatteryRthState === "COUNTING_DOWN");

  if (flying === "grounded" && input.motorsOn === false) {
    return { label: "地面", detail: "" };
  }
  if (input.landingConfirmationNeeded === true || mode === "CONFIRM_LANDING") {
    return { label: "继续降落", detail: protection };
  }
  if (mode !== null && LAND_MODES.has(mode)) {
    return { label: "降落", detail: protection };
  }
  if (returningHome) {
    return { label: "返航", detail: "" };
  }
  if (flying === "flying" && missionActive) {
    const detail = [
      paused ? "已暂停" : starting ? "启动中" : "",
      input.djiMissionState === "RETURN_TO_START_POINT" ? "返回起点" : "",
      waypoint,
    ].filter((part) => part.length > 0).join(" · ");
    return { label: "执行航线", detail };
  }
  if ((flying === "grounded" && input.motorsOn === true) || (mode !== null && TAKEOFF_MODES.has(mode))) {
    return { label: "起飞", detail: "" };
  }
  if (flying === "flying") {
    return { label: "悬停", detail: mode ?? "" };
  }
  return { label: "未确认", detail: "" };
}

const WAYLINE_STOP_DJI = new Set(["PREPARING", "RECOVERING", "ENTER_WAYLINE", "EXECUTING", "PAUSED", "RETURN_TO_START_POINT"]);
const WAYLINE_STOP_PHONE = new Set(["STARTING", "EXECUTING", "PAUSED", "STOPPING"]);

export type MonitorHoverCommand =
  | Readonly<{ readonly kind: "stop"; readonly detail: string }>
  | Readonly<{ readonly kind: "flight"; readonly action: "stop-takeoff" | "stop-auto-landing" | "stop-go-home"; readonly detail: string }>
  | Readonly<{ readonly kind: "none"; readonly state: "done" | "failed"; readonly detail: string }>;

export function monitorHoverCommand(input: Parameters<typeof monitorAircraftStatus>[0]): MonitorHoverCommand {
  if (input.flightController === "disconnected") return freeze({ kind: "none", state: "failed", detail: "飞控未连接" });
  const mode = input.flightMode;
  const flying = input.flying === "flying" || input.flying === "grounded" ? input.flying : null;
  const wayline = (input.djiMissionState !== null && WAYLINE_STOP_DJI.has(input.djiMissionState))
    || (input.missionExecution !== null && WAYLINE_STOP_PHONE.has(input.missionExecution));
  const returningHome = (mode !== null && HOME_MODES.has(mode)) || (flying === "flying" && input.lowBatteryRthState === "COUNTING_DOWN");
  if (flying === "grounded" && input.motorsOn === false) return freeze({ kind: "none", state: "done", detail: "飞机在地面" });
  if (input.landingConfirmationNeeded === true || mode === "CONFIRM_LANDING") return freeze({ kind: "flight", action: "stop-auto-landing", detail: "正在停止自动降落，飞机悬停" });
  if (mode !== null && LAND_MODES.has(mode)) return freeze({ kind: "flight", action: "stop-auto-landing", detail: "正在停止自动降落，飞机悬停" });
  if (returningHome) return freeze({ kind: "flight", action: "stop-go-home", detail: "正在退出返航，飞机悬停" });
  if (wayline) return freeze({ kind: "stop", detail: "正在停止航线，飞机悬停" });
  if ((flying === "grounded" && input.motorsOn === true) || (mode !== null && TAKEOFF_MODES.has(mode))) return freeze({ kind: "flight", action: "stop-takeoff", detail: "正在停止自动起飞，飞机悬停" });
  if (flying === "flying") return freeze({ kind: "none", state: "done", detail: "飞机已在悬停" });
  return freeze({ kind: "none", state: "failed", detail: "飞控状态未确认，未发送悬停" });
}

const ROUTE_EXECUTING_DJI = new Set(["EXECUTING", "ENTER_WAYLINE", "RETURN_TO_START_POINT"]);

export type MonitorRouteControl = "choose" | "await" | "pause" | "resume" | "stopping";

export function monitorRouteControl(input: Readonly<{
  readonly missionPhase: string | null;
  readonly routeExecutionStarted: boolean;
  readonly missionExecution: string | null;
  readonly djiMissionState: string | null;
}>): MonitorRouteControl {
  const phase = input.missionPhase;
  const dji = input.djiMissionState;
  const phone = input.missionExecution;
  const djiExecuting = dji !== null && ROUTE_EXECUTING_DJI.has(dji);
  const aircraftPaused = dji === "PAUSED" || (phone === "PAUSED" && !djiExecuting);
  const aircraftExecuting = djiExecuting || phone === "EXECUTING";
  if (phase === "stopping" || phone === "STOPPING") return "stopping";
  if (phase === "resuming") return aircraftExecuting ? "pause" : "resume";
  if (aircraftPaused && phase !== "starting") return "resume";
  if (phase === "paused") return "resume";
  if (phase === "pausing") return "pause";
  if (aircraftExecuting || phase === "running" || (input.routeExecutionStarted && phase === "starting")) return "pause";
  if (phase === "starting" || phone === "STARTING") return "await";
  return "choose";
}

export type MonitorDirectControl = Readonly<{
  readonly label: "返航" | "停止返航" | "降落" | "确认降落";
  readonly mode: "return-home" | "stop-go-home" | "land" | "confirm-landing";
}>;

export function monitorDirectFlight(input: Readonly<{
  readonly flying: string | null;
  readonly motorsOn: boolean | null;
  readonly flightMode: string | null;
  readonly landingConfirmationNeeded: boolean | null;
  readonly lowBatteryRthState: string | null;
}>): Readonly<{ readonly home: MonitorDirectControl; readonly land: MonitorDirectControl }> {
  const mode = input.flightMode;
  const flying = input.flying === "flying" || input.flying === "grounded" ? input.flying : null;
  const onGround = flying === "grounded" && input.motorsOn === false;
  const confirmLanding = !onGround && (input.landingConfirmationNeeded === true || mode === "CONFIRM_LANDING");
  const returningHome = !onGround && !confirmLanding && ((mode !== null && HOME_MODES.has(mode)) || (flying === "flying" && input.lowBatteryRthState === "COUNTING_DOWN"));
  return freeze({
    home: returningHome ? freeze({ label: "停止返航", mode: "stop-go-home" }) : freeze({ label: "返航", mode: "return-home" }),
    land: confirmLanding ? freeze({ label: "确认降落", mode: "confirm-landing" }) : freeze({ label: "降落", mode: "land" }),
  });
}

export function monitorStreamToggle(input: Readonly<{
  readonly present: boolean;
  readonly streamPhase: string | null;
  readonly videoPhase: string | null;
  readonly failureCode: string | null;
  readonly sdkReady: boolean;
  readonly airLink: string | null;
  readonly camera: string | null;
  readonly playing: boolean;
  readonly phoneStreaming: boolean;
  readonly releasePhoneHold: boolean;
}>): Readonly<{ readonly label: string; readonly enabled: boolean; readonly mode: "start" | "stop" | "idle"; readonly title: string }> {
  if (!input.present) return { label: "启动图传", enabled: false, mode: "idle", title: "空位" };
  const sourceGone = input.streamPhase === "failed" && input.failureCode === "SOURCE_UNAVAILABLE";
  // 手机仍报告在推流（含 fps 为 0）时这一颗键去停。停完一次后松开，避免卡在停止、再也点不了启动。
  const heldByPhone = input.phoneStreaming && !input.releasePhoneHold && !sourceGone;
  const session = !sourceGone && (
    input.streamPhase === "starting" || input.streamPhase === "streaming" || input.streamPhase === "stopping"
    || input.videoPhase === "ready" || input.videoPhase === "awaiting-playback" || input.videoPhase === "awaiting-ingest"
    || input.playing
  );
  if (heldByPhone || session) return { label: "停止图传", enabled: true, mode: "stop", title: "停止图传" };
  if (!input.sdkReady) return { label: "启动图传", enabled: false, mode: "idle", title: "手机尚未就绪，无法启动图传" };
  if (input.airLink !== "connected") {
    return {
      label: "启动图传",
      enabled: false,
      mode: "idle",
      title: input.airLink === "disconnected" ? "AirLink 未连接，无法启动图传" : "AirLink 状态未知，无法启动图传",
    };
  }
  if (input.camera !== "connected") {
    return {
      label: "启动图传",
      enabled: false,
      mode: "idle",
      title: input.camera === "disconnected" ? "主相机未连接，无法启动图传" : "主相机状态未知，无法启动图传",
    };
  }
  return { label: "启动图传", enabled: true, mode: "start", title: "启动这架飞机的图传" };
}

export const FlightNowStatus = freeze({
  EMPTY_STATUS,
  commandReachStatus,
  streamPushStatus,
  streamPaintStatus,
  streamErrorStatus,
  missionExecutionNowStatus,
  missionUploadOrActionStatus,
  interruptStatus,
  directProcessStatus,
  directAlertStatus,
  hudFlying,
  hudMotors,
  hudBattery,
  hudAltitude,
  hudText,
  monitorAircraftStatus,
  monitorHoverCommand,
  monitorRouteControl,
  monitorDirectFlight,
  monitorStreamToggle,
});
