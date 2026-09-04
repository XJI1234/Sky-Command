export type HardwareReadinessTarget = "legacy-video" | "flight-control";
type HardwareMsdkSdkAvailability = "STOPPED" | "STARTING" | "READY" | "FAILED" | "UNKNOWN";

export interface HardwareReadinessInput {
  readonly desktop: {
    readonly lanAddressAvailable: boolean;
    readonly legacyMediaAvailable: boolean;
  };
  readonly relayConnected: boolean;
  readonly payload: {
    readonly sdkAvailability?: HardwareMsdkSdkAvailability;
    readonly sdkRegistered?: boolean;
  };
}

export type HardwareReadinessBlockerCode =
  | "INVALID_INPUT"
  | "DESKTOP_NETWORK_UNAVAILABLE"
  | "LEGACY_MEDIA_UNAVAILABLE"
  | "PHONE_DISCONNECTED"
  | "SDK_NOT_READY";

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
});

interface NormalizedInput {
  readonly lanAddressAvailable: unknown;
  readonly legacyMediaAvailable: unknown;
  readonly relayConnected: unknown;
  readonly sdkAvailability: unknown;
  readonly sdkRegistered: unknown;
}

const validTarget = (value: unknown): value is HardwareReadinessTarget => value === "legacy-video" || value === "flight-control";
const normalize = (value: unknown): NormalizedInput | null => {
  try {
    if (!isRecord(value) || !isRecord(value.desktop) || !isRecord(value.payload)) return null;
    return freeze({
      lanAddressAvailable: value.desktop.lanAddressAvailable,
      legacyMediaAvailable: value.desktop.legacyMediaAvailable,
      relayConnected: value.relayConnected,
      sdkAvailability: value.payload.sdkAvailability,
      sdkRegistered: value.payload.sdkRegistered,
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
const validSdk = (value: unknown): value is HardwareMsdkSdkAvailability => value === "STOPPED" || value === "STARTING" || value === "READY" || value === "FAILED" || value === "UNKNOWN";

export const HardwareReadiness = freeze({
  evaluate: (input: HardwareReadinessInput, target: HardwareReadinessTarget): HardwareReadinessResult => {
    const normalized = normalize(input);
    if (normalized === null || !validTarget(target)) return result(["INVALID_INPUT"]);
    const codes: HardwareReadinessBlockerCode[] = [];
    if (target === "legacy-video" && normalized.lanAddressAvailable !== true) codes.push("DESKTOP_NETWORK_UNAVAILABLE");
    if (target === "legacy-video" && normalized.legacyMediaAvailable !== true) codes.push("LEGACY_MEDIA_UNAVAILABLE");
    // The legacy-video target owns only desktop ingest prerequisites. Relay/MSDK and
    // DJI video-source facts are evaluated by StreamDispatcher's live capability gate.
    if (target === "flight-control") {
      if (normalized.relayConnected !== true) codes.push("PHONE_DISCONNECTED");
      const sdkReady = normalized.sdkAvailability === undefined ? normalized.sdkRegistered === true : validSdk(normalized.sdkAvailability) && normalized.sdkAvailability === "READY";
      if (!sdkReady) codes.push("SDK_NOT_READY");
    }
    // Direct flight uses the same invocation boundary. DJI Action callbacks decide hardware safety.
    return result(codes);
  },
});
