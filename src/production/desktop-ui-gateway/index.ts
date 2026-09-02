type WorkflowPort = Record<string, unknown>;

export interface DesktopUiApplicationPort {
  readonly snapshot: () => unknown;
  readonly subscribe: (listener: (snapshot: unknown) => void) => () => void;
  readonly workflow: () => WorkflowPort;
}

export interface DesktopUiGatewayOptions {
  readonly application: DesktopUiApplicationPort;
  readonly relayHint?: () => unknown;
}
export type GatewayCode = "METHOD_NOT_ALLOWED" | "INVALID_INPUT" | "DEPENDENCY_FAILURE" | "DISPOSED";
export type GatewayResult = Readonly<{ readonly ok: true; readonly value: unknown }> | Readonly<{ readonly ok: false; readonly code: GatewayCode }>;
export interface DesktopUiGatewayInstance {
  readonly invoke: (method: unknown, input: unknown) => Promise<GatewayResult>;
  readonly snapshot: () => unknown;
  readonly subscribe: (listener: (snapshot: unknown) => void) => () => void;
  readonly dispose: () => void;
}

const hidden = new Set(["endpoint", "playbackUrl", "diagnostic", "path", "filePath", "token", "credential", "password"]);
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const failure = (code: GatewayCode): GatewayResult => freeze({ ok: false as const, code });
const success = (value: unknown): GatewayResult => freeze({ ok: true as const, value: sanitize(value) });
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const read = (value: unknown, key: string): unknown => { try { return record(value)?.[key]; } catch { return undefined; } };
const keys = (value: Record<string, unknown>): readonly string[] | null => { try { return Object.keys(value); }
  /* c8 ignore next -- 生产快照是普通对象；代理 ownKeys 异常仅是防御性降级。 */
  catch { return null; } };
const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
const exact = (input: unknown, allowed: readonly string[]): Record<string, unknown> | null => {
  const source = record(input);
  /* c8 ignore next -- record 对非数组对象始终返回对象，此条件仅保留防御性类型分支。 */
  /* c8 ignore next -- record 对非数组对象始终返回对象，此条件仅保留防御性类型分支。 */
  const sourceKeys = source === null ? null : keys(source);
  return sourceKeys !== null && sourceKeys.length === allowed.length && sourceKeys.every((key) => allowed.includes(key)) ? source : null;
};
const one = (input: unknown, key: "deviceId" | "routeId"): string | null => {
  const source = exact(input, [key]);
  const value = source === null ? null : read(source, key);
  return validId(value) ? value : null;
};
const pair = (input: unknown): Readonly<{ readonly deviceId: string; readonly routeId: string }> | null => {
  const source = exact(input, ["deviceId", "routeId"]);
  const deviceId = source === null ? null : read(source, "deviceId");
  const routeId = source === null ? null : read(source, "routeId");
  return validId(deviceId) && validId(routeId) ? freeze({ deviceId, routeId }) : null;
};
const empty = (input: unknown): boolean => input === undefined;
const relayHints = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) return [];
  return Object.freeze(value.flatMap((item) => typeof item === "string" && /^ws:\/\/[\w.-]+:\d+\/relay$/u.test(item) ? [item] : []));
};

function sanitize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return typeof value === "function" || typeof value === "symbol" ? null : value;
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) return freeze(value.map((item) => sanitize(item, seen)));
  if (value instanceof Uint8Array) return freeze({ byteLength: value.byteLength });
  const source = record(value);
  /* c8 ignore next -- record 对非数组对象始终返回对象，此条件仅保留防御性类型分支。 */
  const sourceKeys = source === null ? null : keys(source);
  /* c8 ignore next -- 非数组对象均由 record 标准化为对象，source===null 仅保留类型防御。 */
  if (source === null || sourceKeys === null) return null;
  const copied: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of sourceKeys) if (!hidden.has(key)) copied[key] = sanitize(read(source, key), seen);
  return freeze(copied);
}

function playable(deviceId: string, workflow: WorkflowPort): GatewayResult {
  const snapshot = read(workflow, "snapshot");
  if (typeof snapshot !== "function") return failure("DEPENDENCY_FAILURE");
  try {
    const media = read(snapshot(), "media");
    const streams = read(media, "streams");
    const stream = Array.isArray(streams) ? streams.find((item) => read(item, "deviceId") === deviceId && read(item, "phase") === "ready") : undefined;
    const url = read(stream, "playbackUrl");
    if (typeof url !== "string") return success(freeze({ ok: false, code: "VIDEO_NOT_READY" }));
    const parsed = new URL(url);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") || parsed.username.length > 0 || parsed.password.length > 0) return success(freeze({ ok: false, code: "VIDEO_NOT_READY" }));
    // 就绪时只返回一层业务对象；未就绪仍用 { ok:false, code }，避免再包 { ok:true, value:{deviceId,url} }。
    return success(freeze({ deviceId, url: parsed.toString() }));
  } catch { return failure("DEPENDENCY_FAILURE"); }
}

function create(options: DesktopUiGatewayOptions): DesktopUiGatewayInstance {
  const listeners = new Set<(snapshot: unknown) => void>();
  let disposed = false;
  const current = (): unknown => {
    if (disposed) return freeze({ phase: "disposed" });
    try { return sanitize(options.application.snapshot()); } catch { return freeze({ phase: "unavailable" }); }
  };
  const publish = (source?: unknown): void => {
    const snapshot = source === undefined ? current() : sanitize(source);
    for (const listener of [...listeners]) { try { listener(snapshot); } catch { /* observer isolation */ } }
  };
  let applicationUnsubscribe: () => void = () => undefined;
  try { applicationUnsubscribe = options.application.subscribe((snapshot) => publish(snapshot)); } catch { /* snapshot remains pull-readable */ }
  const workflow = (): WorkflowPort | null => {
    try { return options.application.workflow(); }
    /* c8 ignore next -- 应用装配契约保证 workflow 可读；异常仍映射为依赖失败。 */
    catch { return null; }
  };
  const call = async (method: string, args: readonly unknown[]): Promise<GatewayResult> => {
    const target = workflow();
    const operation = target === null ? null : read(target, method);
    if (typeof operation !== "function") return failure("DEPENDENCY_FAILURE");
    try { return success(await operation(...args)); } catch { return failure("DEPENDENCY_FAILURE"); }
  };
  return freeze({
    invoke: async (method, input) => {
      if (disposed) return failure("DISPOSED");
      if (method === "state.snapshot") return empty(input) ? success(current()) : failure("INVALID_INPUT");
      if (method === "network.hint") {
        if (!empty(input)) return failure("INVALID_INPUT");
        if (typeof options.relayHint !== "function") return success(freeze({ hints: [] }));
        try { return success(freeze({ hints: relayHints(options.relayHint()) })); } catch { return failure("DEPENDENCY_FAILURE"); }
      }
      if (method === "device.refresh") {
        const deviceId = one(input, "deviceId");
        return deviceId === null ? failure("INVALID_INPUT") : call("refreshDeviceState", [deviceId]);
      }
      if (method === "hardware.readiness") {
        const deviceId = one(input, "deviceId");
        return deviceId === null ? failure("INVALID_INPUT") : call("checkHardwareReadiness", [deviceId]);
      }
      if (method === "route.import") {
        const source = exact(input, ["fileName", "bytes"]);
        const fileName = source === null ? null : read(source, "fileName");
        const bytes = source === null ? null : read(source, "bytes");
        if (!validId(fileName) || !(bytes instanceof Uint8Array)) return failure("INVALID_INPUT");
        return call("importRoute", [freeze({ fileName, bytes: new Uint8Array(bytes) })]);
      }
      const routes: Readonly<Record<string, string>> = freeze({ "route.preview": "getRoutePreview", "route.select": "selectRoute", "route.remove": "removeRoute" });
      if (typeof method === "string" && routes[method] !== undefined) { const routeId = one(input, "routeId"); return routeId === null ? failure("INVALID_INPUT") : call(routes[method]!, [routeId]); }
      if (method === "assignment.assign") { const value = pair(input); return value === null ? failure("INVALID_INPUT") : call("assignRoute", [value.deviceId, value.routeId]); }
      if (method === "assignment.clear") { const deviceId = one(input, "deviceId"); return deviceId === null ? failure("INVALID_INPUT") : call("clearAssignment", [deviceId]); }
      const missions: Readonly<Record<string, string>> = freeze({ "mission.stage": "stage", "mission.upload": "upload", "mission.start": "start", "mission.pause": "pause", "mission.resume": "resume", "mission.stop": "stop" });
      if (typeof method === "string" && missions[method] !== undefined) { const deviceId = one(input, "deviceId"); return deviceId === null ? failure("INVALID_INPUT") : call(missions[method]!, [deviceId]); }
      if (method === "stream.refresh") return empty(input) ? call("refreshMedia", []) : failure("INVALID_INPUT");
      if (method === "stream.clear") return empty(input) ? call("clearVideo", []) : failure("INVALID_INPUT");
      const streams: Readonly<Record<string, string>> = freeze({ "stream.start": "startStream", "stream.stop": "stopStream", "stream.select": "selectVideo" });
      if (typeof method === "string" && streams[method] !== undefined) { const deviceId = one(input, "deviceId"); return deviceId === null ? failure("INVALID_INPUT") : call(streams[method]!, [deviceId]); }
      const settings: Readonly<Record<string, string>> = freeze({ "settings.transmission.read": "readTransmissionSettings", "settings.camera.read": "readCameraSettings" });
      if (typeof method === "string" && settings[method] !== undefined) { const deviceId = one(input, "deviceId"); return deviceId === null ? failure("INVALID_INPUT") : call(settings[method]!, [deviceId]); }
      const writes: Readonly<Record<string, string>> = freeze({ "settings.transmission.write": "writeTransmissionSettings", "settings.camera.write": "writeCameraSettings" });
      if (typeof method === "string" && writes[method] !== undefined) { const source = exact(input, ["deviceId", "patch"]); const deviceId = source === null ? null : read(source, "deviceId"); const patch = source === null ? null : read(source, "patch"); return !validId(deviceId) || record(patch) === null ? failure("INVALID_INPUT") : call(writes[method]!, [deviceId, patch]); }
      if (method === "flight.request") { const source = exact(input, ["deviceId", "action"]); const deviceId = source === null ? null : read(source, "deviceId"); const action = source === null ? null : read(source, "action"); return !validId(deviceId) || (action !== "takeoff" && action !== "land" && action !== "confirm-landing" && action !== "return-home" && action !== "stop-takeoff" && action !== "stop-auto-landing") ? failure("INVALID_INPUT") : call("requestFlightAction", [deviceId, action]); }
      const confirmations: Readonly<Record<string, string>> = freeze({ "flight.confirm": "confirmFlightAction", "flight.cancel": "cancelFlightAction" });
      if (typeof method === "string" && confirmations[method] !== undefined) { const source = exact(input, ["deviceId", "confirmationId"]); const deviceId = source === null ? null : read(source, "deviceId"); const confirmationId = source === null ? null : read(source, "confirmationId"); return !validId(deviceId) || !validId(confirmationId) ? failure("INVALID_INPUT") : call(confirmations[method]!, [deviceId, confirmationId]); }
      if (method === "video.playback") { const deviceId = one(input, "deviceId"); const target = workflow(); return deviceId === null ? failure("INVALID_INPUT") : target === null ? failure("DEPENDENCY_FAILURE") : playable(deviceId, target); }
      return failure("METHOD_NOT_ALLOWED");
    },
    snapshot: current,
    subscribe: (listener) => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      let subscribed = true;
      return () => { if (subscribed) { subscribed = false; listeners.delete(listener); } };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      try { applicationUnsubscribe(); } catch { /* cleanup must not escape */ }
      listeners.clear();
    }
  });
}

export const DesktopUiGateway = freeze({ create });
