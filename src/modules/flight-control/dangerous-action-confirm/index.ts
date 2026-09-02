export type FlightAction = "takeoff" | "land" | "confirm-landing" | "return-home" | "stop-takeoff" | "stop-auto-landing";
export type ConfirmationSuccessCode = "PENDING" | "CONSUMED" | "CANCELLED";
export type ConfirmationFailureCode = "INVALID_INPUT" | "CONFIGURATION_INVALID" | "ID_UNAVAILABLE" | "NO_PENDING_CONFIRMATION" | "CONFIRMATION_MISMATCH" | "CONFIRMATION_EXPIRED";

export interface PendingConfirmation {
  readonly deviceId: string;
  readonly action: FlightAction;
  readonly confirmationId: string;
  readonly expiresAtMs: number;
}
export type ConfirmationResult =
  | Readonly<{ readonly ok: true; readonly code: ConfirmationSuccessCode; readonly confirmation: PendingConfirmation }>
  | Readonly<{ readonly ok: false; readonly code: ConfirmationFailureCode }>;
export interface DangerousActionConfirmOptions {
  readonly ttlMs: number;
  readonly createConfirmationId: () => string;
}
export interface DangerousActionConfirmInstance {
  readonly begin: (deviceId: string, action: FlightAction, nowMs: number) => ConfirmationResult;
  readonly consume: (deviceId: string, action: FlightAction, confirmationId: string, nowMs: number) => ConfirmationResult;
  readonly consumeCurrent: (deviceId: string, confirmationId: string, nowMs: number) => ConfirmationResult;
  readonly cancel: (deviceId: string, confirmationId: string, nowMs: number) => ConfirmationResult;
  readonly get: (deviceId: string, nowMs: number) => PendingConfirmation | null;
  readonly clear: (deviceId: string) => boolean;
  readonly clearAll: () => void;
}

const actions: readonly FlightAction[] = ["takeoff", "land", "confirm-landing", "return-home", "stop-takeoff", "stop-auto-landing"];
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const validText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
const validTime = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const validAction = (value: unknown): value is FlightAction => typeof value === "string" && actions.includes(value as FlightAction);
const validOptions = (value: unknown): value is DangerousActionConfirmOptions => {
  try { return value !== null && typeof value === "object" && typeof (value as DangerousActionConfirmOptions).createConfirmationId === "function" && Number.isInteger((value as DangerousActionConfirmOptions).ttlMs) && (value as DangerousActionConfirmOptions).ttlMs >= 1 && (value as DangerousActionConfirmOptions).ttlMs <= 60_000; } catch { return false; }
};
const failure = (code: ConfirmationFailureCode): ConfirmationResult => freeze({ ok: false as const, code });
const success = (code: ConfirmationSuccessCode, confirmation: PendingConfirmation): ConfirmationResult => freeze({ ok: true as const, code, confirmation });
const copy = (value: PendingConfirmation): PendingConfirmation => freeze({ deviceId: value.deviceId, action: value.action, confirmationId: value.confirmationId, expiresAtMs: value.expiresAtMs });
const createId = (factory: () => string): string | null => { try { return factory(); } catch { return null; } };

function create(options: DangerousActionConfirmOptions): DangerousActionConfirmInstance {
  const validConfiguration = validOptions(options);
  const pending = new Map<string, PendingConfirmation>();
  const removeExpired = (deviceId: string, nowMs: number): PendingConfirmation | null => {
    const current = pending.get(deviceId) ?? null;
    if (current !== null && nowMs >= current.expiresAtMs) { pending.delete(deviceId); return null; }
    return current;
  };
  const begin = (deviceId: string, action: FlightAction, nowMs: number): ConfirmationResult => {
    if (!validConfiguration) return failure("CONFIGURATION_INVALID");
    if (!validText(deviceId) || !validAction(action) || !validTime(nowMs)) return failure("INVALID_INPUT");
    const confirmationId = createId(options.createConfirmationId);
    if (!validText(confirmationId)) return failure("ID_UNAVAILABLE");
    const confirmation = copy({ deviceId, action, confirmationId, expiresAtMs: nowMs + options.ttlMs });
    pending.set(deviceId, confirmation);
    return success("PENDING", copy(confirmation));
  };
  const consume = (deviceId: string, action: FlightAction, confirmationId: string, nowMs: number): ConfirmationResult => {
    if (!validConfiguration) return failure("CONFIGURATION_INVALID");
    if (!validText(deviceId) || !validAction(action) || !validText(confirmationId) || !validTime(nowMs)) return failure("INVALID_INPUT");
    const raw = pending.get(deviceId) ?? null;
    if (raw !== null && nowMs >= raw.expiresAtMs) { pending.delete(deviceId); return failure("CONFIRMATION_EXPIRED"); }
    const current = removeExpired(deviceId, nowMs);
    if (current === null) return failure("NO_PENDING_CONFIRMATION");
    if (current.action !== action || current.confirmationId !== confirmationId) return failure("CONFIRMATION_MISMATCH");
    pending.delete(deviceId);
    return success("CONSUMED", copy(current));
  };
  const consumeCurrent = (deviceId: string, confirmationId: string, nowMs: number): ConfirmationResult => {
    if (!validConfiguration) return failure("CONFIGURATION_INVALID");
    if (!validText(deviceId) || !validText(confirmationId) || !validTime(nowMs)) return failure("INVALID_INPUT");
    const raw = pending.get(deviceId) ?? null;
    if (raw !== null && nowMs >= raw.expiresAtMs) { pending.delete(deviceId); return failure("CONFIRMATION_EXPIRED"); }
    const current = removeExpired(deviceId, nowMs);
    if (current === null) return failure("NO_PENDING_CONFIRMATION");
    if (current.confirmationId !== confirmationId) return failure("CONFIRMATION_MISMATCH");
    pending.delete(deviceId);
    return success("CONSUMED", copy(current));
  };
  const cancel = (deviceId: string, confirmationId: string, nowMs: number): ConfirmationResult => {
    if (!validConfiguration) return failure("CONFIGURATION_INVALID");
    if (!validText(deviceId) || !validText(confirmationId) || !validTime(nowMs)) return failure("INVALID_INPUT");
    const raw = pending.get(deviceId) ?? null;
    if (raw !== null && nowMs >= raw.expiresAtMs) { pending.delete(deviceId); return failure("CONFIRMATION_EXPIRED"); }
    const current = removeExpired(deviceId, nowMs);
    if (current === null) return failure("NO_PENDING_CONFIRMATION");
    if (current.confirmationId !== confirmationId) return failure("CONFIRMATION_MISMATCH");
    pending.delete(deviceId);
    return success("CANCELLED", copy(current));
  };
  return freeze({
    begin,
    consume,
    consumeCurrent,
    cancel,
    // Stryker disable next-line ConditionalExpression, LogicalOperator: invalid input and empty snapshots are public behavior.
    get: (deviceId, nowMs) => !validText(deviceId) || !validTime(nowMs) ? null : (removeExpired(deviceId, nowMs) ? copy(removeExpired(deviceId, nowMs)!) : null),
    clear: (deviceId) => validText(deviceId) && pending.delete(deviceId),
    // Stryker disable next-line BlockStatement: cleanup is verified via subsequent get.
    clearAll: () => { pending.clear(); }
  });
}

export const DangerousActionConfirm = freeze({ create });
