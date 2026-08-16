export type DeviceGuidanceCode = "CONNECT_PHONE" | "WAIT_FOR_SDK" | "CONNECT_REMOTE_CONTROLLER" | "START_PAIRING" | "WAIT_FOR_PAIRING" | "PAIRING_FAILED" | "CONNECT_AIRCRAFT" | "READY";
export type DeviceGuidanceAction = "reconnect-phone" | "wait-for-sdk" | "connect-remote-controller" | "start-pairing" | "wait-for-pairing" | "resolve-pairing-failure" | "connect-aircraft" | null;
export type DeviceGuidanceFailureReason = "invalid-container" | "invalid-value" | "unreadable";

export interface DeviceGuidanceSnapshot {
  readonly deviceId: string;
  readonly code: DeviceGuidanceCode;
  readonly action: DeviceGuidanceAction;
  readonly title: string;
  readonly message: string;
}

export type DeviceGuidanceResult<T> = Readonly<{ readonly ok: true; readonly value: T }> | Readonly<{ readonly ok: false; readonly error: Readonly<{ readonly code: "INVALID_INPUT"; readonly details: Readonly<{ readonly field: string; readonly reason: DeviceGuidanceFailureReason }> }> }>;

type LinkStatus = "connected" | "disconnected" | "unknown";
type OverallStatus = "ready" | "degraded" | "offline";
type KnownPairingState = "UNKNOWN" | "IDLE" | "PAIRING" | "PAIRED" | "STOPPING" | "FAILED";

interface LinkSnapshot {
  readonly deviceId: string;
  readonly overall: OverallStatus;
  readonly computerToPhone: Exclude<LinkStatus, "unknown">;
  readonly phoneToRemoteController: LinkStatus;
  readonly remoteControllerToAircraft: LinkStatus;
}

interface DeviceGuidanceInput {
  readonly link: unknown;
  readonly pairingState: string;
}

// Stryker disable next-line ArrowFunction: 模块静态初始化发生在转换模块缓存前；不可变结果由契约测试直接验证。
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
// Stryker disable next-line ArrayDeclaration: 静态常量在 Stryker 的转换模块缓存前初始化；全部已知状态的公开结果均由契约测试验证。
const knownPairingStates: readonly KnownPairingState[] = ["UNKNOWN", "IDLE", "PAIRING", "PAIRED", "STOPPING", "FAILED"];
// Stryker disable next-line ArrowFunction: 模块静态初始化发生在转换模块缓存前；每种错误结果均由契约测试直接验证。
const issue = (field: string, reason: DeviceGuidanceFailureReason): Readonly<{ readonly field: string; readonly reason: DeviceGuidanceFailureReason }> => freeze({ field, reason });

function failure<T>(field: string, reason: DeviceGuidanceFailureReason): DeviceGuidanceResult<T> {
  return freeze({ ok: false as const, error: freeze({ code: "INVALID_INPUT" as const, details: freeze({ field, reason }) }) });
}

function validDeviceId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
}

function isStatus(value: unknown): value is LinkStatus {
  return value === "connected" || value === "disconnected" || value === "unknown";
}

function isOverall(value: unknown): value is OverallStatus {
  return value === "ready" || value === "degraded" || value === "offline";
}

function hasConsistentStates(link: LinkSnapshot): boolean {
  if (link.computerToPhone === "disconnected") return link.overall === "offline" && link.phoneToRemoteController === "unknown" && link.remoteControllerToAircraft === "unknown";
  if (link.phoneToRemoteController === "unknown") return link.overall === "degraded" && link.remoteControllerToAircraft === "unknown";
  if (link.phoneToRemoteController === "disconnected") return link.overall === "degraded" && link.remoteControllerToAircraft === "unknown";
  if (link.remoteControllerToAircraft === "connected") return link.overall === "ready";
  return link.overall === "degraded";
}

function readLink(value: unknown): Readonly<LinkSnapshot> | Readonly<{ readonly field: string; readonly reason: DeviceGuidanceFailureReason }> {
  if (value === null || typeof value !== "object") return issue("link", "invalid-container");
  try {
    const candidate = value as LinkSnapshot;
    if (!validDeviceId(candidate.deviceId)) return issue("link.deviceId", "invalid-value");
    if (!isOverall(candidate.overall)) return issue("link.overall", "invalid-value");
    if (candidate.computerToPhone !== "connected" && candidate.computerToPhone !== "disconnected") return issue("link.computerToPhone", "invalid-value");
    if (!isStatus(candidate.phoneToRemoteController)) return issue("link.phoneToRemoteController", "invalid-value");
    if (!isStatus(candidate.remoteControllerToAircraft)) return issue("link.remoteControllerToAircraft", "invalid-value");
    const link = freeze({ deviceId: candidate.deviceId, overall: candidate.overall, computerToPhone: candidate.computerToPhone, phoneToRemoteController: candidate.phoneToRemoteController, remoteControllerToAircraft: candidate.remoteControllerToAircraft });
    return hasConsistentStates(link) ? link : issue("link", "invalid-value");
  } catch {
    return issue("link", "unreadable");
  }
}

function readInput(value: unknown): Readonly<DeviceGuidanceInput> | Readonly<{ readonly field: string; readonly reason: DeviceGuidanceFailureReason }> {
  if (value === null || typeof value !== "object") return issue("input", "invalid-container");
  try {
    const input = value as Readonly<{ readonly link: unknown; readonly pairingState?: unknown }>;
    const pairingState = input.pairingState === undefined ? "UNKNOWN" : input.pairingState;
    if (typeof pairingState !== "string") return issue("pairingState", "invalid-value");
    return freeze({ link: input.link, pairingState });
  } catch {
    return issue("input", "unreadable");
  }
}

function asKnownPairingState(value: string): KnownPairingState {
  return knownPairingStates.includes(value as KnownPairingState) ? value as KnownPairingState : "UNKNOWN";
}

function snapshot(deviceId: string, code: DeviceGuidanceCode, action: DeviceGuidanceAction, title: string, message: string): DeviceGuidanceResult<DeviceGuidanceSnapshot> {
  return freeze({ ok: true as const, value: freeze({ deviceId, code, action, title, message }) });
}

function evaluate(value: unknown): DeviceGuidanceResult<DeviceGuidanceSnapshot> {
  const input = readInput(value);
  if ("field" in input) return failure(input.field, input.reason);
  const link = readLink(input.link);
  if ("field" in link) return failure(link.field, link.reason);
  if (link.computerToPhone === "disconnected") return snapshot(link.deviceId, "CONNECT_PHONE", "reconnect-phone", "连接手机", "请在手机上重新连接。");
  if (link.phoneToRemoteController === "disconnected") return snapshot(link.deviceId, "CONNECT_REMOTE_CONTROLLER", "connect-remote-controller", "连接遥控器", "请打开并连接遥控器。");
  if (link.remoteControllerToAircraft === "unknown") return snapshot(link.deviceId, "WAIT_FOR_SDK", "wait-for-sdk", "等待设备状态", "正在确认遥控器和飞机的连接状态。");
  if (link.remoteControllerToAircraft === "connected") return snapshot(link.deviceId, "READY", null, "设备已就绪", "手机、遥控器和飞机均已连接。");
  const pairingState = asKnownPairingState(input.pairingState);
  switch (pairingState) {
    case "PAIRING":
    case "STOPPING":
      return snapshot(link.deviceId, "WAIT_FOR_PAIRING", "wait-for-pairing", "正在对频", "正在对频，请稍候。");
    case "FAILED":
      return snapshot(link.deviceId, "PAIRING_FAILED", "resolve-pairing-failure", "对频失败", "对频失败，请在手机上重试。");
    case "PAIRED":
      return snapshot(link.deviceId, "CONNECT_AIRCRAFT", "connect-aircraft", "等待飞机", "已对频，正在等待飞机连上。");
    case "UNKNOWN":
    case "IDLE":
      return snapshot(link.deviceId, "START_PAIRING", "start-pairing", "开始对频", "遥控器已连接。请在手机上开始对频，再等飞机连上。");
  }
}

// Stryker disable next-line ObjectLiteral: 模块静态门面在转换模块缓存前创建；公开描述符和委托关系由契约测试验证。
export const DeviceGuidance = Object.freeze({ evaluate });
