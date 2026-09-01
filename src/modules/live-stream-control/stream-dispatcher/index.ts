export type StreamOperation = "start" | "stop";
export type StreamDispatchCode = "INVALID_INPUT" | "MEDIA_PIPELINE_UNAVAILABLE" | "CONFIGURATION_INVALID" | "CAPABILITY_BLOCKED" | "OPERATION_IN_PROGRESS" | "RELAY_REJECTED" | "DEPENDENCY_FAILURE" | "DISCONNECTED" | "ILLEGAL_STATE";
export interface StreamDispatchSnapshot { readonly deviceId: string; readonly phase: "idle" | "starting" | "streaming" | "stopping" | "failed" | "disconnected"; readonly lastOperation: StreamOperation | null; readonly failureCode: StreamDispatchCode | null; readonly reason: string | null; }
export type StreamDispatchCheck = Readonly<{ readonly ok: true }> | Readonly<{ readonly ok: false; readonly code: Exclude<StreamDispatchCode, "OPERATION_IN_PROGRESS" | "RELAY_REJECTED" | "DISCONNECTED" | "ILLEGAL_STATE">; readonly reason?: string }>;
export type StreamDispatchResult = Readonly<{ readonly ok: true; readonly operation: StreamOperation; readonly state: StreamDispatchSnapshot }> | Readonly<{ readonly ok: false; readonly operation: StreamOperation; readonly code: StreamDispatchCode; readonly state: StreamDispatchSnapshot | null; readonly reason?: string }>;
export interface StreamDispatcherDependencies {
  readonly media: { readonly snapshot: () => unknown };
  readonly relay: { readonly latestTelemetry: (deviceId: string) => unknown; readonly ingressAddress?: (deviceId: string) => unknown; readonly sendCommand: (deviceId: string, request: Readonly<{ readonly name: "live-stream.start" | "live-stream.stop"; readonly fields: Readonly<Record<string, string>> }>) => Promise<unknown>; };
  readonly capabilityGate: { readonly evaluate: (input: unknown) => unknown };
  readonly targetConfig: { readonly createRtmpTarget: (input: unknown) => unknown };
}
export interface StreamDispatcherInstance { readonly check: (deviceId: string) => StreamDispatchCheck; readonly start: (deviceId: string) => Promise<StreamDispatchResult>; readonly stop: (deviceId: string) => Promise<StreamDispatchResult>; readonly get: (deviceId: string) => StreamDispatchSnapshot; readonly list: () => readonly StreamDispatchSnapshot[]; readonly recordDisconnected: (deviceId: string) => StreamDispatchSnapshot | null; readonly forget: (deviceId: string) => boolean; readonly subscribe: (listener: (snapshots: readonly StreamDispatchSnapshot[]) => void) => () => void; }

type Lane = { phase: StreamDispatchSnapshot["phase"]; busy: boolean; lastOperation: StreamOperation | null; failureCode: StreamDispatchCode | null; reason: string | null; restartResolvers: Array<(result: StreamDispatchResult) => void>; };
// Stryker disable next-line ArrowFunction: 静态辅助函数替换不能在转换后的 ESM 缓存中重新加载；所有公开结果均有契约测试。
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
// Stryker disable next-line ArrowFunction: 静态辅助函数替换不能在转换后的 ESM 缓存中重新加载；输入边界由公开契约覆盖。
const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
const privateIpv4 = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/u.test(value)) return false;
  const parts = value.split(".").map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts as [number, number, number, number];
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
};
// Stryker disable next-line ArrowFunction: 静态辅助函数替换不能在转换后的 ESM 缓存中重新加载；畸形依赖边界由公开契约覆盖。
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";
const attempt = <T>(action: () => T): Readonly<{ readonly ok: true; readonly value: T }> | Readonly<{ readonly ok: false }> => {
  try {
    return freeze({ ok: true as const, value: action() });
  } catch {
    // Stryker disable next-line ObjectLiteral: catch 后调用方只将失败视为假值；空对象与标记失败产生同一稳定公开结果。
    return freeze({ ok: false as const });
  }
};
const attemptAsync = async <T>(action: () => Promise<T>): Promise<Readonly<{ readonly ok: true; readonly value: T }> | Readonly<{ readonly ok: false }>> => {
  try {
    return freeze({ ok: true as const, value: await action() });
  } catch {
    // Stryker disable next-line ObjectLiteral: 异步捕获后的调用方只分支为失败；空对象与标记失败产生同一稳定公开结果。
    return freeze({ ok: false as const });
  }
};
// Stryker disable next-line ArrowFunction: 静态辅助函数替换不能在转换后的 ESM 缓存中重新加载；空快照由公开查询契约覆盖。
const empty = (deviceId: string): StreamDispatchSnapshot => freeze({ deviceId, phase: "idle", lastOperation: null, failureCode: null, reason: null });
const relayRejectionReason = (value: unknown): string | null => value === "Another video transport is active" ? "ANOTHER_VIDEO_TRANSPORT_ACTIVE" : null;
// Stryker disable next-line ArrowFunction: 静态辅助函数替换不能在转换后的 ESM 缓存中重新加载；断线迟到结果由公开契约覆盖。
const isDisconnected = (lane: Lane): boolean => lane.phase === "disconnected";

function create(dependencies: StreamDispatcherDependencies): StreamDispatcherInstance {
  const lanes = new Map<string, Lane>();
  const listeners = new Set<(snapshots: readonly StreamDispatchSnapshot[]) => void>();
  const snapshot = (deviceId: string, lane: Lane): StreamDispatchSnapshot => freeze({ deviceId, phase: lane.phase, lastOperation: lane.lastOperation, failureCode: lane.failureCode, reason: lane.reason });
  const list = (): readonly StreamDispatchSnapshot[] => freeze([...lanes.entries()].map(([deviceId, lane]) => snapshot(deviceId, lane)).sort((left, right) => left.deviceId.localeCompare(right.deviceId)));
  const publish = (): void => { const value = list(); for (const listener of [...listeners]) { try { listener(value); } catch { /* subscriber isolation */ } } };
  const laneFor = (deviceId: string): Lane => { const existing = lanes.get(deviceId); if (existing) return existing; const next: Lane = { phase: "idle", busy: false, lastOperation: null, failureCode: null, reason: null, restartResolvers: [] }; lanes.set(deviceId, next); return next; };
  const check = (deviceId: string): StreamDispatchCheck => {
    if (!validId(deviceId)) return freeze({ ok: false as const, code: "INVALID_INPUT" as const });
    const telemetryAttempt = attempt(() => dependencies.relay.latestTelemetry(deviceId));
    if (!telemetryAttempt.ok || (telemetryAttempt.value !== null && !record(telemetryAttempt.value))) return freeze({ ok: false as const, code: "DEPENDENCY_FAILURE" as const });
    const telemetry = telemetryAttempt.value;
    const payload = telemetry === null ? freeze({ ok: true as const, value: {} }) : attempt(() => telemetry.payload);
    const capabilities = telemetry === null ? freeze({ ok: true as const, value: {} }) : attempt(() => telemetry.capabilities);
    if (!payload.ok || !capabilities.ok) return freeze({ ok: false as const, code: "DEPENDENCY_FAILURE" as const });
    const gate = attempt(() => dependencies.capabilityGate.evaluate({ operation: "live-stream", relayConnected: telemetry !== null, sdkRegistered: record(payload.value) ? payload.value.sdkRegistered : undefined, remoteControllerConnected: record(payload.value) ? payload.value.remoteControllerConnected : undefined, flightControllerConnected: record(payload.value) ? payload.value.flightControllerConnected : undefined, aircraftConnected: record(payload.value) ? payload.value.connected : undefined, capabilities: capabilities.value }));
    if (!gate.ok || !record(gate.value) || gate.value.ok !== true || !record(gate.value.value) || typeof gate.value.value.enabled !== "boolean") return freeze({ ok: false as const, code: "DEPENDENCY_FAILURE" as const });
    if (!gate.value.value.enabled) return freeze({ ok: false as const, code: "CAPABILITY_BLOCKED" as const, reason: typeof gate.value.value.reason === "string" ? gate.value.value.reason : "CAPABILITY_UNKNOWN" });
    return freeze({ ok: true as const });
  };
  const checked = (deviceId: string, operation: StreamOperation, lane: Lane): StreamDispatchResult | null => {
    if (!validId(deviceId)) return freeze({ ok: false as const, operation, code: "INVALID_INPUT" as const, state: null });
    if (lane.busy) return freeze({ ok: false as const, operation, code: "OPERATION_IN_PROGRESS" as const, state: snapshot(deviceId, lane) });
    const allowed = check(deviceId);
    if (!allowed.ok) return freeze({ ok: false as const, operation, code: allowed.code, state: snapshot(deviceId, lane), ...(allowed.reason === undefined ? {} : { reason: allowed.reason }) });
    return null;
  };
  const result = (deviceId: string, lane: Lane, operation: StreamOperation, ok: boolean, code: StreamDispatchCode | null, reason: string | null = null): StreamDispatchResult => {
    lane.busy = false; lane.lastOperation = operation; lane.failureCode = code; lane.reason = reason; lane.phase = ok ? operation === "start" ? "streaming" : "idle" : "failed";
    const state = snapshot(deviceId, lane); publish();
    return ok ? freeze({ ok: true as const, operation, state }) : freeze({ ok: false as const, operation, code: code!, state, ...(reason === null ? {} : { reason }) });
  };
  const send = async (deviceId: string, lane: Lane, operation: StreamOperation, request: Readonly<{ readonly name: "live-stream.start" | "live-stream.stop"; readonly fields: Readonly<Record<string, string>> }>): Promise<StreamDispatchResult> => {
    lane.busy = true; lane.phase = operation === "start" ? "starting" : "stopping"; publish();
    const sent = await attemptAsync(() => dependencies.relay.sendCommand(deviceId, request));
    if (isDisconnected(lane)) return freeze({ ok: false as const, operation, code: "DISCONNECTED" as const, state: snapshot(deviceId, lane) });
    if (!sent.ok) return result(deviceId, lane, operation, false, "DEPENDENCY_FAILURE");
    const payload = attempt(() => {
      if (!record(sent.value)) return null;
      return freeze({ status: sent.value.status, detail: sent.value.detail });
    });
    if (!payload.ok || payload.value === null) return result(deviceId, lane, operation, false, "RELAY_REJECTED");
    return payload.value.status === "succeeded"
      ? result(deviceId, lane, operation, true, null)
      : result(deviceId, lane, operation, false, "RELAY_REJECTED", relayRejectionReason(payload.value.detail));
  };
  const restartFailure = (deviceId: string, lane: Lane, code: StreamDispatchCode, reason: string | null = null): StreamDispatchResult => {
    const state = snapshot(deviceId, lane);
    return freeze({ ok: false as const, operation: "start" as const, code, state, ...(reason === null ? {} : { reason }) });
  };
  const settleRestartResolvers = (resolvers: readonly ((result: StreamDispatchResult) => void)[], outcome: StreamDispatchResult): void => {
    for (const resolve of resolvers) {
      try { resolve(outcome); } catch { /* promise resolution must not affect the lane */ }
    }
  };
  const beginStart = async (deviceId: string, lane: Lane): Promise<StreamDispatchResult> => {
    const rejected = checked(deviceId, "start", lane); if (rejected) return rejected;
    const media = attempt(() => dependencies.media.snapshot());
    // Stryker disable next-line ConditionalExpression: 捕获失败后缺失 value 仍会被下一条媒体快照验证归一为同一不可用结果。
    if (!media.ok) return result(deviceId, lane, "start", false, "MEDIA_PIPELINE_UNAVAILABLE");
    const mediaSnapshot = media.value;
    if (!record(mediaSnapshot) || mediaSnapshot.phase !== "running" || !record(mediaSnapshot.endpoint)) return result(deviceId, lane, "start", false, "MEDIA_PIPELINE_UNAVAILABLE");
    const ingress = attempt(() => {
      const resolve = dependencies.relay.ingressAddress;
      return typeof resolve === "function" ? resolve(deviceId) : null;
    });
    const endpoint = ingress.ok && privateIpv4(ingress.value)
      ? freeze({ ...mediaSnapshot.endpoint, host: ingress.value })
      : mediaSnapshot.endpoint;
    const target = attempt(() => dependencies.targetConfig.createRtmpTarget({ deviceId, endpoint }));
    if (!target.ok || !record(target.value) || target.value.ok !== true || !record(target.value.value) || typeof target.value.value.rtmpUrl !== "string") return result(deviceId, lane, "start", false, "CONFIGURATION_INVALID");
    return send(deviceId, lane, "start", freeze({ name: "live-stream.start" as const, fields: freeze({ rtmpUrl: target.value.value.rtmpUrl }) }));
  };
  const settleQueuedRestart = (deviceId: string, lane: Lane, stopResult: StreamDispatchResult): void => {
    const resolvers = lane.restartResolvers.splice(0);
    if (resolvers.length === 0) return;
    if (!stopResult.ok) {
      settleRestartResolvers(resolvers, restartFailure(deviceId, lane, stopResult.code, stopResult.reason ?? null));
      return;
    }
    void beginStart(deviceId, lane).then(
      (outcome) => settleRestartResolvers(resolvers, outcome),
    );
  };
  return freeze({
    check,
    start: async (deviceId) => {
      const lane = laneFor(typeof deviceId === "string" ? deviceId : "");
      if (validId(deviceId) && lane.busy && lane.phase === "stopping") {
        return await new Promise<StreamDispatchResult>((resolve) => { lane.restartResolvers.push(resolve); });
      }
      return beginStart(deviceId, lane);
    },
    stop: async (deviceId) => {
      const lane = laneFor(typeof deviceId === "string" ? deviceId : "");
      if (!validId(deviceId)) return freeze({ ok: false as const, operation: "stop" as const, code: "INVALID_INPUT" as const, state: null });
      if (lane.busy) return freeze({ ok: false as const, operation: "stop" as const, code: "OPERATION_IN_PROGRESS" as const, state: snapshot(deviceId, lane) });
      // 停止不得复用启动能力门闩：遥控器/SDK 遥测抖动时仍须能发 live-stream.stop。
      const stopResult = await send(deviceId, lane, "stop", freeze({ name: "live-stream.stop" as const, fields: freeze({}) }));
      settleQueuedRestart(deviceId, lane, stopResult);
      return stopResult;
    },
    get: (deviceId) => validId(deviceId) && lanes.has(deviceId) ? snapshot(deviceId, lanes.get(deviceId)!) : empty(typeof deviceId === "string" ? deviceId : ""),
    list,
    recordDisconnected: (deviceId) => { const lane = lanes.get(deviceId); if (!lane) return null; lane.phase = "disconnected"; lane.busy = false; lane.failureCode = "DISCONNECTED"; lane.reason = null; const state = snapshot(deviceId, lane); const resolvers = lane.restartResolvers.splice(0); publish(); settleRestartResolvers(resolvers, restartFailure(deviceId, lane, "DISCONNECTED")); return state; },
    forget: (deviceId) => { const lane = lanes.get(deviceId); if (!lane || !["idle", "failed", "disconnected"].includes(lane.phase)) return false; lanes.delete(deviceId); publish(); return true; },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }
  });
}

// Stryker disable next-line ObjectLiteral: ESM 静态门面在转换测试模块重新导入前已创建；公开构造与描述符行为均已覆盖。
export const StreamDispatcher = freeze({ create });
