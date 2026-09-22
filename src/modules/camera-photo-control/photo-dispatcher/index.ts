export type PhotoDispatchCode =
  | "SUCCEEDED"
  | "CAPTURED"
  | "OPERATION_IN_PROGRESS"
  | "NOTHING_TO_FETCH"
  | "RELAY_OFFLINE"
  | "SDK_NOT_READY"
  | "CAMERA_OFFLINE"
  | "CAMERA_CONNECTION_UNKNOWN"
  | "PHOTO_ACTION_REJECTED"
  | "RESULT_UNCONFIRMED"
  | "INVOCATION_FAILED"
  | "TRANSFER_FAILED"
  | "RELAY_REJECTED"
  | "DEPENDENCY_FAILURE"
  | "INVALID_INPUT"
  | "DISCONNECTED";

export type PhotoPhase = "idle" | "capturing" | "captured" | "fetching" | "stored" | "failed" | "disconnected";
export interface PhotoIdentity { readonly fileName: string; readonly index: number; }
export interface PhotoDispatchSnapshot {
  readonly deviceId: string;
  readonly phase: PhotoPhase;
  readonly fileName: string | null;
  readonly code: PhotoDispatchCode | null;
}
export interface PhotoPlatformError { readonly code: string; readonly description: string; }
export interface PhotoDispatchResult {
  readonly ok: boolean;
  readonly code: PhotoDispatchCode;
  readonly deviceId: string;
  readonly fileName?: string;
  readonly platformError?: PhotoPlatformError;
}
export interface PhotoRelay {
  readonly latestTelemetry: (deviceId: string) => unknown;
  readonly sendCommand: (deviceId: string, request: Readonly<{ readonly name: "camera.photo.capture" | "camera.photo.fetch"; readonly fields: Readonly<Record<string, never>> }>) => Promise<unknown>;
}
export interface PhotoDispatcherClock {
  readonly setTimeout: (callback: () => void, milliseconds: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}
export interface PhotoDispatcherInstance {
  capture(deviceId: string): Promise<PhotoDispatchResult>;
  fetch(deviceId: string): Promise<PhotoDispatchResult>;
  get(deviceId: string): PhotoDispatchSnapshot;
  recordDisconnected(deviceId: string): PhotoDispatchSnapshot | null;
  recordStored(deviceId: string, fileName: string, sha256: string): PhotoDispatchSnapshot | null;
  subscribe(listener: (snapshot: PhotoDispatchSnapshot) => void): () => void;
}

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
const empty = freeze({}) as Readonly<Record<string, never>>;
const attempt = <T>(run: () => T): Readonly<{ readonly ok: true; readonly value: T }> | Readonly<{ readonly ok: false }> => {
  try { return freeze({ ok: true as const, value: run() }); } catch { return freeze({ ok: false as const }); }
};
const attemptAsync = async <T>(run: () => Promise<T>): Promise<Readonly<{ readonly ok: true; readonly value: T }> | Readonly<{ readonly ok: false }>> => {
  try { return freeze({ ok: true as const, value: await run() }); } catch { return freeze({ ok: false as const }); }
};
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";
const idle = (deviceId: string): PhotoDispatchSnapshot => freeze({ deviceId, phase: "idle" as const, fileName: null, code: null });
const outcome = (ok: boolean, code: PhotoDispatchCode, deviceId: string, fileName?: string, extra: Partial<Pick<PhotoDispatchResult, "platformError">> = {}): PhotoDispatchResult =>
  freeze({ ok, code, deviceId, ...(fileName === undefined ? {} : { fileName }), ...extra });

const defaultClock: PhotoDispatcherClock = freeze({
  setTimeout: (callback: () => void, milliseconds: number): unknown => setTimeout(callback, milliseconds),
  clearTimeout: (handle: unknown): void => { clearTimeout(handle as ReturnType<typeof setTimeout>); },
});

function create(dependencies: Readonly<{ readonly relay: PhotoRelay; readonly clock?: PhotoDispatcherClock; readonly storedTimeoutMs?: number }>): PhotoDispatcherInstance {
  const clock = dependencies.clock ?? defaultClock;
  const storedTimeoutMs = typeof dependencies.storedTimeoutMs === "number" && Number.isFinite(dependencies.storedTimeoutMs) && dependencies.storedTimeoutMs > 0 ? dependencies.storedTimeoutMs : 15_000;
  const busy = new Set<string>();
  const identity = new Map<string, PhotoIdentity>();
  const snapshots = new Map<string, PhotoDispatchSnapshot>();
  const generations = new Map<string, number>();
  const listeners = new Set<(snapshot: PhotoDispatchSnapshot) => void>();
  const storedWaiters = new Map<string, (result: PhotoDispatchResult) => void>();
  const publish = (snapshot: PhotoDispatchSnapshot): void => {
    snapshots.set(snapshot.deviceId, snapshot);
    for (const listener of [...listeners]) { try { listener(snapshot); } catch { /* isolate */ } }
  };
  const release = (deviceId: string, result: PhotoDispatchResult): PhotoDispatchResult => {
    busy.delete(deviceId);
    const waiter = storedWaiters.get(deviceId);
    if (waiter !== undefined) {
      storedWaiters.delete(deviceId);
      waiter(result);
    }
    return result;
  };
  const reachability = (deviceId: string): PhotoDispatchCode | null => {
    const telemetryAttempt = attempt(() => dependencies.relay.latestTelemetry(deviceId));
    if (!telemetryAttempt.ok) return "DEPENDENCY_FAILURE";
    if (telemetryAttempt.value === null) return "RELAY_OFFLINE";
    const telemetry = telemetryAttempt.value;
    const payload = isRecord(telemetry) && isRecord(telemetry.payload) ? telemetry.payload : isRecord(telemetry) ? telemetry : null;
    if (payload === null) return "DEPENDENCY_FAILURE";
    const sdk = payload.sdkAvailability;
    if (sdk !== "READY") return "SDK_NOT_READY";
    const camera = payload.camera;
    if (camera === "DISCONNECTED") return "CAMERA_OFFLINE";
    if (camera !== "CONNECTED") return "CAMERA_CONNECTION_UNKNOWN";
    return null;
  };
  const dispatch = async (deviceId: string, name: "camera.photo.capture" | "camera.photo.fetch"): Promise<PhotoDispatchResult> => {
    if (!validId(deviceId)) return outcome(false, "INVALID_INPUT", typeof deviceId === "string" ? deviceId : "invalid");
    if (busy.has(deviceId)) return outcome(false, "OPERATION_IN_PROGRESS", deviceId);
    if (name === "camera.photo.fetch" && !identity.has(deviceId)) return outcome(false, "NOTHING_TO_FETCH", deviceId);
    const blocked = reachability(deviceId);
    if (blocked !== null) return outcome(false, blocked, deviceId);
    busy.add(deviceId);
    const generation = (generations.get(deviceId) ?? 0) + 1;
    generations.set(deviceId, generation);
    publish(freeze({ deviceId, phase: name === "camera.photo.capture" ? "capturing" as const : "fetching" as const, fileName: identity.get(deviceId)?.fileName ?? null, code: null }));
    const sent = await attemptAsync(() => dependencies.relay.sendCommand(deviceId, freeze({ name, fields: empty })));
    if (generations.get(deviceId) !== generation) return release(deviceId, outcome(false, "DISCONNECTED", deviceId));
    if (!sent.ok) return release(deviceId, finish(deviceId, false, "DEPENDENCY_FAILURE"));
    const status = isRecord(sent.value) && typeof sent.value.status === "string" ? sent.value.status : null;
    if (status === "timed-out" || status === "disconnected") return release(deviceId, finish(deviceId, false, "RESULT_UNCONFIRMED"));
    if (status === "succeeded") {
      if (name === "camera.photo.capture") {
        const captured = readCaptured(sent.value);
        if (captured === null) return release(deviceId, finish(deviceId, false, "DEPENDENCY_FAILURE"));
        identity.set(deviceId, captured);
        publish(freeze({ deviceId, phase: "captured" as const, fileName: captured.fileName, code: "CAPTURED" }));
        return release(deviceId, outcome(true, "CAPTURED", deviceId, captured.fileName));
      }
      const current = identity.get(deviceId);
      const snapshot = snapshots.get(deviceId);
      if (current !== undefined && snapshot?.phase === "stored" && snapshot.fileName === current.fileName) {
        return release(deviceId, outcome(true, "SUCCEEDED", deviceId, current.fileName));
      }
      return await new Promise<PhotoDispatchResult>((resolve) => {
        const timer = clock.setTimeout(() => {
          if (!storedWaiters.has(deviceId)) return;
          resolve(release(deviceId, finish(deviceId, false, "TRANSFER_FAILED", identity.get(deviceId)?.fileName ?? undefined)));
        }, storedTimeoutMs);
        storedWaiters.set(deviceId, (result) => {
          clock.clearTimeout(timer);
          resolve(generations.get(deviceId) === generation ? result : outcome(false, "DISCONNECTED", deviceId));
        });
      });
    }
    const terminal = readTerminal(sent.value);
    return release(deviceId, finish(deviceId, false, terminal?.code ?? "RELAY_REJECTED", undefined, terminal?.platformError === undefined ? {} : { platformError: terminal.platformError }));
  };
  const finish = (deviceId: string, ok: boolean, code: PhotoDispatchCode, fileName?: string, extra: Partial<Pick<PhotoDispatchResult, "platformError">> = {}): PhotoDispatchResult => {
    publish(freeze({ deviceId, phase: ok ? "stored" as const : "failed" as const, fileName: fileName ?? identity.get(deviceId)?.fileName ?? null, code }));
    return outcome(ok, code, deviceId, fileName, extra);
  };
  return freeze({
    capture: (deviceId) => dispatch(deviceId, "camera.photo.capture"),
    fetch: (deviceId) => dispatch(deviceId, "camera.photo.fetch"),
    get: (deviceId) => validId(deviceId) ? snapshots.get(deviceId) ?? idle(deviceId) : idle("invalid"),
    recordDisconnected: (deviceId) => {
      if (!validId(deviceId)) return null;
      generations.set(deviceId, (generations.get(deviceId) ?? 0) + 1);
      const snapshot = freeze({ deviceId, phase: "disconnected" as const, fileName: identity.get(deviceId)?.fileName ?? null, code: "DISCONNECTED" as const });
      publish(snapshot);
      release(deviceId, outcome(false, "DISCONNECTED", deviceId));
      return snapshot;
    },
    recordStored: (deviceId, fileName, sha256) => {
      if (!validId(deviceId) || typeof fileName !== "string" || typeof sha256 !== "string") return null;
      const current = identity.get(deviceId);
      if (current === undefined || current.fileName !== fileName) return snapshots.get(deviceId) ?? null;
      const waiting = snapshots.get(deviceId)?.phase === "fetching" || storedWaiters.has(deviceId);
      if (!waiting) return snapshots.get(deviceId) ?? null;
      const snapshot = freeze({ deviceId, phase: "stored" as const, fileName, code: "SUCCEEDED" as const });
      publish(snapshot);
      const waiter = storedWaiters.get(deviceId);
      if (waiter !== undefined) release(deviceId, outcome(true, "SUCCEEDED", deviceId, fileName));
      return snapshot;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      let active = true;
      return () => { if (active) { active = false; listeners.delete(listener); } };
    }
  });
}

function readCaptured(value: unknown): PhotoIdentity | null {
  const fields = resultFields(value);
  if (fields === null || text(fields, "domain") !== "photo" || text(fields, "outcome") !== "CAPTURED") return null;
  const fileName = text(fields, "fileName");
  const index = number(fields, "index");
  return fileName !== null && index !== null && index >= 0 ? freeze({ fileName, index }) : null;
}

function readTerminal(value: unknown): Readonly<{ readonly code: PhotoDispatchCode; readonly platformError?: PhotoPlatformError }> | null {
  const fields = resultFields(value);
  if (fields === null || text(fields, "domain") !== "photo") return null;
  const outcome = text(fields, "outcome");
  if (outcome === "RESULT_UNCONFIRMED") return freeze({ code: "RESULT_UNCONFIRMED" as const });
  if (outcome === "INVOCATION_FAILED") return freeze({ code: "INVOCATION_FAILED" as const });
  if (outcome === "TRANSFER_FAILED") return freeze({ code: "TRANSFER_FAILED" as const });
  if (outcome !== "ACTION_REJECTED") return null;
  const code = text(fields, "errorCode", 128);
  const description = text(fields, "errorDescription", 512);
  return freeze({
    code: "PHOTO_ACTION_REJECTED" as const,
    ...(code === null || description === null ? {} : { platformError: freeze({ code, description }) }),
  });
}

function resultFields(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !isRecord(value.result)) return null;
  const result = value.result;
  if (result.kind !== "object" || !isRecord(result.fields)) return null;
  return result.fields;
}

function text(fields: Record<string, unknown>, name: string, maxLength = 512): string | null {
  const field = fields[name];
  return isRecord(field) && field.kind === "string" && typeof field.value === "string" && field.value.trim().length > 0 && Array.from(field.value).length <= maxLength && !/[\p{Cc}]/u.test(field.value) ? field.value : null;
}

function number(fields: Record<string, unknown>, name: string): number | null {
  const field = fields[name];
  if (!isRecord(field) || field.kind !== "number" || typeof field.value !== "string") return null;
  const parsed = Number(field.value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export const PhotoDispatcher = freeze({ create });
