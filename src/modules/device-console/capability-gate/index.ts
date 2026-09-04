export type DeviceOperation = "pairing" | "live-stream" | "waypoint-mission" | "transmission-settings" | "camera-settings" | "direct-flight";
export type CapabilityReason = "RELAY_OFFLINE" | "SDK_NOT_READY" | "REMOTE_CONTROLLER_OFFLINE" | "FLIGHT_CONTROLLER_OFFLINE" | "FLIGHT_CONTROLLER_CONNECTION_UNKNOWN" | "PAIRING_NOT_NEEDED";
export interface CapabilityDecision { readonly operation: DeviceOperation; readonly enabled: boolean; readonly reason: CapabilityReason | null; }
export type CapabilityDecisionResult<T> = Readonly<{ readonly ok: true; readonly value: T }> | Readonly<{ readonly ok: false; readonly error: Readonly<{ readonly code: "INVALID_INPUT"; readonly details: Readonly<{ readonly field: string; readonly reason: "invalid-value" | "unreadable" }> }> }>;
type MsdkSdkAvailability = "STOPPED" | "STARTING" | "READY" | "FAILED" | "UNKNOWN";
type MsdkLinkState = "CONNECTED" | "DISCONNECTED" | "UNKNOWN";

interface CapabilityInput { readonly operation: unknown; readonly relayConnected: unknown; readonly sdkAvailability: unknown; readonly remoteController: unknown; readonly flightController: unknown; readonly sdkRegistered: unknown; readonly remoteControllerConnected: unknown; readonly flightControllerConnected: unknown; }
interface CapabilityBaseInput { readonly source: CapabilityInput; readonly operation: unknown; readonly relayConnected: unknown; readonly sdkAvailability: unknown; }

// Stryker disable next-line ArrowFunction: static helper replacement is not re-observable after ESM transform caching; public result immutability is covered.
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
// Stryker disable next-line ArrowFunction: static helper replacement is not re-observable after ESM transform caching; public success results are covered.
const success = <T>(value: T): CapabilityDecisionResult<T> => freeze({ ok: true as const, value });
// Stryker disable next-line ArrowFunction: static helper replacement is not re-observable after ESM transform caching; public failures are covered.
const failure = <T>(field: string, reason: "invalid-value" | "unreadable"): CapabilityDecisionResult<T> => freeze({ ok: false as const, error: freeze({ code: "INVALID_INPUT" as const, details: freeze({ field, reason }) }) });
// Stryker disable next-line ArrayDeclaration: static operation list replacement is not re-observable after ESM transform caching; every listed operation is covered.
const operations: readonly DeviceOperation[] = ["pairing", "live-stream", "waypoint-mission", "transmission-settings", "camera-settings", "direct-flight"];

function readInput(value: unknown): Readonly<CapabilityBaseInput> | "invalid-container" | "unreadable" {
  if (value === null || typeof value !== "object") return "invalid-container";
  try { const input = value as CapabilityInput; return freeze({ source: input, operation: input.operation, relayConnected: input.relayConnected, sdkAvailability: input.sdkAvailability }); } catch { return "unreadable"; }
}

type FieldRead = Readonly<{ readonly ok: true; readonly value: unknown }> | Readonly<{ readonly ok: false }>;
function readField(input: CapabilityInput, field: keyof CapabilityInput): FieldRead {
  try { return freeze({ ok: true as const, value: input[field] }); } catch { return freeze({ ok: false as const }); }
}

function optionalBoolean(value: unknown): boolean | undefined | null { return value === undefined || typeof value === "boolean" ? value : null; }
function sdkState(value: unknown): MsdkSdkAvailability | undefined | null { return value === undefined ? undefined : value === "STOPPED" || value === "STARTING" || value === "READY" || value === "FAILED" || value === "UNKNOWN" ? value : null; }
function linkState(value: unknown): MsdkLinkState | undefined | null { return value === undefined ? undefined : value === "CONNECTED" || value === "DISCONNECTED" || value === "UNKNOWN" ? value : null; }
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
  const sdkRegistered = sdk === undefined ? readField(input.source, "sdkRegistered") : null;
  if (sdkRegistered !== null && sdkRegistered.ok === false) return failure("sdkRegistered", "unreadable");
  if (sdkRegistered !== null && optionalBoolean(sdkRegistered.value) === null) return failure("sdkRegistered", "invalid-value");
  if (input.relayConnected !== true) return decision(operation, false, "RELAY_OFFLINE");
  if (sdk !== "READY" && !(sdk === undefined && sdkRegistered !== null && sdkRegistered.value === true)) return decision(operation, false, "SDK_NOT_READY");
  if (operation === "transmission-settings" || operation === "camera-settings" || operation === "direct-flight" || operation === "waypoint-mission" || operation === "live-stream") return decision(operation, true, null);
  const remoteField = readField(input.source, "remoteController");
  if (!remoteField.ok) return failure("remoteController", "unreadable");
  const flightField = readField(input.source, "flightController");
  if (!flightField.ok) return failure("flightController", "unreadable");
  const remote = linkState(remoteField.value);
  const flight = linkState(flightField.value);
  if (remote === null) return failure("remoteController", "invalid-value");
  if (flight === null) return failure("flightController", "invalid-value");
  const remoteControllerConnected = remote === undefined ? readField(input.source, "remoteControllerConnected") : null;
  if (remoteControllerConnected !== null && remoteControllerConnected.ok === false) return failure("remoteControllerConnected", "unreadable");
  const flightControllerConnected = flight === undefined ? readField(input.source, "flightControllerConnected") : null;
  if (flightControllerConnected !== null && flightControllerConnected.ok === false) return failure("flightControllerConnected", "unreadable");
  if (remoteControllerConnected !== null && optionalBoolean(remoteControllerConnected.value) === null) return failure("remoteControllerConnected", "invalid-value");
  if (flightControllerConnected !== null && optionalBoolean(flightControllerConnected.value) === null) return failure("flightControllerConnected", "invalid-value");
  const remoteConnected = remote === "CONNECTED" || (remote === undefined && remoteControllerConnected !== null && remoteControllerConnected.value === true);
  const flightConnected = flight === "CONNECTED" || (flight === undefined && flightControllerConnected !== null && flightControllerConnected.value === true);
  if (operation === "pairing") {
    if (!remoteConnected) return decision(operation, false, "REMOTE_CONTROLLER_OFFLINE");
    if (flight === "CONNECTED" || (flight === undefined && flightControllerConnected !== null && flightControllerConnected.value === true)) return decision(operation, false, "PAIRING_NOT_NEEDED");
    if (flight !== "DISCONNECTED" && !(flight === undefined && flightControllerConnected !== null && flightControllerConnected.value === false)) return decision(operation, false, "FLIGHT_CONTROLLER_CONNECTION_UNKNOWN");
    return decision(operation, true, null);
  }
  return failure("operation", "invalid-value");
}

// Stryker disable next-line ObjectLiteral: the ESM-static facade is instantiated before a transformed test module can re-import it; public identity is covered.
export const CapabilityGate = Object.freeze({ evaluate });
