const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);

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
});
