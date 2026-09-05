export type OperationFeedbackSource = "dji" | "relay" | "desktop";
export type OperationFeedbackOutcome = "accepted" | "rejected" | "unconfirmed" | "pending" | "not-called" | "completed";

export interface OperationFeedback {
  readonly source: OperationFeedbackSource;
  readonly outcome: OperationFeedbackOutcome;
  readonly message: string;
}

type RecordValue = Record<string, unknown>;

const record = (value: unknown): RecordValue | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
const read = (value: unknown, key: string): unknown => {
  const source = record(value);
  if (source === null) return undefined;
  try { return source[key]; } catch { return undefined; }
};
const text = (value: unknown, maxLength = 512): string | null => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= maxLength && !/[\p{Cc}]/u.test(value) ? value : null;
const unwrap = (value: unknown): unknown => {
  let current = value;
  for (let step = 0; step < 4; step += 1) {
    const source = record(current);
    if (source === null || source.ok !== true || !Object.hasOwn(source, "value")) return current;
    current = source.value;
  }
  return current;
};

const flightLabel = (action: unknown): string => {
  if (action === "takeoff") return "起飞";
  if (action === "land") return "降落";
  if (action === "confirm-landing") return "确认继续降落";
  if (action === "return-home" || action === "returnHome" || action === "rth") return "返航";
  if (action === "stop-takeoff") return "停止自动起飞";
  if (action === "stop-auto-landing") return "停止自动降落";
  return text(action, 64) ?? "该动作";
};

const missionLabel = (action: string): string => {
  if (action === "mission-upload") return "上传至飞机";
  if (action === "mission-start") return "执行航线";
  if (action === "mission-pause") return "暂停航线";
  if (action === "mission-resume") return "恢复航线";
  if (action === "mission-stop") return "停止航线";
  return "航线操作";
};

const streamLabel = (action: string): string => action === "stream-stop" ? "停止图传" : "启动图传";

const localReason = (code: string | null): string => {
  if (code === "DEVICE_OFFLINE" || code === "RELAY_OFFLINE") return "手机中继离线";
  if (code === "SDK_NOT_READY") return "手机端 MSDK 尚未就绪";
  if (code === "AIRLINK_OFFLINE") return "AirLink 未连接";
  if (code === "AIRLINK_CONNECTION_UNKNOWN") return "AirLink 状态未知";
  if (code === "CAMERA_OFFLINE") return "主相机未连接";
  if (code === "CAMERA_CONNECTION_UNKNOWN") return "主相机状态未知";
  if (code === "CAPABILITY_BLOCKED") return "必要的可达性条件未满足";
  if (code === "OPERATION_IN_PROGRESS") return "上一条命令仍在处理";
  if (code === "INVALID_INPUT") return "输入无效";
  if (code === "DISPOSED") return "操作模块已停止";
  if (code === "DEPENDENCY_FAILURE") return "桌面依赖不可用";
  if (code === "CONFIRMATION_EXPIRED") return "人工确认已过期";
  if (code === "CONFIRMATION_MISMATCH") return "人工确认与当前操作不匹配";
  if (code === "NO_PENDING_CONFIRMATION") return "没有待确认的操作";
  return code === null ? "未满足本地必要条件" : code;
};

const confirmationAction = (inner: unknown): string | null => {
  const direct = text(read(inner, "action"), 64);
  if (direct !== null) return direct;
  return text(read(read(inner, "confirmation"), "action"), 64);
};

const msdkCallback = (
  source: OperationFeedbackSource,
  outcome: OperationFeedbackOutcome,
  status: "成功" | "失败" | "未确认",
  rawType: "onSuccess" | "onFailure" | "无最终回调",
  details: readonly string[] = [],
): OperationFeedback => ({
  source,
  outcome,
  message: [`MSDK 回调：${status}`, `原始类型：${rawType}`, ...details].join("\n"),
});

const djiFailure = (inner: unknown): OperationFeedback => {
  const platformError = read(inner, "platformError");
  const code = text(read(platformError, "code"));
  const description = text(read(platformError, "description"));
  const details = [
    ...(code === null ? [] : [`错误码：${code}`]),
    ...(description === null ? [] : [`错误说明：${description}`]),
  ];
  return msdkCallback("dji", "rejected", "失败", "onFailure", details);
};

const unconfirmed = (label: string, explanation = `未收到 DJI MSDK ${label} 的最终回调；不能据此判断命令是否执行`): OperationFeedback =>
  msdkCallback("relay", "unconfirmed", "未确认", "无最终回调", [`说明：${explanation}`]);

const operationLabel = (action: string, flightAction: string): string =>
  action.startsWith("flight-") ? flightAction : action.startsWith("mission-") ? missionLabel(action) : streamLabel(action);

export const operationFeedback = (action: string, value: unknown): OperationFeedback => {
  const inner = unwrap(value);
  const code = text(read(inner, "code")) ?? text(read(value, "code"));
  const confirmedAction = confirmationAction(inner);
  const platformAction = flightLabel(confirmedAction);

  if (code === "FLIGHT_ACTION_REJECTED") return djiFailure(inner);
  if (code === "WAYLINE_ACTION_REJECTED") return djiFailure(inner);
  if (code === "STREAM_ACTION_REJECTED") return djiFailure(inner);
  if (code === "RESULT_UNCONFIRMED" || (code !== null && code.endsWith("_UNCONFIRMED"))) return unconfirmed(operationLabel(action, platformAction));
  if (code === "FLIGHT_ACTION_INVOCATION_FAILED" || code === "WAYLINE_ACTION_INVOCATION_FAILED" || code === "STREAM_ACTION_INVOCATION_FAILED") {
    return unconfirmed(operationLabel(action, platformAction), `手机未取得 DJI MSDK ${operationLabel(action, platformAction)} 的可用结果`);
  }
  if (
    code === "DEPENDENCY_FAILURE" ||
    code === "WAYLINE_UPLOAD_FAILED" ||
    code === "WAYLINE_START_FAILED" ||
    code === "WAYLINE_PAUSE_FAILED" ||
    code === "WAYLINE_RESUME_FAILED" ||
    code === "WAYLINE_STOP_FAILED"
  ) return unconfirmed(operationLabel(action, platformAction), `未收到 DJI MSDK ${operationLabel(action, platformAction)}的可判定结果`);
  if (code === "RELAY_REJECTED") {
    const reason = text(read(inner, "reason")) ?? text(read(value, "reason"));
    return { source: "relay", outcome: "rejected", message: `手机/中继回调：拒绝${action.startsWith("flight-") ? platformAction : action.startsWith("mission-") ? missionLabel(action) : streamLabel(action)}${reason === null ? "" : `；原因：${reason}`}` };
  }
  if (code === "CONFIRMATION_REQUIRED" && read(inner, "confirmation") !== undefined) {
    const label = action.startsWith("mission-") ? missionLabel(action) : flightLabel(confirmedAction);
    return { source: "desktop", outcome: "pending", message: `等待人工确认：${label} 尚未调用 DJI MSDK` };
  }
  if (code === "CANCELLED" && read(inner, "confirmation") !== undefined) {
    return { source: "desktop", outcome: "completed", message: `已取消${flightLabel(confirmedAction)}，未调用 DJI MSDK` };
  }
  const reason = text(read(inner, "reason")) ?? text(read(value, "reason"));
  if (code !== null && code !== "SUCCEEDED") return { source: "desktop", outcome: "not-called", message: `未调用 DJI MSDK：${localReason(reason ?? code)}` };

  if (record(inner)?.confirmation !== undefined) return { source: "desktop", outcome: "pending", message: `等待人工确认：${flightLabel(confirmedAction)} 尚未调用 DJI MSDK` };
  if (action === "mission-stage") return { source: "relay", outcome: "completed", message: "手机中继回调：航线文件已传输并校验（此步骤未调用 DJI MSDK）" };
  if (code === "SUCCEEDED" && action.startsWith("flight-")) return msdkCallback("dji", "accepted", "成功", "onSuccess");
  if (code === "SUCCEEDED" && action.startsWith("mission-")) return msdkCallback("dji", "accepted", "成功", "onSuccess");
  if (code === "SUCCEEDED" && action.startsWith("stream-")) return msdkCallback("dji", "accepted", "成功", "onSuccess");
  if (read(inner, "ok") === true || read(value, "ok") === true) return { source: "relay", outcome: "completed", message: "手机中继回调：已完成" };
  return { source: "desktop", outcome: "not-called", message: "未调用 DJI MSDK：没有获得可识别的操作结果" };
};
