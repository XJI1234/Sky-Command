export type WhipOperation = "start" | "stop";
export type WhipDispatchCode =
  | "INVALID_INPUT"
  | "WEBRTC_MEDIA_UNAVAILABLE"
  | "TARGET_INVALID"
  | "CAPABILITY_BLOCKED"
  | "OPERATION_IN_PROGRESS"
  | "RELAY_REJECTED"
  | "DEPENDENCY_FAILURE"
  | "DISCONNECTED"
  | "ILLEGAL_STATE";

export interface WhipDispatchSnapshot {
  readonly deviceId: string;
  readonly phase: "idle" | "starting" | "streaming" | "stopping" | "failed" | "disconnected";
  readonly lastOperation: WhipOperation | null;
  readonly failureCode: WhipDispatchCode | null;
  readonly reason: string | null;
}

export type WhipDispatchCheck =
  | Readonly<{ readonly ok: true }>
  | Readonly<{ readonly ok: false; readonly code: Exclude<WhipDispatchCode, "OPERATION_IN_PROGRESS" | "RELAY_REJECTED" | "DISCONNECTED" | "ILLEGAL_STATE">; readonly reason?: string }>;

export type WhipDispatchResult =
  | Readonly<{ readonly ok: true; readonly operation: WhipOperation; readonly state: WhipDispatchSnapshot }>
  | Readonly<{ readonly ok: false; readonly operation: WhipOperation; readonly code: WhipDispatchCode; readonly state: WhipDispatchSnapshot | null; readonly reason?: string }>;

export interface WhipStreamControlDependencies {
  readonly media: {
    readonly snapshot: () => unknown;
    readonly publishTarget: (deviceId: string) => unknown;
  };
  readonly relay: {
    readonly latestTelemetry: (deviceId: string) => unknown;
    readonly sendCommand: (
      deviceId: string,
      request: Readonly<{
        readonly name: "live-stream-webrtc.start" | "live-stream-webrtc.stop";
        readonly fields: Readonly<Record<string, string>>;
      }>
    ) => Promise<unknown>;
  };
  readonly capabilityGate: { readonly evaluate: (input: unknown) => unknown };
}

export interface WhipStreamControlInstance {
  readonly check: (deviceId: string) => WhipDispatchCheck;
  readonly start: (deviceId: string) => Promise<WhipDispatchResult>;
  readonly stop: (deviceId: string) => Promise<WhipDispatchResult>;
  readonly get: (deviceId: string) => WhipDispatchSnapshot;
  readonly list: () => readonly WhipDispatchSnapshot[];
  readonly recordDisconnected: (deviceId: string) => WhipDispatchSnapshot | null;
  readonly forget: (deviceId: string) => boolean;
  readonly subscribe: (listener: (snapshots: readonly WhipDispatchSnapshot[]) => void) => () => void;
}

type Lane = {
  phase: WhipDispatchSnapshot["phase"];
  busy: boolean;
  lastOperation: WhipOperation | null;
  failureCode: WhipDispatchCode | null;
  reason: string | null;
};

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
const empty = (deviceId: string): WhipDispatchSnapshot => freeze({ deviceId, phase: "idle", lastOperation: null, failureCode: null, reason: null });
const attempt = <T>(action: () => T): Readonly<{ readonly ok: true; readonly value: T }> | Readonly<{ readonly ok: false }> => {
  try { return freeze({ ok: true as const, value: action() }); } catch { return freeze({ ok: false as const }); }
};
const attemptAsync = async <T>(action: () => Promise<T>): Promise<Readonly<{ readonly ok: true; readonly value: T }> | Readonly<{ readonly ok: false }>> => {
  try { return freeze({ ok: true as const, value: await action() }); } catch { return freeze({ ok: false as const }); }
};

function safeReason(value: unknown): string {
  return typeof value === "string" && value.length <= 64 && !/[\p{Cc}]/u.test(value) ? value : "CAPABILITY_UNKNOWN";
}

function relayRejectionReason(value: unknown): string | null {
  if (value === "Another video transport is active") return "ANOTHER_VIDEO_TRANSPORT_ACTIVE";
  if (value === "WHIP stream failed" || value === "WHIP stream operation was rejected") return "VIDEO_TRANSPORT_FAILED";
  if (value === "Video transport is unavailable") return "VIDEO_TRANSPORT_UNAVAILABLE";
  return null;
}

function validPrivateIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^(?:0|[1-9]\d{0,2})$/u.test(part))) return false;
  const numbers = parts.map(Number);
  if (!numbers.every((part) => part >= 0 && part <= 255)) return false;
  const [first, second] = numbers as [number, number, number, number];
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

function validWhipTarget(value: unknown, deviceId: string): boolean {
  if (!record(value) || value.ok !== true || !record(value.value)) return false;
  const target = value.value;
  if (target.kind !== "whip" || target.deviceId !== deviceId || typeof target.url !== "string") return false;
  try {
    const parsed = new URL(target.url);
    const encoded = encodeURIComponent(deviceId);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && validPrivateIpv4(parsed.hostname)
      && parsed.username === ""
      && parsed.password === ""
      && parsed.port.length > 0
      && Number.isSafeInteger(Number(parsed.port))
      && Number(parsed.port) >= 1_024
      && Number(parsed.port) <= 65_535
      && parsed.pathname === `/live/${encoded}/whip`
      && parsed.search === ""
      && parsed.hash === "";
  } catch { return false; }
}

function create(dependencies: WhipStreamControlDependencies): WhipStreamControlInstance {
  const lanes = new Map<string, Lane>();
  const listeners = new Set<(snapshots: readonly WhipDispatchSnapshot[]) => void>();
  const laneFor = (deviceId: string): Lane => {
    const existing = lanes.get(deviceId);
    if (existing !== undefined) return existing;
    const lane: Lane = { phase: "idle", busy: false, lastOperation: null, failureCode: null, reason: null };
    lanes.set(deviceId, lane);
    return lane;
  };
  const snapshot = (deviceId: string, lane: Lane): WhipDispatchSnapshot => freeze({ deviceId, phase: lane.phase, lastOperation: lane.lastOperation, failureCode: lane.failureCode, reason: lane.reason });
  const list = (): readonly WhipDispatchSnapshot[] => freeze([...lanes.entries()].map(([deviceId, lane]) => snapshot(deviceId, lane)).sort((left, right) => left.deviceId.localeCompare(right.deviceId)));
  const publish = (): void => { const value = list(); for (const listener of [...listeners]) { try { listener(value); } catch { /* subscriber isolation */ } } };

  const check = (deviceId: string): WhipDispatchCheck => {
    if (!validId(deviceId)) return freeze({ ok: false as const, code: "INVALID_INPUT" as const });
    const telemetryAttempt = attempt(() => dependencies.relay.latestTelemetry(deviceId));
    if (!telemetryAttempt.ok || (telemetryAttempt.value !== null && !record(telemetryAttempt.value))) return freeze({ ok: false as const, code: "DEPENDENCY_FAILURE" as const });
    const telemetry = telemetryAttempt.value;
    const payload = telemetry === null ? freeze({ ok: true as const, value: {} }) : attempt(() => telemetry.payload);
    const capabilities = telemetry === null ? freeze({ ok: true as const, value: {} }) : attempt(() => telemetry.capabilities);
    if (!payload.ok || !capabilities.ok) return freeze({ ok: false as const, code: "DEPENDENCY_FAILURE" as const });
    const input: Record<string, unknown> = { operation: "live-stream", relayConnected: telemetry !== null, capabilities: capabilities.value };
    if (record(payload.value)) {
      input.sdkAvailability = payload.value.sdkAvailability;
      input.remoteController = payload.value.remoteController;
      input.flightController = payload.value.flightController;
      input.sdkRegistered = payload.value.sdkRegistered;
      input.remoteControllerConnected = payload.value.remoteControllerConnected;
      input.flightControllerConnected = payload.value.flightControllerConnected;
    }
    const gate = attempt(() => dependencies.capabilityGate.evaluate(input));
    if (!gate.ok || !record(gate.value) || gate.value.ok !== true || !record(gate.value.value) || typeof gate.value.value.enabled !== "boolean") return freeze({ ok: false as const, code: "DEPENDENCY_FAILURE" as const });
    if (!gate.value.value.enabled) return freeze({ ok: false as const, code: "CAPABILITY_BLOCKED" as const, reason: safeReason(gate.value.value.reason) });
    return freeze({ ok: true as const });
  };

  const checked = (deviceId: string, operation: WhipOperation, lane: Lane): WhipDispatchResult | null => {
    if (!validId(deviceId)) return freeze({ ok: false as const, operation, code: "INVALID_INPUT" as const, state: null });
    if (lane.busy) return freeze({ ok: false as const, operation, code: "OPERATION_IN_PROGRESS" as const, state: snapshot(deviceId, lane) });
    const allowed = check(deviceId);
    if (!allowed.ok) return freeze({ ok: false as const, operation, code: allowed.code, state: snapshot(deviceId, lane), ...(allowed.reason === undefined ? {} : { reason: allowed.reason }) });
    return null;
  };

  const finish = (deviceId: string, lane: Lane, operation: WhipOperation, ok: boolean, code: WhipDispatchCode | null, reason: string | null = null): WhipDispatchResult => {
    lane.busy = false;
    lane.lastOperation = operation;
    lane.failureCode = code;
    lane.reason = reason;
    lane.phase = ok ? operation === "start" ? "streaming" : "idle" : "failed";
    const state = snapshot(deviceId, lane);
    publish();
    return ok ? freeze({ ok: true as const, operation, state }) : freeze({ ok: false as const, operation, code: code!, state, ...(reason === null ? {} : { reason }) });
  };

  const send = async (
    deviceId: string,
    lane: Lane,
    operation: WhipOperation,
    request: Readonly<{ readonly name: "live-stream-webrtc.start" | "live-stream-webrtc.stop"; readonly fields: Readonly<Record<string, string>> }>,
  ): Promise<WhipDispatchResult> => {
    lane.busy = true;
    lane.phase = operation === "start" ? "starting" : "stopping";
    publish();
    const sent = await attemptAsync(() => dependencies.relay.sendCommand(deviceId, request));
    if ((lane.phase as WhipDispatchSnapshot["phase"]) === "disconnected") return freeze({ ok: false as const, operation, code: "DISCONNECTED" as const, state: snapshot(deviceId, lane) });
    if (!sent.ok) return finish(deviceId, lane, operation, false, "DEPENDENCY_FAILURE");
    const payload = attempt(() => {
      if (!record(sent.value)) return null;
      return freeze({ status: sent.value.status, detail: sent.value.detail });
    });
    if (!payload.ok || payload.value === null) return finish(deviceId, lane, operation, false, "RELAY_REJECTED");
    return payload.value.status === "succeeded"
      ? finish(deviceId, lane, operation, true, null)
      : finish(deviceId, lane, operation, false, "RELAY_REJECTED", relayRejectionReason(payload.value.detail));
  };

  return freeze({
    check,
    start: async (deviceId) => {
      const lane = laneFor(typeof deviceId === "string" ? deviceId : "");
      const rejected = checked(deviceId, "start", lane);
      if (rejected !== null) return rejected;
      const mediaSnapshot = attempt(() => dependencies.media.snapshot());
      if (!mediaSnapshot.ok || !record(mediaSnapshot.value) || mediaSnapshot.value.phase !== "running") return finish(deviceId, lane, "start", false, "WEBRTC_MEDIA_UNAVAILABLE");
      const target = attempt(() => dependencies.media.publishTarget(deviceId));
      if (!target.ok || !validWhipTarget(target.value, deviceId)) return finish(deviceId, lane, "start", false, "TARGET_INVALID");
      const value = target.value as { readonly value: { readonly url: string } };
      return send(deviceId, lane, "start", freeze({ name: "live-stream-webrtc.start", fields: freeze({ whipUrl: value.value.url }) }));
    },
    stop: async (deviceId) => {
      const lane = laneFor(typeof deviceId === "string" ? deviceId : "");
      const rejected = checked(deviceId, "stop", lane);
      if (rejected !== null) return rejected;
      return send(deviceId, lane, "stop", freeze({ name: "live-stream-webrtc.stop", fields: freeze({}) }));
    },
    get: (deviceId) => validId(deviceId) && lanes.has(deviceId) ? snapshot(deviceId, lanes.get(deviceId)!) : empty(typeof deviceId === "string" ? deviceId : ""),
    list,
    recordDisconnected: (deviceId) => {
      const lane = lanes.get(deviceId);
      if (lane === undefined) return null;
      lane.phase = "disconnected";
      lane.busy = false;
      lane.failureCode = "DISCONNECTED";
      lane.reason = null;
      const state = snapshot(deviceId, lane);
      publish();
      return state;
    },
    forget: (deviceId) => {
      const lane = lanes.get(deviceId);
      if (lane === undefined || !["idle", "failed", "disconnected"].includes(lane.phase)) return false;
      lanes.delete(deviceId);
      publish();
      return true;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      let active = true;
      return () => { if (active) { active = false; listeners.delete(listener); } };
    },
  });
}

export const WhipStreamControl = freeze({ create });
