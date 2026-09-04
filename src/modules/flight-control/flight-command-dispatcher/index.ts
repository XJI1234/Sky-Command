import type { FlightAction } from "../dangerous-action-confirm/index.js";

export type { FlightAction } from "../dangerous-action-confirm/index.js";

export type FlightCommandCode = "SUCCEEDED" | "PREFLIGHT_BLOCKED" | "CAPABILITY_BLOCKED" | "FLIGHT_ACTION_REJECTED" | "RESULT_UNCONFIRMED" | "FLIGHT_ACTION_INVOCATION_FAILED" | "RELAY_REJECTED" | "DEPENDENCY_FAILURE" | "OPERATION_IN_PROGRESS" | "INVALID_INPUT" | "DISPOSED" | "NO_PENDING_CONFIRMATION" | "CONFIRMATION_MISMATCH" | "CONFIRMATION_EXPIRED" | "CONFIGURATION_INVALID" | "ID_UNAVAILABLE";
export interface FlightBlocker { readonly code: string; readonly message: string; }
export interface FlightPlatformError { readonly code: string; readonly description: string; }
export type FlightCommandCheck =
  | Readonly<{ readonly ok: true }>
  | Readonly<{ readonly ok: false; readonly code: Exclude<FlightCommandCode, "SUCCEEDED" | "FLIGHT_ACTION_REJECTED" | "RESULT_UNCONFIRMED" | "FLIGHT_ACTION_INVOCATION_FAILED" | "RELAY_REJECTED" | "OPERATION_IN_PROGRESS">; readonly blockers?: readonly FlightBlocker[]; readonly reason?: string }>;
export type FlightCommandResult = Readonly<{ readonly ok: boolean; readonly code: FlightCommandCode; readonly deviceId: string; readonly action: FlightAction; readonly blockers?: readonly FlightBlocker[]; readonly reason?: string; readonly platformError?: FlightPlatformError }>;
export interface FlightRelay {
  readonly latestTelemetry: (deviceId: string) => unknown;
  readonly sendCommand: (deviceId: string, request: Readonly<{ readonly name: "flight.takeoff" | "flight.land" | "flight.confirm-landing" | "flight.return-home" | "flight.stop-takeoff" | "flight.stop-auto-landing"; readonly fields: Readonly<{ readonly confirm: true }> }>) => Promise<unknown>;
}
export interface FlightPreflight { readonly evaluateFlightAction: (input: unknown) => unknown; }
export interface FlightCapabilityGate { readonly evaluate: (input: unknown) => unknown; }
export interface FlightCommandDispatcherDependencies { readonly relay: FlightRelay; readonly preflight: FlightPreflight; readonly capabilityGate: FlightCapabilityGate; }
export interface FlightCommandDispatcherInstance { readonly check: (deviceId: string, action: FlightAction) => FlightCommandCheck; readonly dispatch: (deviceId: string, action: FlightAction) => Promise<FlightCommandResult>; readonly isBusy: (deviceId: string) => boolean; }

const actions: readonly FlightAction[] = ["takeoff", "land", "confirm-landing", "return-home", "stop-takeoff", "stop-auto-landing"];
const commands: Readonly<Record<FlightAction, "flight.takeoff" | "flight.land" | "flight.confirm-landing" | "flight.return-home" | "flight.stop-takeoff" | "flight.stop-auto-landing">> = Object.freeze({
  takeoff: "flight.takeoff",
  land: "flight.land",
  "confirm-landing": "flight.confirm-landing",
  "return-home": "flight.return-home",
  "stop-takeoff": "flight.stop-takeoff",
  "stop-auto-landing": "flight.stop-auto-landing",
});
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
const validAction = (value: unknown): value is FlightAction => typeof value === "string" && actions.includes(value as FlightAction);
const invalid = (code: Exclude<FlightCommandCode, "SUCCEEDED" | "FLIGHT_ACTION_REJECTED" | "RESULT_UNCONFIRMED" | "FLIGHT_ACTION_INVOCATION_FAILED" | "RELAY_REJECTED" | "OPERATION_IN_PROGRESS"> = "INVALID_INPUT"): FlightCommandCheck => freeze({ ok: false as const, code });
const outcome = (ok: boolean, code: FlightCommandCode, deviceId: string, action: FlightAction, extra: Partial<Pick<FlightCommandResult, "blockers" | "reason" | "platformError">> = {}): FlightCommandResult => freeze({ ok, code, deviceId, action, ...extra });
const attempt = <T>(run: () => T): Readonly<{ readonly ok: true; readonly value: T }> | Readonly<{ readonly ok: false }> => { try { return freeze({ ok: true as const, value: run() }); } catch { return freeze({ ok: false as const }); } };
const attemptAsync = async <T>(run: () => Promise<T>): Promise<Readonly<{ readonly ok: true; readonly value: T }> | Readonly<{ readonly ok: false }>> => {
  try { return freeze({ ok: true as const, value: await run() }); } catch { return freeze({ ok: false as const }); }
};
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";
const readBlockers = (value: unknown): readonly FlightBlocker[] | null => {
  if (!Array.isArray(value)) return null;
  try {
    const blockers = value.map((item) => isRecord(item) && typeof item.code === "string" && typeof item.message === "string" ? freeze({ code: item.code, message: item.message }) : null);
    return blockers.every((item): item is FlightBlocker => item !== null) ? freeze(blockers) : null;
  } catch { return null; }
};
const validText = (value: unknown, maxCodePoints: number): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= maxCodePoints && !/[\p{Cc}]/u.test(value);
type FlightTerminalResult =
  | Readonly<{ readonly outcome: "ACTION_REJECTED"; readonly platformError: FlightPlatformError }>
  | Readonly<{ readonly outcome: "RESULT_UNCONFIRMED" | "INVOCATION_FAILED" }>;
const readFlightTerminalResult = (value: unknown): FlightTerminalResult | null => {
  try {
    if (!isRecord(value) || !isRecord(value.result)) return null;
    const result = value.result;
    if (result.kind !== "object" || !isRecord(result.fields)) return null;
    const fields = result.fields;
    const readText = (name: string, maxCodePoints: number): string | null => {
      const field = fields[name];
      return isRecord(field) && field.kind === "string" && validText(field.value, maxCodePoints) ? field.value : null;
    };
    if (readText("domain", 32) !== "flight") return null;
    const terminal = readText("outcome", 64);
    if (terminal === "RESULT_UNCONFIRMED" || terminal === "INVOCATION_FAILED") return freeze({ outcome: terminal });
    if (terminal !== "ACTION_REJECTED") return null;
    const code = readText("errorCode", 128);
    const description = readText("errorDescription", 512);
    return code === null || description === null ? null : freeze({ outcome: "ACTION_REJECTED", platformError: freeze({ code, description }) });
  } catch { return null; }
};
// Stryker disable next-line BlockStatement: hostile result getters normalize to null.
const commandStatus = (value: unknown): string | null => { try { return isRecord(value) && typeof value.status === "string" ? value.status : null; } catch { return null; } };

function create(dependencies: FlightCommandDispatcherDependencies): FlightCommandDispatcherInstance {
  const busy = new Set<string>();
  const check = (deviceId: string, action: FlightAction): FlightCommandCheck => {
    if (!validId(deviceId) || !validAction(action)) return invalid();
    const telemetryAttempt = attempt(() => dependencies.relay.latestTelemetry(deviceId));
    // Stryker disable next-line ConditionalExpression: attempt failure is tested through relay fault.
    if (!telemetryAttempt.ok) return invalid("DEPENDENCY_FAILURE");
    const telemetry = telemetryAttempt.value;
    let payload: unknown = {};
    let capabilities: unknown = {};
    if (telemetry !== null) {
      const read = attempt(() => isRecord(telemetry) ? freeze({ payload: telemetry.payload, capabilities: telemetry.capabilities }) : null);
      if (!read.ok || read.value === null) return invalid("DEPENDENCY_FAILURE");
      payload = read.value.payload; capabilities = read.value.capabilities;
    }
    const safety = attempt(() => dependencies.preflight.evaluateFlightAction({ relayConnected: telemetry !== null, payload, capabilities, action }));
    // Stryker disable next-line LogicalOperator, ConditionalExpression: malformed safety values share one stable failure.
    if (!safety.ok || !isRecord(safety.value) || typeof safety.value.ok !== "boolean") return invalid("DEPENDENCY_FAILURE");
    const safetyValue = safety.value;
    if (safetyValue.ok !== true) {
      const blockersAttempt = attempt(() => readBlockers(safetyValue.blockers));
      if (!blockersAttempt.ok || blockersAttempt.value === null) return invalid("DEPENDENCY_FAILURE");
      return freeze({ ok: false as const, code: "PREFLIGHT_BLOCKED" as const, blockers: blockersAttempt.value });
    }
    if (action === "takeoff") {
      // Stryker disable next-line ObjectLiteral, ConditionalExpression, EqualityOperator: exact gate facts are asserted at the seam.
      const gate = attempt(() => {
        const facts: Record<string, unknown> = { operation: "direct-flight", relayConnected: telemetry !== null, capabilities };
        if (isRecord(payload)) {
          facts.sdkAvailability = payload.sdkAvailability;
          facts.remoteController = payload.remoteController;
          facts.flightController = payload.flightController;
          facts.sdkRegistered = payload.sdkRegistered;
          facts.remoteControllerConnected = payload.remoteControllerConnected;
          facts.flightControllerConnected = payload.flightControllerConnected;
          facts.landingConfirmationNeeded = payload.landingConfirmationNeeded;
        }
        return dependencies.capabilityGate.evaluate(facts);
      });
      // Stryker disable next-line LogicalOperator, ConditionalExpression: malformed gate values normalize identically.
      if (!gate.ok || !isRecord(gate.value) || gate.value.ok !== true || !isRecord(gate.value.value) || typeof gate.value.value.enabled !== "boolean") return invalid("DEPENDENCY_FAILURE");
      if (gate.value.value.enabled !== true) return freeze({ ok: false as const, code: "CAPABILITY_BLOCKED" as const, reason: typeof gate.value.value.reason === "string" ? gate.value.value.reason : "CAPABILITY_UNKNOWN" });
    }
    return freeze({ ok: true as const });
  };
  return freeze({
    check,
    dispatch: async (deviceId, action) => {
      // Stryker disable next-line ConditionalExpression: invalid pairs never reach dependencies.
      if (!validId(deviceId) || !validAction(action)) return outcome(false, "INVALID_INPUT", typeof deviceId === "string" ? deviceId : "invalid", validAction(action) ? action : "takeoff");
      if (busy.has(deviceId)) return outcome(false, "OPERATION_IN_PROGRESS", deviceId, action);
      const allowed = check(deviceId, action);
      // Stryker disable next-line ConditionalExpression: optional fields are copied defensively.
      if (!allowed.ok) return outcome(false, allowed.code, deviceId, action, { ...(allowed.blockers === undefined ? {} : { blockers: allowed.blockers }), ...(allowed.reason === undefined ? {} : { reason: allowed.reason }) });
      busy.add(deviceId);
      const sent = await attemptAsync(() => dependencies.relay.sendCommand(deviceId, freeze({ name: commands[action], fields: freeze({ confirm: true as const }) })));
      busy.delete(deviceId);
      if (!sent.ok) return outcome(false, "DEPENDENCY_FAILURE", deviceId, action);
      const status = commandStatus(sent.value);
      if (status === "succeeded") return outcome(true, "SUCCEEDED", deviceId, action);
      if (status === "timed-out" || status === "disconnected") return outcome(false, "RESULT_UNCONFIRMED", deviceId, action);
      if (status !== "rejected") return outcome(false, "DEPENDENCY_FAILURE", deviceId, action);
      const terminal = readFlightTerminalResult(sent.value);
      if (terminal?.outcome === "ACTION_REJECTED") return outcome(false, "FLIGHT_ACTION_REJECTED", deviceId, action, { platformError: terminal.platformError });
      if (terminal?.outcome === "RESULT_UNCONFIRMED") return outcome(false, "RESULT_UNCONFIRMED", deviceId, action);
      if (terminal?.outcome === "INVOCATION_FAILED") return outcome(false, "FLIGHT_ACTION_INVOCATION_FAILED", deviceId, action);
      return outcome(false, "RELAY_REJECTED", deviceId, action);
    },
    isBusy: (deviceId) => validId(deviceId) && busy.has(deviceId)
  });
}

export const FlightCommandDispatcher = freeze({ create });
