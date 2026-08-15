import { type JsonObject, validate } from "../protocol-core/index.js";

export interface TelemetryInput { readonly connectionId: string; readonly payload: JsonObject; readonly capabilities: JsonObject; }
export interface TelemetrySnapshot extends TelemetryInput {}
export interface TelemetryError { readonly code: "INVALID_TELEMETRY"; readonly message: string; }
export type TelemetryResult<T> = Readonly<{ readonly ok: true; readonly value: T }> | Readonly<{ readonly ok: false; readonly error: TelemetryError }>;
export interface TelemetryIntakeInstance {
  accept(input: TelemetryInput): TelemetryResult<TelemetrySnapshot>;
  get(connectionId: string): TelemetrySnapshot | null;
  removeConnection(connectionId: string): void;
  snapshot(): readonly TelemetrySnapshot[];
  subscribe(listener: (snapshot: TelemetrySnapshot) => void): () => void;
}

const invalid = <T = never>(): TelemetryResult<T> => Object.freeze({ ok: false as const, error: Object.freeze({ code: "INVALID_TELEMETRY" as const, message: "Telemetry is invalid" }) });
const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);

function create(): TelemetryIntakeInstance {
  let current: readonly TelemetrySnapshot[] = Object.freeze([]);
  const listeners = new Set<(snapshot: TelemetrySnapshot) => void>();
  const publish = (value: TelemetrySnapshot): void => { for (const listener of [...listeners]) { try { listener(value); } catch { /* listener isolation is intentional */ } } };
  const accept = (input: TelemetryInput): TelemetryResult<TelemetrySnapshot> => {
    let connectionId: unknown, payload: unknown, capabilities: unknown;
    try { connectionId = (input as unknown as Record<string, unknown>).connectionId; payload = (input as unknown as Record<string, unknown>).payload; capabilities = (input as unknown as Record<string, unknown>).capabilities; }
    catch { return invalid(); }
    if (!validId(connectionId)) return invalid();
    const checked = validate({ type: "telemetry", payload: payload as JsonObject, capabilities: capabilities as JsonObject });
    if (!checked.ok || checked.value.type !== "telemetry") return invalid();
    const value = Object.freeze({ connectionId, payload: checked.value.payload, capabilities: checked.value.capabilities });
    const index = current.findIndex((snapshot) => snapshot.connectionId === connectionId);
    current = Object.freeze(index < 0 ? [...current, value] : [...current.slice(0, index), value, ...current.slice(index + 1)]);
    publish(value);
    return Object.freeze({ ok: true as const, value });
  };
  return Object.freeze({
    accept,
    get: (connectionId: string) => validId(connectionId) ? current.find((snapshot) => snapshot.connectionId === connectionId) ?? null : null,
    removeConnection: (connectionId: string) => {
      if (!validId(connectionId)) return;
      const index = current.findIndex((snapshot) => snapshot.connectionId === connectionId);
      if (index >= 0) current = Object.freeze([...current.slice(0, index), ...current.slice(index + 1)]);
    },
    snapshot: () => current,
    subscribe: (listener: (snapshot: TelemetrySnapshot) => void): (() => void) => { listeners.add(listener); let active = true; return () => { if (active) { active = false; listeners.delete(listener); } }; }
  });
}

export const TelemetryIntake = Object.freeze({ create });
