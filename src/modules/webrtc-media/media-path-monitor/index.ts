export interface MediaPathPort { readonly listPaths: () => Promise<readonly string[]>; }
export type PathEvent = Readonly<{ readonly deviceId: string; readonly event: "published" | "unpublished" }>;
export interface PathMonitorSnapshot {
  readonly phase: "idle" | "monitoring" | "failed";
  readonly revision: number;
  readonly devices: readonly string[];
  readonly diagnostic: string | null;
}
export type StartResult = Readonly<{ readonly ok: true; readonly value: PathMonitorSnapshot }> | Readonly<{ readonly ok: false; readonly code: "ALREADY_MONITORING" | "INVALID_STATE"; readonly value: PathMonitorSnapshot }>;
export type RefreshResult = Readonly<{ readonly ok: true; readonly value: Readonly<{ readonly events: readonly PathEvent[]; readonly snapshot: PathMonitorSnapshot }> }> | Readonly<{ readonly ok: false; readonly code: "NOT_MONITORING" | "LIST_FAILED"; readonly value: PathMonitorSnapshot }>;
export type StopResult = Readonly<{ readonly ok: true; readonly value: PathMonitorSnapshot }> | Readonly<{ readonly ok: false; readonly code: "NOT_MONITORING"; readonly value: PathMonitorSnapshot }>;
export interface MediaPathMonitorInstance {
  readonly start: () => StartResult;
  readonly refresh: () => Promise<RefreshResult>;
  readonly stop: () => StopResult;
  readonly snapshot: () => PathMonitorSnapshot;
}

const LIST_FAILED = "无法读取 MediaMTX 发布路径。请检查桌面媒体服务。";
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const failure = <TCode extends string, TValue>(code: TCode, value: TValue): Readonly<{ readonly ok: false; readonly code: TCode; readonly value: TValue }> => freeze({ ok: false as const, code, value });
const success = <T>(value: T): Readonly<{ readonly ok: true; readonly value: T }> => freeze({ ok: true as const, value });
const validDeviceId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value !== "." && value !== ".." && Array.from(value).length <= 128 && !/[\\/\p{Cc}]/u.test(value);
const validPort = (value: unknown): value is MediaPathPort => {
  if (value === null || typeof value !== "object") return false;
  try { return typeof (value as MediaPathPort).listPaths === "function"; } catch { return false; }
};

function deviceIdFromPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^\/live\/([^/]+)$/u.exec(value);
  if (match === null) return null;
  try {
    const encoded = match[1] ?? "";
    const deviceId = decodeURIComponent(encoded);
    return validDeviceId(deviceId) && encodeURIComponent(deviceId) === encoded ? deviceId : null;
  } catch {
    return null;
  }
}

function sortedDevices(devices: Iterable<string>): readonly string[] {
  return freeze([...new Set(devices)].sort((left, right) => left.localeCompare(right)));
}

function create(port: MediaPathPort): MediaPathMonitorInstance {
  if (!validPort(port)) throw new TypeError("Invalid MediaMTX path port");
  let state: PathMonitorSnapshot = { phase: "idle", revision: 0, devices: freeze([]), diagnostic: null };
  let previous = new Set<string>();
  const transition = (next: Omit<PathMonitorSnapshot, "revision">): PathMonitorSnapshot => {
    state = { ...next, revision: state.revision + 1 };
    return freeze({ ...state, devices: freeze([...state.devices]) });
  };
  const current = (): PathMonitorSnapshot => freeze({ ...state, devices: freeze([...state.devices]) });
  return freeze({
    start: () => {
      if (state.phase === "monitoring") return failure("ALREADY_MONITORING", current());
      previous = new Set();
      return success(transition({ phase: "monitoring", devices: freeze([]), diagnostic: null }));
    },
    refresh: async () => {
      if (state.phase !== "monitoring") return failure("NOT_MONITORING", current());
      let paths: readonly string[];
      try {
        const result = await port.listPaths();
        if (!Array.isArray(result)) throw new Error("invalid paths");
        paths = result;
      } catch {
        previous = new Set();
        return failure("LIST_FAILED", transition({ phase: "failed", devices: freeze([]), diagnostic: LIST_FAILED }));
      }
      const currentDevices = new Set(paths.map(deviceIdFromPath).filter((value): value is string => value !== null));
      const events: PathEvent[] = [];
      for (const deviceId of currentDevices) if (!previous.has(deviceId)) events.push(freeze({ deviceId, event: "published" as const }));
      for (const deviceId of previous) if (!currentDevices.has(deviceId)) events.push(freeze({ deviceId, event: "unpublished" as const }));
      const changed = events.length > 0;
      previous = currentDevices;
      const next = changed ? transition({ phase: "monitoring", devices: sortedDevices(currentDevices), diagnostic: null }) : current();
      return success(freeze({ events: freeze(events.sort((left, right) => left.deviceId.localeCompare(right.deviceId) || left.event.localeCompare(right.event))), snapshot: next }));
    },
    stop: () => {
      if (state.phase !== "monitoring") return failure("NOT_MONITORING", current());
      previous = new Set();
      return success(transition({ phase: "idle", devices: freeze([]), diagnostic: null }));
    },
    snapshot: current
  });
}

export const MediaPathMonitor = freeze({ create });
