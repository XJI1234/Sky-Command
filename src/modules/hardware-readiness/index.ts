export type HardwareReadinessTarget = "legacy-video" | "flight-control";

export interface HardwareReadinessInput {
  readonly desktop: {
    readonly lanAddressAvailable: boolean;
    readonly legacyMediaAvailable: boolean;
  };
  readonly relayConnected: boolean;
  readonly payload: {
    readonly sdkRegistered?: boolean;
    readonly remoteControllerConnected?: boolean;
    readonly flightControllerConnected?: boolean;
    readonly connected?: boolean;
  };
}

export type HardwareReadinessBlockerCode =
  | "INVALID_INPUT"
  | "DESKTOP_NETWORK_UNAVAILABLE"
  | "LEGACY_MEDIA_UNAVAILABLE"
  | "PHONE_DISCONNECTED"
  | "SDK_NOT_READY"
  | "REMOTE_CONTROLLER_DISCONNECTED"
  | "FLIGHT_CONTROLLER_DISCONNECTED"
  | "AIRCRAFT_DISCONNECTED";

export interface HardwareReadinessBlocker {
  readonly code: HardwareReadinessBlockerCode;
  readonly message: string;
}

export type HardwareReadinessResult =
  | Readonly<{ readonly ok: true; readonly blockers: readonly [] }>
  | Readonly<{ readonly ok: false; readonly blockers: readonly HardwareReadinessBlocker[] }>;

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";
const messages: Readonly<Record<HardwareReadinessBlockerCode, string>> = freeze({
  INVALID_INPUT: "无法读取预检状态，请稍后重试。",
  DESKTOP_NETWORK_UNAVAILABLE: "电脑没有可用的局域网地址，请检查 Wi-Fi/网线。",
  LEGACY_MEDIA_UNAVAILABLE: "电脑图传服务不可用，请重启 Sky Command。",
  PHONE_DISCONNECTED: "手机尚未连接到电脑。",
  SDK_NOT_READY: "手机端 DJI 尚未就绪，请在手机上确认已启动。",
  REMOTE_CONTROLLER_DISCONNECTED: "遥控器尚未连接。",
  FLIGHT_CONTROLLER_DISCONNECTED: "飞机飞控未连接，请确认飞机已开机。",
  AIRCRAFT_DISCONNECTED: "飞机尚未连接。",
});

interface NormalizedInput {
  readonly lanAddressAvailable: unknown;
  readonly legacyMediaAvailable: unknown;
  readonly relayConnected: unknown;
  readonly sdkRegistered: unknown;
  readonly remoteControllerConnected: unknown;
  readonly flightControllerConnected: unknown;
  readonly connected: unknown;
}

const validTarget = (value: unknown): value is HardwareReadinessTarget => value === "legacy-video" || value === "flight-control";
const normalize = (value: unknown): NormalizedInput | null => {
  try {
    if (!isRecord(value) || !isRecord(value.desktop) || !isRecord(value.payload)) return null;
    return freeze({
      lanAddressAvailable: value.desktop.lanAddressAvailable,
      legacyMediaAvailable: value.desktop.legacyMediaAvailable,
      relayConnected: value.relayConnected,
      sdkRegistered: value.payload.sdkRegistered,
      remoteControllerConnected: value.payload.remoteControllerConnected,
      flightControllerConnected: value.payload.flightControllerConnected,
      connected: value.payload.connected,
    });
  } catch {
    return null;
  }
};
const blocker = (code: HardwareReadinessBlockerCode): HardwareReadinessBlocker => freeze({ code, message: messages[code] });
const result = (codes: readonly HardwareReadinessBlockerCode[]): HardwareReadinessResult => {
  const blockers = freeze(codes.map(blocker));
  return blockers.length === 0
    ? freeze({ ok: true as const, blockers: freeze([]) as readonly [] })
    : freeze({ ok: false as const, blockers });
};

export const HardwareReadiness = freeze({
  evaluate: (input: HardwareReadinessInput, target: HardwareReadinessTarget): HardwareReadinessResult => {
    const normalized = normalize(input);
    if (normalized === null || !validTarget(target)) return result(["INVALID_INPUT"]);
    const codes: HardwareReadinessBlockerCode[] = [];
    if (target === "legacy-video" && normalized.lanAddressAvailable !== true) codes.push("DESKTOP_NETWORK_UNAVAILABLE");
    if (target === "legacy-video" && normalized.legacyMediaAvailable !== true) codes.push("LEGACY_MEDIA_UNAVAILABLE");
    if (normalized.relayConnected !== true) codes.push("PHONE_DISCONNECTED");
    if (normalized.sdkRegistered !== true) codes.push("SDK_NOT_READY");
    // DJI 直播管理器的实际结果由异步回调确认；旧图传只要求能调用已就绪 MSDK。
    if (target === "flight-control") {
      if (normalized.remoteControllerConnected !== true) codes.push("REMOTE_CONTROLLER_DISCONNECTED");
      if (normalized.flightControllerConnected !== true) codes.push("FLIGHT_CONTROLLER_DISCONNECTED");
      if (normalized.connected !== true) codes.push("AIRCRAFT_DISCONNECTED");
    }
    return result(codes);
  },
});
