export type MissionPreflightPhase =
  | "idle"
  | "staging"
  | "staged"
  | "uploading"
  | "uploaded"
  | "starting"
  | "running"
  | "pausing"
  | "paused"
  | "resuming"
  | "stopping"
  | "completed"
  | "failed"
  | "disconnected";
type PreflightMsdkSdkAvailability = "STOPPED" | "STARTING" | "READY" | "FAILED" | "UNKNOWN";
type PreflightMsdkLinkState = "CONNECTED" | "DISCONNECTED" | "UNKNOWN";

export interface PreflightInput {
  readonly relayConnected: boolean;
  readonly payload: {
    readonly sdkAvailability?: PreflightMsdkSdkAvailability;
    readonly remoteController?: PreflightMsdkLinkState;
    readonly flightController?: PreflightMsdkLinkState;
    readonly sdkRegistered?: boolean;
    readonly remoteControllerConnected?: boolean;
    readonly flightControllerConnected?: boolean;
    readonly isFlying?: boolean;
    readonly motorsOn?: boolean;
    readonly batteryPercent?: number;
  };
  readonly capabilities: {
    readonly waypointMission?: boolean;
    readonly waypointMissionSupport?: "supported" | "unsupported";
  };
  readonly missionPhase: MissionPreflightPhase;
}

/**
 * Retained source-compatibility option. The former battery threshold policy is
 * intentionally ignored: DJI MSDK owns device-safety validation after invocation.
 */
export interface PreflightPolicy {
  readonly minimumBatteryPercent: number;
}

export type FlightActionPreflightAction = "takeoff" | "land" | "confirm-landing" | "return-home" | "stop-takeoff" | "stop-auto-landing";
export interface FlightActionPreflightInput {
  readonly relayConnected: boolean;
  readonly payload: {
    readonly sdkAvailability?: PreflightMsdkSdkAvailability;
    readonly remoteController?: PreflightMsdkLinkState;
    readonly flightController?: PreflightMsdkLinkState;
    readonly sdkRegistered?: boolean;
    readonly remoteControllerConnected?: boolean;
    readonly flightControllerConnected?: boolean;
    readonly isFlying?: boolean;
    readonly motorsOn?: boolean;
    readonly batteryPercent?: number;
    readonly flightMode?: string;
    readonly landingConfirmationNeeded?: boolean;
  };
  readonly capabilities: object;
  readonly action: FlightActionPreflightAction;
}

export type PreflightBlockerCode =
  | "INVALID_INPUT"
  | "RELAY_DISCONNECTED"
  | "SDK_NOT_READY"
  | "MISSION_NOT_UPLOADED";

export interface PreflightBlocker {
  readonly code: PreflightBlockerCode;
  readonly message: string;
}

export type PreflightResult = Readonly<{ ok: true; blockers: readonly [] }> | Readonly<{ ok: false; blockers: readonly PreflightBlocker[] }>;

const messages: Readonly<Record<PreflightBlockerCode, string>> = Object.freeze({
  INVALID_INPUT: "Device status could not be read.",
  RELAY_DISCONNECTED: "The relay phone is disconnected.",
  SDK_NOT_READY: "The DJI SDK is not ready.",
  MISSION_NOT_UPLOADED: "The mission has not been uploaded to the aircraft.",
});

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";

interface NormalizedInput {
  readonly relayConnected: boolean;
  readonly sdkAvailability: unknown;
  readonly sdkRegistered: unknown;
  readonly missionPhase: unknown;
}

function normalize(input: unknown): NormalizedInput | null {
  try {
    if (!isRecord(input) || !isRecord(input.payload)) return null;
    return Object.freeze({
      relayConnected: input.relayConnected === true,
      sdkAvailability: input.payload.sdkAvailability,
      sdkRegistered: input.payload.sdkRegistered,
      missionPhase: input.missionPhase,
    });
  } catch {
    return null;
  }
}

const blocker = (code: PreflightBlockerCode): PreflightBlocker => Object.freeze({ code, message: messages[code] });
const result = (codes: readonly PreflightBlockerCode[]): PreflightResult => {
  const blockers = Object.freeze(codes.map(blocker));
  return blockers.length === 0 ? Object.freeze({ ok: true as const, blockers: Object.freeze([]) as readonly [] }) : Object.freeze({ ok: false as const, blockers });
};
const flightActions: readonly FlightActionPreflightAction[] = ["takeoff", "land", "confirm-landing", "return-home", "stop-takeoff", "stop-auto-landing"];
const flightActionOf = (value: unknown): FlightActionPreflightAction | null => {
  try {
    if (!isRecord(value) || typeof value.action !== "string") return null;
    return flightActions.includes(value.action as FlightActionPreflightAction) ? value.action as FlightActionPreflightAction : null;
  } catch {
    return null;
  }
};
const validSdk = (value: unknown): value is PreflightMsdkSdkAvailability => value === "STOPPED" || value === "STARTING" || value === "READY" || value === "FAILED" || value === "UNKNOWN";
const sdkReady = (input: NormalizedInput): boolean => input.sdkAvailability === undefined ? input.sdkRegistered === true : validSdk(input.sdkAvailability) && input.sdkAvailability === "READY";

function evaluate(input: PreflightInput, _policy?: PreflightPolicy): PreflightResult {
  const normalized = normalize(input);
  if (normalized === null) return result(["INVALID_INPUT"]);

  const codes: PreflightBlockerCode[] = [];
  if (!normalized.relayConnected) codes.push("RELAY_DISCONNECTED");
  if (!sdkReady(normalized)) codes.push("SDK_NOT_READY");
  if (
    normalized.missionPhase !== "uploaded"
    && normalized.missionPhase !== "starting"
    && normalized.missionPhase !== "pausing"
    && normalized.missionPhase !== "resuming"
  ) codes.push("MISSION_NOT_UPLOADED");
  return result(codes);
}

function evaluateUpload(input: PreflightInput, _policy?: PreflightPolicy): PreflightResult {
  const normalized = normalize(input);
  if (normalized === null) return result(["INVALID_INPUT"]);

  const codes: PreflightBlockerCode[] = [];
  if (!normalized.relayConnected) codes.push("RELAY_DISCONNECTED");
  if (!sdkReady(normalized)) codes.push("SDK_NOT_READY");
  return result(codes);
}

function evaluateFlightAction(input: FlightActionPreflightInput, _policy?: PreflightPolicy): PreflightResult {
  const normalized = normalize(input);
  const action = flightActionOf(input);
  if (normalized === null || action === null) return result(["INVALID_INPUT"]);

  const codes: PreflightBlockerCode[] = [];
  if (!normalized.relayConnected) codes.push("RELAY_DISCONNECTED");
  if (!sdkReady(normalized)) codes.push("SDK_NOT_READY");
  return result(codes);
}

export const PreflightCheck = Object.freeze({ evaluate, evaluateUpload, evaluateFlightAction });
