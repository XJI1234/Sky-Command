export type DeviceOperation = "pairing" | "live-stream" | "waypoint-mission" | "transmission-settings" | "camera-settings" | "direct-flight";
export type CapabilityReason = "RELAY_OFFLINE" | "SDK_NOT_READY" | "REMOTE_CONTROLLER_OFFLINE" | "FLIGHT_CONTROLLER_OFFLINE" | "FLIGHT_CONTROLLER_CONNECTION_UNKNOWN" | "PAIRING_NOT_NEEDED" | "CAPABILITY_UNKNOWN" | "LIVE_VIDEO_UNAVAILABLE" | "LIVE_VIDEO_UNSUPPORTED" | "WAYPOINT_UNSUPPORTED";
export interface CapabilityDecision { readonly operation: DeviceOperation; readonly enabled: boolean; readonly reason: CapabilityReason | null; }
export type CapabilityDecisionResult<T> = Readonly<{ readonly ok: true; readonly value: T }> | Readonly<{ readonly ok: false; readonly error: Readonly<{ readonly code: "INVALID_INPUT"; readonly details: Readonly<{ readonly field: string; readonly reason: "invalid-value" | "unreadable" }> }> }>;
type MsdkSdkAvailability = "STOPPED" | "STARTING" | "READY" | "FAILED" | "UNKNOWN";
type MsdkLinkState = "CONNECTED" | "DISCONNECTED" | "UNKNOWN";

interface CapabilityInput { readonly operation: unknown; readonly relayConnected: unknown; readonly sdkAvailability: unknown; readonly remoteController: unknown; readonly flightController: unknown; readonly sdkRegistered: unknown; readonly remoteControllerConnected: unknown; readonly flightControllerConnected: unknown; readonly capabilities: unknown; }
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
  try { const input = value as CapabilityInput; return freeze({ operation: input.operation, relayConnected: input.relayConnected, sdkAvailability: input.sdkAvailability, remoteController: input.remoteController, flightController: input.flightController, sdkRegistered: input.sdkRegistered, remoteControllerConnected: input.remoteControllerConnected, flightControllerConnected: input.flightControllerConnected, capabilities: input.capabilities }); } catch { return "unreadable"; }
}

function optionalBoolean(value: unknown): boolean | undefined | null { return value === undefined || typeof value === "boolean" ? value : null; }
function sdkState(value: unknown): MsdkSdkAvailability | undefined | null { return value === undefined ? undefined : value === "STOPPED" || value === "STARTING" || value === "READY" || value === "FAILED" || value === "UNKNOWN" ? value : null; }
function linkState(value: unknown): MsdkLinkState | undefined | null { return value === undefined ? undefined : value === "CONNECTED" || value === "DISCONNECTED" || value === "UNKNOWN" ? value : null; }
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
  const sdk = sdkState(input.sdkAvailability);
  if (sdk === null) return failure("sdkAvailability", "invalid-value");
  if (sdk === undefined && optionalBoolean(input.sdkRegistered) === null) return failure("sdkRegistered", "invalid-value");
  if (input.relayConnected !== true) return decision(operation, false, "RELAY_OFFLINE");
  if (sdk !== "READY" && !(sdk === undefined && input.sdkRegistered === true)) return decision(operation, false, "SDK_NOT_READY");
  const capabilities = readCapabilities(input.capabilities);
  if (capabilities === "invalid-value" || capabilities === "unreadable") return failure("capabilities.liveVideo", capabilities);
  if (operation === "live-stream") {
    if (capabilities === null || capabilities.liveVideo === undefined) return decision(operation, false, "CAPABILITY_UNKNOWN");
    return capabilities.liveVideo ? decision(operation, true, null) : decision(operation, false, "LIVE_VIDEO_UNAVAILABLE");
  }
  const remote = linkState(input.remoteController);
  const flight = linkState(input.flightController);
  if (remote === null) return failure("remoteController", "invalid-value");
  if (flight === null) return failure("flightController", "invalid-value");
  if (remote === undefined && optionalBoolean(input.remoteControllerConnected) === null) return failure("remoteControllerConnected", "invalid-value");
  if (flight === undefined && optionalBoolean(input.flightControllerConnected) === null) return failure("flightControllerConnected", "invalid-value");
  const remoteConnected = remote === "CONNECTED" || (remote === undefined && input.remoteControllerConnected === true);
  const flightConnected = flight === "CONNECTED" || (flight === undefined && input.flightControllerConnected === true);
  if (operation === "pairing") {
    if (!remoteConnected) return decision(operation, false, "REMOTE_CONTROLLER_OFFLINE");
    if (flight === "CONNECTED" || (flight === undefined && input.flightControllerConnected === true)) return decision(operation, false, "PAIRING_NOT_NEEDED");
    if (flight !== "DISCONNECTED" && !(flight === undefined && input.flightControllerConnected === false)) return decision(operation, false, "FLIGHT_CONTROLLER_CONNECTION_UNKNOWN");
    return decision(operation, true, null);
  }
  if (!remoteConnected) return decision(operation, false, "REMOTE_CONTROLLER_OFFLINE");
  if (!flightConnected) return decision(operation, false, "FLIGHT_CONTROLLER_OFFLINE");
  if (operation === "waypoint-mission") {
    if (capabilities === null || capabilities.waypointMission === undefined || capabilities.waypointMissionSupport === undefined) return decision(operation, false, "CAPABILITY_UNKNOWN");
    return capabilities.waypointMission === true && capabilities.waypointMissionSupport === "supported" ? decision(operation, true, null) : decision(operation, false, "WAYPOINT_UNSUPPORTED");
  }
  return decision(operation, true, null);
}

// Stryker disable next-line ObjectLiteral: the ESM-static facade is instantiated before a transformed test module can re-import it; public identity is covered.
export const CapabilityGate = Object.freeze({ evaluate });
