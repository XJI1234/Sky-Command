export type MediaMtxMode = "whip-whep";

export interface ProcessExit {
  readonly kind: "exited" | "failed";
}

export interface ProcessHandle {
  readonly terminate: () => void;
}

export interface ProcessPort {
  readonly launch: (
    input: Readonly<{ readonly executablePath: string; readonly config: string }>,
    onExit: (event: ProcessExit) => void
  ) => ProcessHandle;
}

export interface ProcessEvents {
  readonly onExit: (event: ProcessExit) => void;
}

export interface StartInput {
  readonly executablePath: string;
  readonly httpPort: number;
  readonly webRtcUdpPort: number;
  readonly apiPort: number;
  readonly pathPrefix: string;
  readonly publicHost: string;
  readonly mode: MediaMtxMode;
}

export interface ProcessSnapshot {
  readonly phase: "idle" | "starting" | "running" | "stopping" | "failed" | "disposed";
  readonly revision: number;
  readonly httpPort: number | null;
  readonly webRtcUdpPort: number | null;
  readonly apiPort: number | null;
  readonly pathPrefix: string | null;
  readonly diagnostic: string | null;
}

export type StartResult =
  | Readonly<{ readonly ok: true; readonly value: ProcessSnapshot }>
  | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" | "ALREADY_ACTIVE" | "START_FAILED" | "DISPOSED"; readonly value: ProcessSnapshot }>;

export type StopResult =
  | Readonly<{ readonly ok: true; readonly value: ProcessSnapshot }>
  | Readonly<{ readonly ok: false; readonly code: "NOT_RUNNING" | "STOP_FAILED" | "DISPOSED"; readonly value: ProcessSnapshot }>;

export interface MediaMtxProcessInstance {
  readonly start: (input: unknown, events: unknown) => StartResult;
  readonly stop: () => StopResult;
  readonly snapshot: () => ProcessSnapshot;
  readonly dispose: () => void;
}

const START_FAILED = "MediaMTX 进程未能启动。请检查桌面媒体服务。";
const PROCESS_EXITED = "MediaMTX 进程异常结束。请检查桌面媒体服务。";
const STOP_FAILED = "无法停止 MediaMTX 进程。请检查桌面媒体服务。";

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const success = <T>(value: T): Readonly<{ readonly ok: true; readonly value: T }> => freeze({ ok: true as const, value });
const failure = <TCode extends string, TValue>(code: TCode, value: TValue): Readonly<{ readonly ok: false; readonly code: TCode; readonly value: TValue }> => freeze({ ok: false as const, code, value });
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function validPortNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1_024 && value <= 65_535;
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validPathPrefix(value: unknown): value is string {
  return typeof value === "string" && /^\/[A-Za-z0-9._-]{1,63}$/u.test(value);
}

function validIpv4(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) return false;
  return parts.every((part) => Number(part) >= 0 && Number(part) <= 255);
}

function validMode(value: unknown): value is MediaMtxMode {
  return value === "whip-whep";
}

function validPort(value: unknown): value is ProcessPort {
  if (!record(value)) return false;
  try {
    return typeof value.launch === "function";
  } catch {
    return false;
  }
}

function readInput(value: unknown): StartInput | null {
  if (!record(value)) return null;
  try {
    const input = {
      executablePath: value.executablePath,
      httpPort: value.httpPort,
      webRtcUdpPort: value.webRtcUdpPort,
      apiPort: value.apiPort,
      pathPrefix: value.pathPrefix,
      publicHost: value.publicHost,
      mode: value.mode
    };
    if (!validText(input.executablePath)
      || !validPortNumber(input.httpPort)
      || !validPortNumber(input.webRtcUdpPort)
      || !validPortNumber(input.apiPort)
      || !validPathPrefix(input.pathPrefix)
      || !validIpv4(input.publicHost)
      || !validMode(input.mode)) return null;
    if (new Set([input.httpPort, input.webRtcUdpPort, input.apiPort]).size !== 3) return null;
    return freeze(input as StartInput);
  } catch {
    return null;
  }
}

function readEvents(value: unknown): ProcessEvents | null {
  if (!record(value)) return null;
  try {
    return typeof value.onExit === "function" ? freeze({ onExit: value.onExit as ProcessEvents["onExit"] }) : null;
  } catch {
    return null;
  }
}

function validExit(value: unknown): value is ProcessExit {
  if (!record(value)) return false;
  try {
    return value.kind === "exited" || value.kind === "failed";
  } catch {
    return false;
  }
}

function validHandle(value: unknown): value is ProcessHandle {
  if (!record(value)) return false;
  try {
    return typeof value.terminate === "function";
  } catch {
    return false;
  }
}

function configFor(input: StartInput): string {
  const pathPrefix = input.pathPrefix.slice(1);
  return [
    "logLevel: warn",
    "rtsp: no",
    "rtmp: no",
    "hls: no",
    "srt: no",
    "webrtc: yes",
    `webrtcAddress: :${input.httpPort}`,
    "webrtcAllowOrigins: ['*']",
    `webrtcLocalUDPAddress: :${input.webRtcUdpPort}`,
    "webrtcIPsFromInterfaces: no",
    "webrtcAdditionalHosts:",
    `  - ${input.publicHost}`,
    "api: yes",
    `apiAddress: 127.0.0.1:${input.apiPort}`,
    "paths:",
    `  \"~^${pathPrefix}(?:/.*)?$\":`,
    "    source: publisher",
    ""
  ].join("\n");
}

function create(port: ProcessPort): MediaMtxProcessInstance {
  if (!validPort(port)) throw new TypeError("Invalid MediaMTX process port");

  let state: ProcessSnapshot = freeze({ phase: "idle", revision: 0, httpPort: null, webRtcUdpPort: null, apiPort: null, pathPrefix: null, diagnostic: null });
  let generation = 0;
  let handle: ProcessHandle | null = null;
  let activeEvents: ProcessEvents | null = null;

  const transition = (next: Omit<ProcessSnapshot, "revision">): ProcessSnapshot => {
    state = freeze({ ...next, revision: state.revision + 1 });
    return state;
  };
  const currentPhase = (): ProcessSnapshot["phase"] => state.phase;
  const ports = (input: StartInput): Omit<ProcessSnapshot, "phase" | "revision" | "diagnostic"> => ({
    httpPort: input.httpPort,
    webRtcUdpPort: input.webRtcUdpPort,
    apiPort: input.apiPort,
    pathPrefix: input.pathPrefix
  });
  const empty = (phase: ProcessSnapshot["phase"], diagnostic: string | null): Omit<ProcessSnapshot, "revision"> => ({
    httpPort: null,
    webRtcUdpPort: null,
    apiPort: null,
    pathPrefix: null,
    phase,
    diagnostic
  });
  const notify = (events: ProcessEvents | null, event: ProcessExit): void => {
    if (events === null) return;
    try { events.onExit(freeze({ kind: event.kind })); } catch { /* 外部观察器异常不得污染进程状态 */ }
  };
  const observeExit = (token: number, event: unknown, events: ProcessEvents): void => {
    if (token !== generation || !validExit(event) || state.phase === "disposed") return;
    const observed = freeze({ kind: event.kind });
    generation += 1;
    handle = null;
    activeEvents = null;
    if (state.phase === "starting") {
      transition(empty("failed", START_FAILED));
    } else if (state.phase === "running") {
      transition(empty("failed", PROCESS_EXITED));
    } else if (state.phase === "stopping") {
      transition(empty("idle", null));
    } else {
      return;
    }
    notify(events, observed);
  };

  return freeze({
    start: (rawInput, rawEvents) => {
      if (state.phase === "disposed") return failure("DISPOSED", state);
      const input = readInput(rawInput);
      const events = readEvents(rawEvents);
      if (input === null || events === null) return failure("INVALID_INPUT", state);
      if (state.phase === "starting" || state.phase === "running" || state.phase === "stopping") return failure("ALREADY_ACTIVE", state);

      generation += 1;
      const token = generation;
      activeEvents = events;
      handle = null;
      transition({ phase: "starting", ...ports(input), diagnostic: null });
      const onExit = (event: ProcessExit): void => observeExit(token, event, events);
      let launched: unknown;
      try {
        launched = port.launch(freeze({ executablePath: input.executablePath, config: configFor(input) }), onExit);
      } catch {
        if (token === generation && currentPhase() === "starting") {
          generation += 1;
          handle = null;
          activeEvents = null;
          return failure("START_FAILED", transition(empty("failed", START_FAILED)));
        }
        return failure("START_FAILED", state);
      }
      if (token !== generation || currentPhase() !== "starting") return failure("START_FAILED", state);
      if (!validHandle(launched)) {
        generation += 1;
        handle = null;
        activeEvents = null;
        return failure("START_FAILED", transition(empty("failed", START_FAILED)));
      }
      handle = launched;
      activeEvents = events;
      return success(transition({ phase: "running", ...ports(input), diagnostic: null }));
    },
    stop: () => {
      if (state.phase === "disposed") return failure("DISPOSED", state);
      if (state.phase === "failed") {
        generation += 1;
        handle = null;
        activeEvents = null;
        return success(transition(empty("idle", null)));
      }
      if (state.phase !== "running" || handle === null) return failure("NOT_RUNNING", state);

      const currentHandle = handle;
      const currentEvents = activeEvents;
      transition({ phase: "stopping", httpPort: state.httpPort, webRtcUdpPort: state.webRtcUdpPort, apiPort: state.apiPort, pathPrefix: state.pathPrefix, diagnostic: null });
      try {
        currentHandle.terminate();
      } catch {
        if (currentPhase() === "stopping") return failure("STOP_FAILED", transition({ phase: "running", httpPort: state.httpPort, webRtcUdpPort: state.webRtcUdpPort, apiPort: state.apiPort, pathPrefix: state.pathPrefix, diagnostic: STOP_FAILED }));
      }
      if (currentPhase() === "idle") return success(state);
      if (currentPhase() !== "stopping") return failure("STOP_FAILED", state);
      activeEvents = currentEvents;
      return success(state);
    },
    snapshot: () => state,
    dispose: () => {
      if (state.phase === "disposed") return;
      const currentHandle = handle;
      generation += 1;
      handle = null;
      activeEvents = null;
      if (currentHandle !== null) {
        try { currentHandle.terminate(); } catch { /* 处置必须继续完成状态切换 */ }
      }
      transition(empty("disposed", null));
    }
  });
}

export const MediaMtxProcess = freeze({ create });
