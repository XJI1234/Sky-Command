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

export interface PreflightInput {
  readonly relayConnected: boolean;
  readonly payload: {
    readonly sdkRegistered?: boolean;
    readonly remoteControllerConnected?: boolean;
    readonly flightControllerConnected?: boolean;
    readonly connected?: boolean;
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

export interface PreflightPolicy {
  readonly minimumBatteryPercent: number;
}

export type FlightActionPreflightAction = "takeoff" | "land" | "return-home";
export interface FlightActionPreflightInput {
  readonly relayConnected: boolean;
  readonly payload: {
    readonly sdkRegistered?: boolean;
    readonly remoteControllerConnected?: boolean;
    readonly flightControllerConnected?: boolean;
    readonly connected?: boolean;
    readonly isFlying?: boolean;
    readonly motorsOn?: boolean;
    readonly batteryPercent?: number;
  };
  readonly capabilities: object;
  readonly action: FlightActionPreflightAction;
}

export type PreflightBlockerCode =
  | "INVALID_INPUT"
  | "INVALID_POLICY"
  | "RELAY_DISCONNECTED"
  | "SDK_NOT_READY"
  | "REMOTE_CONTROLLER_DISCONNECTED"
  | "AIRCRAFT_DISCONNECTED"
  | "WAYPOINT_UNSUPPORTED"
  | "MISSION_NOT_UPLOADED"
  | "BATTERY_UNKNOWN"
  | "BATTERY_LOW"
  | "FLIGHT_STATE_UNKNOWN"
  | "AIRCRAFT_ALREADY_FLYING"
  | "MOTOR_STATE_UNKNOWN"
  | "MOTORS_RUNNING"
  | "AIRCRAFT_ON_GROUND";

export interface PreflightBlocker {
  readonly code: PreflightBlockerCode;
  readonly message: string;
}

export type PreflightResult = Readonly<{ ok: true; blockers: readonly [] }> | Readonly<{ ok: false; blockers: readonly PreflightBlocker[] }>;

const DEFAULT_POLICY: PreflightPolicy = Object.freeze({ minimumBatteryPercent: 20 });
const messages: Readonly<Record<PreflightBlockerCode, string>> = Object.freeze({
  INVALID_INPUT: "Device status could not be read.",
  INVALID_POLICY: "Preflight policy is invalid.",
  RELAY_DISCONNECTED: "The relay phone is disconnected.",
  SDK_NOT_READY: "The DJI SDK is not ready.",
  REMOTE_CONTROLLER_DISCONNECTED: "The remote controller is disconnected.",
  AIRCRAFT_DISCONNECTED: "The aircraft is disconnected.",
  WAYPOINT_UNSUPPORTED: "This aircraft does not support waypoint missions.",
  MISSION_NOT_UPLOADED: "The mission has not been uploaded to the aircraft.",
  BATTERY_UNKNOWN: "Aircraft battery level is unknown.",
  BATTERY_LOW: "Aircraft battery level is below the required minimum.",
  FLIGHT_STATE_UNKNOWN: "Aircraft flight state is unknown.",
  AIRCRAFT_ALREADY_FLYING: "The aircraft is already flying.",
  MOTOR_STATE_UNKNOWN: "Aircraft motor state is unknown.",
  MOTORS_RUNNING: "Aircraft motors are running.",
  AIRCRAFT_ON_GROUND: "The aircraft is already on the ground."
});

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";
const validPolicy = (value: unknown): value is PreflightPolicy => {
  try {
    if (!isRecord(value)) return false;
    const minimum = value.minimumBatteryPercent;
    return typeof minimum === "number" && Number.isInteger(minimum) && minimum >= 1 && minimum <= 100;
  } catch {
    return false;
  }
};

interface NormalizedInput {
  readonly relayConnected: boolean;
  readonly sdkRegistered: unknown;
  readonly remoteControllerConnected: unknown;
  readonly flightControllerConnected: unknown;
  readonly connected: unknown;
  readonly waypointMission: unknown;
  readonly waypointMissionSupport: unknown;
  readonly missionPhase: unknown;
  readonly batteryPercent: unknown;
  readonly isFlying: unknown;
  readonly motorsOn: unknown;
}

function normalize(input: unknown): NormalizedInput | null {
  try {
    if (!isRecord(input) || !isRecord(input.payload) || !isRecord(input.capabilities)) return null;
    return Object.freeze({
      relayConnected: input.relayConnected === true,
      sdkRegistered: input.payload.sdkRegistered,
      remoteControllerConnected: input.payload.remoteControllerConnected,
      flightControllerConnected: input.payload.flightControllerConnected,
      connected: input.payload.connected,
      waypointMission: input.capabilities.waypointMission,
      waypointMissionSupport: input.capabilities.waypointMissionSupport,
      missionPhase: input.missionPhase,
      batteryPercent: input.payload.batteryPercent,
      isFlying: input.payload.isFlying,
      motorsOn: input.payload.motorsOn
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
const flightActions: readonly FlightActionPreflightAction[] = ["takeoff", "land", "return-home"];
const flightActionOf = (value: unknown): FlightActionPreflightAction | null => {
  try {
    if (!isRecord(value) || typeof value.action !== "string") return null;
    return flightActions.includes(value.action as FlightActionPreflightAction) ? value.action as FlightActionPreflightAction : null;
  } catch {
    return null;
  }
};

function evaluate(input: PreflightInput, policy: PreflightPolicy = DEFAULT_POLICY): PreflightResult {
  const normalized = normalize(input);
  if (normalized === null) return result(["INVALID_INPUT"]);
  if (!validPolicy(policy)) return result(["INVALID_POLICY"]);

  const codes: PreflightBlockerCode[] = [];
  if (!normalized.relayConnected) codes.push("RELAY_DISCONNECTED");
  if (normalized.sdkRegistered !== true) codes.push("SDK_NOT_READY");
  if (normalized.remoteControllerConnected !== true) codes.push("REMOTE_CONTROLLER_DISCONNECTED");
  if (normalized.flightControllerConnected !== true || normalized.connected !== true) codes.push("AIRCRAFT_DISCONNECTED");
  if (normalized.waypointMission !== true || normalized.waypointMissionSupport !== "supported") codes.push("WAYPOINT_UNSUPPORTED");
  if (normalized.missionPhase !== "uploaded") codes.push("MISSION_NOT_UPLOADED");
  const battery = normalized.batteryPercent;
  if (typeof battery !== "number" || !Number.isFinite(battery) || battery < 0 || battery > 100) codes.push("BATTERY_UNKNOWN");
  else if (battery < policy.minimumBatteryPercent) codes.push("BATTERY_LOW");
  if (normalized.isFlying !== false && normalized.isFlying !== true) codes.push("FLIGHT_STATE_UNKNOWN");
  else if (normalized.isFlying) codes.push("AIRCRAFT_ALREADY_FLYING");
  if (normalized.motorsOn !== false && normalized.motorsOn !== true) codes.push("MOTOR_STATE_UNKNOWN");
  else if (normalized.motorsOn) codes.push("MOTORS_RUNNING");
  return result(codes);
}

function evaluateUpload(input: PreflightInput): PreflightResult {
  const normalized = normalize(input);
  if (normalized === null) return result(["INVALID_INPUT"]);

  const codes: PreflightBlockerCode[] = [];
  if (!normalized.relayConnected) codes.push("RELAY_DISCONNECTED");
  if (normalized.sdkRegistered !== true) codes.push("SDK_NOT_READY");
  if (normalized.remoteControllerConnected !== true) codes.push("REMOTE_CONTROLLER_DISCONNECTED");
  if (normalized.flightControllerConnected !== true || normalized.connected !== true) codes.push("AIRCRAFT_DISCONNECTED");
  if (normalized.waypointMission !== true || normalized.waypointMissionSupport !== "supported") codes.push("WAYPOINT_UNSUPPORTED");
  return result(codes);
}

function evaluateFlightAction(input: FlightActionPreflightInput, policy: PreflightPolicy = DEFAULT_POLICY): PreflightResult {
  const normalized = normalize(input);
  const action = flightActionOf(input);
  if (normalized === null || action === null) return result(["INVALID_INPUT"]);
  if (!validPolicy(policy)) return result(["INVALID_POLICY"]);

  const codes: PreflightBlockerCode[] = [];
  if (!normalized.relayConnected) codes.push("RELAY_DISCONNECTED");
  if (normalized.sdkRegistered !== true) codes.push("SDK_NOT_READY");
  if (normalized.remoteControllerConnected !== true) codes.push("REMOTE_CONTROLLER_DISCONNECTED");
  if (normalized.flightControllerConnected !== true || normalized.connected !== true) codes.push("AIRCRAFT_DISCONNECTED");

  if (action === "takeoff") {
    const battery = normalized.batteryPercent;
    if (typeof battery !== "number" || !Number.isFinite(battery) || battery < 0 || battery > 100) codes.push("BATTERY_UNKNOWN");
    else if (battery < policy.minimumBatteryPercent) codes.push("BATTERY_LOW");
    if (normalized.isFlying !== false && normalized.isFlying !== true) codes.push("FLIGHT_STATE_UNKNOWN");
    else if (normalized.isFlying) codes.push("AIRCRAFT_ALREADY_FLYING");
    if (normalized.motorsOn !== false && normalized.motorsOn !== true) codes.push("MOTOR_STATE_UNKNOWN");
    else if (normalized.motorsOn) codes.push("MOTORS_RUNNING");
  } else if (normalized.isFlying !== true) {
    codes.push(normalized.isFlying === false ? "AIRCRAFT_ON_GROUND" : "FLIGHT_STATE_UNKNOWN");
  }
  return result(codes);
}

export const PreflightCheck = Object.freeze({ evaluate, evaluateUpload, evaluateFlightAction });
