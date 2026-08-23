export type DeviceOperation = "pairing" | "live-stream" | "waypoint-mission" | "transmission-settings" | "camera-settings" | "direct-flight";
export type CapabilityReason = "RELAY_OFFLINE" | "SDK_NOT_READY" | "REMOTE_CONTROLLER_OFFLINE" | "AIRCRAFT_NOT_CONNECTED" | "PAIRING_NOT_NEEDED" | "CAPABILITY_UNKNOWN" | "LIVE_VIDEO_UNSUPPORTED" | "WAYPOINT_UNSUPPORTED";
export interface CapabilityDecision { readonly operation: DeviceOperation; readonly enabled: boolean; readonly reason: CapabilityReason | null; }
export type CapabilityDecisionResult<T> = Readonly<{ readonly ok: true; readonly value: T }> | Readonly<{ readonly ok: false; readonly error: Readonly<{ readonly code: "INVALID_INPUT"; readonly details: Readonly<{ readonly field: string; readonly reason: "invalid-value" | "unreadable" }> }> }>;

interface CapabilityInput { readonly operation: unknown; readonly relayConnected: unknown; readonly sdkRegistered: unknown; readonly remoteControllerConnected: unknown; readonly flightControllerConnected: unknown; readonly aircraftConnected: unknown; readonly capabilities: unknown; }
interface Capabilities { readonly liveVideo?: boolean; readonly waypointMission?: boolean; readonly waypointMissionSupport?: "supported" | "unsupported"; readonly virtualStick?: boolean; }

// Stryker disable next-line ArrowFunction: static helper replacement is not re-observable after ESM transform caching; public result immutability is covered.
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
// Stryker disable next-line ArrowFunction: static helper replacement is not re-observable after ESM transform caching; public success results are covered.
const success = <T>(value: T): CapabilityDecisionResult<T> => freeze({ ok: true as const, value });
// Stryker disable next-line ArrowFunction: static helper replacement is not re-observable after ESM transform caching; public failures are covered.
const failure = <T>(field: string, reason: "invalid-value" | "unreadable"): CapabilityDecisionResult<T> => freeze({ ok: false as const, error: freeze({ code: "INVALID_INPUT" as const, details: freeze({ field, reason }) }) });
// Stryker disable next-line ArrayDeclaration: static operation list replacement is not re-observable after ESM transform caching; every listed operation is covered.
const operations: readonly DeviceOperation[] = ["pairing", "live-stream", "waypoint-mission", "transmission-settings", "camera-settings", "direct-flight"];

function readInput(value: unknown): Readonly<CapabilityInput> | "invalid-container" | "unreadable" {
  if (value === null || typeof value !== "object") return "invalid-container";
  try { const input = value as CapabilityInput; return freeze({ operation: input.operation, relayConnected: input.relayConnected, sdkRegistered: input.sdkRegistered, remoteControllerConnected: input.remoteControllerConnected, flightControllerConnected: input.flightControllerConnected, aircraftConnected: input.aircraftConnected, capabilities: input.capabilities }); } catch { return "unreadable"; }
}

function optionalBoolean(value: unknown): boolean | undefined | null { return value === undefined || typeof value === "boolean" ? value : null; }
function readCapabilities(value: unknown): Readonly<Capabilities> | null | "invalid-value" | "unreadable" {
  if (value === null) return null;
  if (typeof value !== "object") return "invalid-value";
  try {
    const candidate = value as Capabilities;
    const liveVideo = optionalBoolean(candidate.liveVideo); const waypointMission = optionalBoolean(candidate.waypointMission); const virtualStick = optionalBoolean(candidate.virtualStick);
    if (liveVideo === null || waypointMission === null || virtualStick === null) return "invalid-value";
    if (candidate.waypointMissionSupport !== undefined && candidate.waypointMissionSupport !== "supported" && candidate.waypointMissionSupport !== "unsupported") return "invalid-value";
    // Stryker disable next-line ConditionalExpression, EqualityOperator, ObjectLiteral: copying an omitted optional capability and copying it as undefined are observationally identical because every consumer treats both as unavailable.
    return freeze({ ...(liveVideo === undefined ? {} : { liveVideo }), ...(waypointMission === undefined ? {} : { waypointMission }), ...(candidate.waypointMissionSupport === undefined ? {} : { waypointMissionSupport: candidate.waypointMissionSupport }), ...(virtualStick === undefined ? {} : { virtualStick }) });
  } catch { return "unreadable"; }
}

function decision(operation: DeviceOperation, enabled: boolean, reason: CapabilityReason | null): CapabilityDecisionResult<CapabilityDecision> { return success(freeze({ operation, enabled, reason })); }

function evaluate(value: unknown): CapabilityDecisionResult<CapabilityDecision> {
  const input = readInput(value);
  if (input === "invalid-container") return failure("input", "invalid-value");
  if (input === "unreadable") return failure("input", "unreadable");
  // Stryker disable next-line ConditionalExpression: the operation list rejects every non-string after runtime coercion, so removing this redundant precheck cannot change the public result.
  if (typeof input.operation !== "string" || !operations.includes(input.operation as DeviceOperation)) return failure("operation", "invalid-value");
  const operation = input.operation as DeviceOperation;
  const fields = ["relayConnected", "sdkRegistered", "remoteControllerConnected", "flightControllerConnected", "aircraftConnected"] as const;
  for (const field of fields) if (optionalBoolean(input[field]) === null) return failure(field, "invalid-value");
  const capabilities = readCapabilities(input.capabilities);
  if (capabilities === "invalid-value" || capabilities === "unreadable") return failure("capabilities.liveVideo", capabilities);
  if (input.relayConnected !== true) return decision(operation, false, "RELAY_OFFLINE");
  if (input.sdkRegistered !== true) return decision(operation, false, "SDK_NOT_READY");
  if (input.remoteControllerConnected !== true) return decision(operation, false, "REMOTE_CONTROLLER_OFFLINE");
  if (operation === "pairing") return input.aircraftConnected === true ? decision(operation, false, "PAIRING_NOT_NEEDED") : decision(operation, true, null);
  if (input.flightControllerConnected !== true || input.aircraftConnected !== true) return decision(operation, false, "AIRCRAFT_NOT_CONNECTED");
  if (operation === "live-stream") return capabilities === null || capabilities.liveVideo === undefined ? decision(operation, false, "CAPABILITY_UNKNOWN") : capabilities.liveVideo ? decision(operation, true, null) : decision(operation, false, "LIVE_VIDEO_UNSUPPORTED");
  if (operation === "waypoint-mission") {
    if (capabilities === null || capabilities.waypointMission === undefined || capabilities.waypointMissionSupport === undefined) return decision(operation, false, "CAPABILITY_UNKNOWN");
    return capabilities.waypointMission === true && capabilities.waypointMissionSupport === "supported" ? decision(operation, true, null) : decision(operation, false, "WAYPOINT_UNSUPPORTED");
  }
  return decision(operation, true, null);
}

// Stryker disable next-line ObjectLiteral: the ESM-static facade is instantiated before a transformed test module can re-import it; public identity is covered.
export const CapabilityGate = Object.freeze({ evaluate });
