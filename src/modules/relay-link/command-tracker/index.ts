export interface TimerScheduler {
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface CommandBegin { readonly connectionId: string; readonly commandId: string; }
export interface CommandResolve { readonly connectionId: string; readonly commandId: string; readonly ok: boolean; readonly detail: string; readonly result?: JsonObject; }
export interface PendingCommand extends CommandBegin {}
export type CommandStatus = "succeeded" | "rejected" | "timed-out" | "disconnected";
export interface CommandOutcome extends CommandBegin { readonly status: CommandStatus; readonly detail: string; readonly result?: JsonObject; }
export type TrackerErrorCode = "INVALID_COMMAND" | "DUPLICATE_COMMAND" | "COMMAND_NOT_FOUND" | "STALE_CONNECTION";
export interface TrackerError { readonly code: TrackerErrorCode; readonly message: string; }
export type TrackerResult<T> = Readonly<{ readonly ok: true; readonly value: T }> | Readonly<{ readonly ok: false; readonly error: TrackerError }>;
export interface CommandTrackerOptions { readonly scheduler: TimerScheduler; readonly timeoutMs: number; }
export interface CommandTrackerInstance {
  begin(input: CommandBegin): TrackerResult<PendingCommand>;
  resolve(input: CommandResolve): TrackerResult<CommandOutcome>;
  cancelConnection(connectionId: string, reason: string): void;
  snapshot(): readonly PendingCommand[];
  subscribe(listener: (outcome: CommandOutcome) => void): () => void;
}

const error = (code: TrackerErrorCode, message: string): TrackerError => Object.freeze({ code, message });
const accepted = <T>(value: T): TrackerResult<T> => Object.freeze({ ok: true as const, value });
const rejected = <T = never>(code: TrackerErrorCode, message: string): TrackerResult<T> => Object.freeze({ ok: false as const, error: error(code, message) });
const validId = (value: string): boolean => value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
const validDetail = (value: string): boolean => Array.from(value).length <= 1024 && !/[\p{Cc}]/u.test(value);
const readIdentity = (input: unknown): readonly [unknown, unknown] | null => {
  try {
    const record = input as Record<string, unknown>;
    return Object.freeze([record.connectionId, record.commandId]);
  } catch { return null; }
};
const copyResult = (value: unknown): JsonObject | null | undefined => {
  if (value === undefined) return undefined;
  const normalized = validateJsonObject(value);
  if (!normalized.ok) return null;
  return normalized.value;
};
const readResolution = (input: Record<string, unknown>): Readonly<{ readonly ok: unknown; readonly detail: unknown; readonly result: unknown }> | null => {
  try { return Object.freeze({ ok: input.ok, detail: input.detail, result: input.result }); } catch { return null; }
};

function create(options: CommandTrackerOptions): CommandTrackerInstance {
  const pending = new Map<string, { readonly value: PendingCommand; readonly timer: unknown }>();
  let currentSnapshot: readonly PendingCommand[] = Object.freeze([]);
  const listeners = new Set<(outcome: CommandOutcome) => void>();
  const key = (connectionId: string, commandId: string): string => `${connectionId}\u0000${commandId}`;
  const publish = (outcome: CommandOutcome): void => { for (const listener of [...listeners]) { try { listener(outcome); } catch { /* listeners cannot affect completion */ } } };
  const rebuild = (): void => { currentSnapshot = Object.freeze([...pending.values()].map((entry) => entry.value)); };
  const finish = (value: PendingCommand, status: CommandStatus, detail: string, result?: JsonObject): CommandOutcome => {
    pending.delete(key(value.connectionId, value.commandId));
    rebuild();
    const outcome = Object.freeze({ ...value, status, detail, ...(result === undefined ? {} : { result }) });
    publish(outcome);
    return outcome;
  };
  const readBegin = (input: unknown): TrackerResult<CommandBegin> => {
    const fields = readIdentity(input);
    if (fields === null) return rejected("INVALID_COMMAND", "Command identity is invalid");
    const [connectionId, commandId] = fields;
    if (typeof connectionId !== "string" || typeof commandId !== "string") return rejected("INVALID_COMMAND", "Command identity is invalid");
    return validId(connectionId) && validId(commandId) ? accepted(Object.freeze({ connectionId, commandId })) : rejected("INVALID_COMMAND", "Command identity is invalid");
  };
  const begin = (input: CommandBegin): TrackerResult<PendingCommand> => {
    const checked = readBegin(input);
    if (!checked.ok) return checked;
    const identity = checked.value;
    if (pending.has(key(identity.connectionId, identity.commandId))) return rejected("DUPLICATE_COMMAND", "Command is already pending");
    const value = Object.freeze({ ...identity });
    const timer = options.scheduler.setTimeout(() => {
      const entry = pending.get(key(value.connectionId, value.commandId));
      if (entry?.value === value) finish(value, "timed-out", "Command timed out");
    }, options.timeoutMs);
    pending.set(key(value.connectionId, value.commandId), { value, timer });
    rebuild();
    return accepted(value);
  };
  const resolve = (input: CommandResolve): TrackerResult<CommandOutcome> => {
    const checked = readBegin(input);
    const raw = readResolution(input as unknown as Record<string, unknown>);
    if (!checked.ok || raw === null || typeof raw.ok !== "boolean" || typeof raw.detail !== "string") return rejected("INVALID_COMMAND", "Command result is invalid");
    const result = copyResult(raw.result);
    if (!validDetail(raw.detail) || result === null) return rejected("INVALID_COMMAND", "Command result is invalid");
    const identity = checked.value;
    const entry = pending.get(key(identity.connectionId, identity.commandId));
    if (!entry) {
      const stale = [...pending.values()].some((candidate) => candidate.value.commandId === identity.commandId);
      return rejected(stale ? "STALE_CONNECTION" : "COMMAND_NOT_FOUND", stale ? "Command belongs to another connection" : "Command is not pending");
    }
    options.scheduler.clearTimeout(entry.timer);
    return accepted(finish(entry.value, raw.ok ? "succeeded" : "rejected", raw.detail, result));
  };
  const cancelConnection = (connectionId: string, reason: string): void => {
    const detail = validDetail(reason) && reason.length > 0 ? reason : "Connection disconnected";
    for (const entry of [...pending.values()]) if (entry.value.connectionId === connectionId) { options.scheduler.clearTimeout(entry.timer); finish(entry.value, "disconnected", detail); }
  };
  return Object.freeze({
    begin,
    resolve,
    cancelConnection,
    snapshot: () => currentSnapshot,
    subscribe: (listener: (outcome: CommandOutcome) => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }
  });
}

export const CommandTracker = Object.freeze({ create });
import { validateJsonObject, type JsonObject } from "../protocol-core/index.js";
