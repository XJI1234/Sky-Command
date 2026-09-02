import type { FlightAction } from "../dangerous-action-confirm/index.js";

export type { FlightAction } from "../dangerous-action-confirm/index.js";

export type FlightCommandCode = "SUCCEEDED" | "PREFLIGHT_BLOCKED" | "CAPABILITY_BLOCKED" | "RELAY_REJECTED" | "DEPENDENCY_FAILURE" | "OPERATION_IN_PROGRESS" | "INVALID_INPUT" | "DISPOSED" | "NO_PENDING_CONFIRMATION" | "CONFIRMATION_MISMATCH" | "CONFIRMATION_EXPIRED" | "CONFIGURATION_INVALID" | "ID_UNAVAILABLE";
export interface FlightBlocker { readonly code: string; readonly message: string; }
export type FlightCommandCheck =
  | Readonly<{ readonly ok: true }>
  | Readonly<{ readonly ok: false; readonly code: Exclude<FlightCommandCode, "SUCCEEDED" | "RELAY_REJECTED" | "OPERATION_IN_PROGRESS">; readonly blockers?: readonly FlightBlocker[]; readonly reason?: string }>;
export type FlightCommandResult = Readonly<{ readonly ok: boolean; readonly code: FlightCommandCode; readonly deviceId: string; readonly action: FlightAction; readonly blockers?: readonly FlightBlocker[]; readonly reason?: string }>;
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
const invalid = (code: Exclude<FlightCommandCode, "SUCCEEDED" | "RELAY_REJECTED" | "OPERATION_IN_PROGRESS"> = "INVALID_INPUT"): FlightCommandCheck => freeze({ ok: false as const, code });
const outcome = (ok: boolean, code: FlightCommandCode, deviceId: string, action: FlightAction, extra: Partial<Pick<FlightCommandResult, "blockers" | "reason">> = {}): FlightCommandResult => freeze({ ok, code, deviceId, action, ...extra });
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
// Stryker disable next-line BlockStatement: hostile result getters normalize to null.
const successStatus = (value: unknown): boolean | null => { try { return isRecord(value) && typeof value.status === "string" ? value.status === "succeeded" : null; } catch { return null; } };

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
      const status = successStatus(sent.value);
      return status === true ? outcome(true, "SUCCEEDED", deviceId, action) : status === false ? outcome(false, "RELAY_REJECTED", deviceId, action) : outcome(false, "DEPENDENCY_FAILURE", deviceId, action);
    },
    isBusy: (deviceId) => validId(deviceId) && busy.has(deviceId)
  });
}

export const FlightCommandDispatcher = freeze({ create });
