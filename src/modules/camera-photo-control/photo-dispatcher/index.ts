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
export interface PhotoManifestEntry { readonly fileName: string; readonly sha256: string; }
interface PhotoDelivery extends PhotoManifestEntry { readonly count: number; }
interface PhotoDispatchSession {
  busy: boolean;
  identity: PhotoIdentity | undefined;
  delivered: PhotoDelivery | undefined;
  received: Map<string, string>;
  snapshot: PhotoDispatchSnapshot | undefined;
  generation: number;
  storedWaiter: ((result: PhotoDispatchResult) => void) | undefined;
}
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
  readonly count?: number;
  readonly platformError?: PhotoPlatformError;
}
export interface PhotoRelay {
  readonly latestTelemetry: (deviceId: string) => unknown;
  readonly sendCommand: (deviceId: string, request: Readonly<{ readonly name: "camera.photo.capture" | "camera.photo.fetch"; readonly fields: Readonly<Record<string, never>> | Readonly<{ readonly knownPhotos: readonly PhotoManifestEntry[] }> }>) => Promise<unknown>;
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
const outcome = (ok: boolean, code: PhotoDispatchCode, deviceId: string, fileName?: string, extra: Partial<Pick<PhotoDispatchResult, "platformError" | "count">> = {}): PhotoDispatchResult =>
  freeze({ ok, code, deviceId, ...(fileName === undefined ? {} : { fileName }), ...extra });

const defaultClock: PhotoDispatcherClock = freeze({
  setTimeout: (callback: () => void, milliseconds: number): unknown => setTimeout(callback, milliseconds),
  clearTimeout: (handle: unknown): void => { clearTimeout(handle as ReturnType<typeof setTimeout>); },
});

function create(dependencies: Readonly<{ readonly relay: PhotoRelay; readonly knownPhotos?: (deviceId: string) => readonly PhotoManifestEntry[]; readonly clock?: PhotoDispatcherClock; readonly storedTimeoutMs?: number }>): PhotoDispatcherInstance {
  const clock = dependencies.clock ?? defaultClock;
  const storedTimeoutMs = typeof dependencies.storedTimeoutMs === "number" && Number.isFinite(dependencies.storedTimeoutMs) && dependencies.storedTimeoutMs > 0 ? dependencies.storedTimeoutMs : 15_000;
  const sessions = new Map<string, PhotoDispatchSession>();
  const listeners = new Set<(snapshot: PhotoDispatchSnapshot) => void>();
  const sessionFor = (deviceId: string): PhotoDispatchSession => {
    const current = sessions.get(deviceId);
    if (current !== undefined) return current;
    const created: PhotoDispatchSession = { busy: false, identity: undefined, delivered: undefined, received: new Map(), snapshot: undefined, generation: 0, storedWaiter: undefined };
    sessions.set(deviceId, created);
    return created;
  };
  const hasMatchingDelivery = (session: PhotoDispatchSession): boolean => {
    const { delivered, received } = session;
    return delivered !== undefined && received.get(delivered.fileName) === delivered.sha256;
  };
  const publish = (session: PhotoDispatchSession, snapshot: PhotoDispatchSnapshot): void => {
    session.snapshot = snapshot;
    for (const listener of [...listeners]) { try { listener(snapshot); } catch { /* isolate */ } }
  };
  const release = (session: PhotoDispatchSession, result: PhotoDispatchResult): PhotoDispatchResult => {
    session.busy = false;
    const waiter = session.storedWaiter;
    if (waiter !== undefined) {
      session.storedWaiter = undefined;
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
  const known = (deviceId: string): readonly PhotoManifestEntry[] => {
    if (dependencies.knownPhotos === undefined) return freeze([]);
    try {
      const entries = dependencies.knownPhotos(deviceId);
      if (!Array.isArray(entries) || entries.length > 256) return freeze([]);
      return freeze(entries.flatMap((entry) => validManifest(entry) ? [freeze({ fileName: entry.fileName, sha256: entry.sha256 })] : []));
    } catch { return freeze([]); }
  };
  const dispatch = async (deviceId: string, name: "camera.photo.capture" | "camera.photo.fetch"): Promise<PhotoDispatchResult> => {
    if (!validId(deviceId)) return outcome(false, "INVALID_INPUT", typeof deviceId === "string" ? deviceId : "invalid");
    const existing = sessions.get(deviceId);
    if (existing?.busy) return outcome(false, "OPERATION_IN_PROGRESS", deviceId);
    const blocked = reachability(deviceId);
    if (blocked !== null) return outcome(false, blocked, deviceId);
    const session = existing ?? sessionFor(deviceId);
    session.busy = true;
    session.generation += 1;
    if (name === "camera.photo.fetch") {
      session.delivered = undefined;
      session.received.clear();
    }
    const generation = session.generation;
    publish(session, freeze({ deviceId, phase: name === "camera.photo.capture" ? "capturing" as const : "fetching" as const, fileName: session.identity?.fileName ?? null, code: null }));
    const fields = name === "camera.photo.fetch" ? freeze({ knownPhotos: known(deviceId) }) : empty;
    const sent = await attemptAsync(() => dependencies.relay.sendCommand(deviceId, freeze({ name, fields })));
    if (session.generation !== generation) return release(session, outcome(false, "DISCONNECTED", deviceId));
    if (!sent.ok) return release(session, finish(deviceId, session, false, "DEPENDENCY_FAILURE"));
    const status = isRecord(sent.value) && typeof sent.value.status === "string" ? sent.value.status : null;
    if (status === "timed-out" || status === "disconnected") return release(session, finish(deviceId, session, false, "RESULT_UNCONFIRMED"));
    if (status === "succeeded") {
      if (name === "camera.photo.fetch" && text(resultFields(sent.value) ?? {}, "outcome") === "NONE") {
        return release(session, finish(deviceId, session, false, "NOTHING_TO_FETCH", undefined, { count: 0 }));
      }
      if (name === "camera.photo.capture") {
        const captured = readCaptured(sent.value);
        if (captured === null) return release(session, finish(deviceId, session, false, "DEPENDENCY_FAILURE"));
        session.identity = captured;
        session.delivered = undefined;
        session.received.clear();
        publish(session, freeze({ deviceId, phase: "captured" as const, fileName: captured.fileName, code: "CAPTURED" }));
        return release(session, outcome(true, "CAPTURED", deviceId, captured.fileName));
      }
      const confirmed = readDelivered(sent.value);
      if (confirmed === null) {
        return release(session, finish(deviceId, session, false, "DEPENDENCY_FAILURE"));
      }
      session.delivered = confirmed;
      session.identity = freeze({ fileName: confirmed.fileName, index: session.identity?.fileName === confirmed.fileName ? session.identity.index : 0 });
      if (hasMatchingDelivery(session)) return release(session, finish(deviceId, session, true, "SUCCEEDED", confirmed.fileName, { count: confirmed.count }));
      return await new Promise<PhotoDispatchResult>((resolve) => {
        const timer = clock.setTimeout(() => {
          if (session.storedWaiter === undefined) return;
          resolve(release(session, finish(deviceId, session, false, "TRANSFER_FAILED", session.identity?.fileName ?? undefined)));
        }, storedTimeoutMs);
        session.storedWaiter = (result) => {
          clock.clearTimeout(timer);
          resolve(session.generation === generation ? result : outcome(false, "DISCONNECTED", deviceId));
        };
      });
    }
    const terminal = readTerminal(sent.value);
    return release(session, finish(deviceId, session, false, terminal?.code ?? "RELAY_REJECTED", undefined, terminal?.platformError === undefined ? {} : { platformError: terminal.platformError }));
  };
  const finish = (deviceId: string, session: PhotoDispatchSession, ok: boolean, code: PhotoDispatchCode, fileName?: string, extra: Partial<Pick<PhotoDispatchResult, "platformError" | "count">> = {}): PhotoDispatchResult => {
    publish(session, freeze({ deviceId, phase: ok ? "stored" as const : "failed" as const, fileName: fileName ?? session.identity?.fileName ?? null, code }));
    return outcome(ok, code, deviceId, fileName, extra);
  };
  return freeze({
    capture: (deviceId) => dispatch(deviceId, "camera.photo.capture"),
    fetch: (deviceId) => dispatch(deviceId, "camera.photo.fetch"),
    get: (deviceId) => validId(deviceId) ? sessions.get(deviceId)?.snapshot ?? idle(deviceId) : idle("invalid"),
    recordDisconnected: (deviceId) => {
      if (!validId(deviceId)) return null;
      const session = sessionFor(deviceId);
      session.generation += 1;
      const snapshot = freeze({ deviceId, phase: "disconnected" as const, fileName: session.identity?.fileName ?? null, code: "DISCONNECTED" as const });
      publish(session, snapshot);
      release(session, outcome(false, "DISCONNECTED", deviceId));
      return snapshot;
    },
    recordStored: (deviceId, fileName, sha256) => {
      if (!validId(deviceId) || typeof fileName !== "string" || !validSha256(sha256)) return null;
      const session = sessions.get(deviceId);
      if (session === undefined) return null;
      const waiting = session.snapshot?.phase === "fetching" || session.storedWaiter !== undefined;
      if (!waiting) return session.snapshot ?? null;
      const expected = session.delivered?.fileName;
      if (expected !== undefined && expected !== fileName) return session.snapshot ?? null;
      session.received.set(fileName, sha256);
      if (!hasMatchingDelivery(session)) return session.snapshot ?? null;
      const count = session.delivered?.count ?? 1;
      const result = finish(deviceId, session, true, "SUCCEEDED", fileName, { count });
      if (session.storedWaiter !== undefined) release(session, result);
      return session.snapshot ?? freeze({ deviceId, phase: "stored" as const, fileName, code: "SUCCEEDED" as const });
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

function readDelivered(value: unknown): PhotoDelivery | null {
  const fields = resultFields(value);
  if (fields === null || text(fields, "domain") !== "photo" || text(fields, "outcome") !== "DELIVERED") return null;
  const fileName = text(fields, "fileName");
  const sha256 = text(fields, "sha256", 64);
  const count = number(fields, "count");
  return fileName !== null && sha256 !== null && validSha256(sha256) && count !== null && count > 0 ? freeze({ fileName, sha256, count }) : null;
}

function validManifest(value: unknown): value is PhotoManifestEntry {
  if (!isRecord(value)) return false;
  const fileName = value.fileName;
  const sha256 = value.sha256;
  return typeof fileName === "string" && fileName.trim().length > 0 && fileName.length <= 128 && !/[\\/]/u.test(fileName) && !fileName.includes("..") && !/[\p{Cc}]/u.test(fileName) && typeof sha256 === "string" && validSha256(sha256);
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

function validSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/u.test(value);
}

export const PhotoDispatcher = freeze({ create });
