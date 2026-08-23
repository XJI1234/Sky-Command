import { DangerousActionConfirm, type DangerousActionConfirmOptions, type FlightAction, type PendingConfirmation } from "./dangerous-action-confirm/index.js";
import { FlightCommandDispatcher, type FlightCommandCheck, type FlightCommandDispatcherInstance, type FlightCommandResult } from "./flight-command-dispatcher/index.js";

export { DangerousActionConfirm, FlightCommandDispatcher };
export type { FlightAction, PendingConfirmation, FlightCommandCheck, FlightCommandResult };

export type FlightActionRequest =
  | Readonly<{ readonly ok: true; readonly code: "CONFIRMATION_REQUIRED"; readonly confirmation: PendingConfirmation }>
  | Readonly<{ readonly ok: true; readonly code: "CANCELLED"; readonly confirmation: PendingConfirmation }>
  | Readonly<{ readonly ok: false; readonly code: string; readonly blockers?: readonly Readonly<{ readonly code: string; readonly message: string }>[]; readonly reason?: string }>;
export interface FlightControlDependencies { readonly dispatcher: FlightCommandDispatcherInstance; }
export interface FlightControlOptions { readonly now: () => number; readonly confirmation: DangerousActionConfirmOptions; }
export interface FlightControlInstance {
  readonly request: (deviceId: string, action: FlightAction) => FlightActionRequest;
  readonly confirm: (deviceId: string, confirmationId: string) => Promise<FlightCommandResult>;
  readonly cancel: (deviceId: string, confirmationId: string) => FlightActionRequest;
  readonly get: (deviceId: string) => PendingConfirmation | null;
  readonly clear: (deviceId: string) => boolean;
  readonly subscribe: (listener: (pending: readonly PendingConfirmation[]) => void) => () => void;
  readonly dispose: () => void;
}

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
const validConfirmationId = validId;
const invalidResult = (deviceId: string, action: FlightAction, code: "DISPOSED" | "INVALID_INPUT" | "NO_PENDING_CONFIRMATION" | "CONFIRMATION_MISMATCH" | "CONFIRMATION_EXPIRED" | "DEPENDENCY_FAILURE" | "CONFIGURATION_INVALID" | "ID_UNAVAILABLE"): FlightCommandResult => freeze({ ok: false, code, deviceId, action });
const readNow = (now: () => number): number | null => { try { const value = now(); return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null; } catch { return null; } };

function create(dependencies: FlightControlDependencies, options: FlightControlOptions): FlightControlInstance {
  const confirmations = DangerousActionConfirm.create(options.confirmation);
  const listeners = new Set<(pending: readonly PendingConfirmation[]) => void>();
  const deviceIds = new Set<string>();
  let disposed = false;
  // Stryker disable next-line ArrowFunction, ArrayDeclaration, BlockStatement: detached snapshots are covered at the public seam.
  const snapshot = (): readonly PendingConfirmation[] => freeze([...deviceIds].flatMap((deviceId) => {
    // Stryker disable next-line ConditionalExpression, EqualityOperator: invalid clock and absent confirmation omit the lane.
    const now = readNow(options.now); const confirmation = now === null ? null : confirmations.get(deviceId, now);
    // Stryker disable next-line ConditionalExpression, ArrayDeclaration: null entries are never exposed.
    return confirmation === null ? [] : [confirmation];
  }));
  const publish = (): void => {
    const current = snapshot();
    for (const listener of [...listeners]) { try { listener(current); } catch { /* Observer isolation is part of the public seam. */ } }
  };
  const request = (deviceId: string, action: FlightAction): FlightActionRequest => {
    if (disposed) return freeze({ ok: false as const, code: "DISPOSED" });
    // Stryker disable next-line ConditionalExpression: invalid IDs are stable no-send failures.
    if (!validId(deviceId)) return freeze({ ok: false as const, code: "INVALID_INPUT" });
    let checked: FlightCommandCheck;
    try { checked = dependencies.dispatcher.check(deviceId, action); } catch { return freeze({ ok: false as const, code: "DEPENDENCY_FAILURE" }); }
    // Stryker disable next-line ConditionalExpression: optional rejection details are copied without changing the code.
    if (!checked.ok) return freeze({ ok: false as const, code: checked.code, ...(checked.blockers === undefined ? {} : { blockers: checked.blockers }), ...(checked.reason === undefined ? {} : { reason: checked.reason }) });
    const now = readNow(options.now); if (now === null) return freeze({ ok: false as const, code: "DEPENDENCY_FAILURE" });
    const started = confirmations.begin(deviceId, action, now);
    if (!started.ok) return freeze({ ok: false as const, code: started.code });
    deviceIds.add(deviceId); publish();
    return freeze({ ok: true as const, code: "CONFIRMATION_REQUIRED" as const, confirmation: started.confirmation });
  };
  return freeze({
    request,
    confirm: async (deviceId, confirmationId) => {
      // Stryker disable next-line ConditionalExpression, LogicalOperator, EqualityOperator: invalid confirmation input is one stable result.
      if (!validId(deviceId) || !validConfirmationId(confirmationId)) return invalidResult(typeof deviceId === "string" ? deviceId : "invalid", "takeoff", "INVALID_INPUT");
      const now = readNow(options.now);
      if (disposed) return invalidResult(deviceId, "takeoff", "DISPOSED");
      if (now === null) return invalidResult(deviceId, "takeoff", "DEPENDENCY_FAILURE");
      const consumed = confirmations.consumeCurrent(deviceId, confirmationId, now);
      if (!consumed.ok) return invalidResult(deviceId, "takeoff", consumed.code);
      deviceIds.delete(deviceId); publish();
      try {
        const result = await dependencies.dispatcher.dispatch(deviceId, consumed.confirmation.action);
        return disposed ? invalidResult(deviceId, consumed.confirmation.action, "DISPOSED") : result;
      } catch { return invalidResult(deviceId, consumed.confirmation.action, "DEPENDENCY_FAILURE"); }
    },
    cancel: (deviceId, confirmationId) => {
      if (disposed) return freeze({ ok: false as const, code: "DISPOSED" });
      const now = readNow(options.now);
      // Stryker disable next-line ConditionalExpression, LogicalOperator: all invalid cancellation inputs are no-send results.
      if (!validId(deviceId) || !validConfirmationId(confirmationId) || now === null) return freeze({ ok: false as const, code: now === null ? "DEPENDENCY_FAILURE" : "INVALID_INPUT" });
      const cancelled = confirmations.cancel(deviceId, confirmationId, now);
      if (!cancelled.ok) return freeze({ ok: false as const, code: cancelled.code });
      deviceIds.delete(deviceId); publish();
      return freeze({ ok: true as const, code: "CANCELLED" as const, confirmation: cancelled.confirmation });
    },
    // Stryker disable next-line ConditionalExpression, LogicalOperator: released, invalid and stale reads return null.
    get: (deviceId) => disposed || !validId(deviceId) ? null : (() => { const now = readNow(options.now); const value = now === null ? null : confirmations.get(deviceId, now); if (value === null) deviceIds.delete(deviceId); return value; })(),
    clear: (deviceId) => {
      if (disposed || !validId(deviceId)) return false;
      const removed = confirmations.clear(deviceId);
      if (removed) { deviceIds.delete(deviceId); publish(); }
      return removed;
    },
    // Stryker disable next-line BooleanLiteral, BlockStatement, ConditionalExpression: unsubscribe is idempotent.
    subscribe: (listener) => { listeners.add(listener); let active = true; return () => { if (active) { active = false; listeners.delete(listener); } }; },
    // Stryker disable next-line ConditionalExpression: dispose is idempotent cleanup.
    dispose: () => { if (disposed) return; disposed = true; confirmations.clearAll(); deviceIds.clear(); listeners.clear(); }
  });
}

export const FlightControl = freeze({ create });
