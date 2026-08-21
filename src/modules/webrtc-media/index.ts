import { MediaPathMonitor, type MediaPathMonitorInstance, type MediaPathPort } from "./media-path-monitor/index.js";
import { MediaMtxProcess, type ProcessExit, type ProcessPort, type MediaMtxProcessInstance } from "./mediamtx-process/index.js";
import { WebRtcHealth, type WebRtcHealthInstance } from "./webrtc-health/index.js";
import { WhepPlayback, type PlaybackSnapshot, type WhepPlaybackInstance, type WhepPlaybackPort } from "./whep-playback/index.js";

export type NetworkKind = "physical" | "wifi" | "virtual" | "vpn" | "tunnel" | "bluetooth";

export interface NetworkInterfaceFact {
  readonly name: string;
  readonly enabled: boolean;
  readonly internal: boolean;
  readonly kind: NetworkKind;
  readonly ipv4: string;
}

export interface WebRtcMediaDependencies {
  readonly process: ProcessPort;
  readonly paths: MediaPathPort;
  readonly player: WhepPlaybackPort;
  readonly clock?: () => number;
}

export interface WebRtcMediaOptions {
  readonly httpPort: number;
  readonly webRtcUdpPort: number;
  readonly apiPort: number;
  readonly pathPrefix: string;
  readonly mode: "whip-whep";
  readonly publisherTimeoutMs: number;
}

export interface MediaStreamSnapshot {
  readonly deviceId: string;
  readonly phase: "awaiting-publisher" | "publisher-ready" | "failed";
  readonly diagnostic: string | null;
}

export interface MediaSnapshot {
  readonly phase: "idle" | "starting" | "running" | "stopping" | "failed" | "disposed";
  readonly revision: number;
  readonly streams: readonly MediaStreamSnapshot[];
  readonly player: PlaybackSnapshot;
  readonly diagnostic: string | null;
}

export interface PublishTarget {
  readonly kind: "whip";
  readonly deviceId: string;
  readonly url: string;
}

export interface PlaybackTarget {
  readonly kind: "whep";
  readonly deviceId: string;
  readonly url: string;
}

type MediaCode = "INVALID_INPUT" | "ALREADY_ACTIVE" | "HOST_UNAVAILABLE" | "MEDIA_PROCESS_FAILED" | "PATH_MONITOR_FAILED" | "NOT_RUNNING" | "UNKNOWN_DEVICE" | "VIDEO_NOT_READY" | "PLAYER_FAILED" | "EVALUATION_FAILED" | "STOP_FAILED" | "DISPOSED";

export type MediaResult<T> =
  | Readonly<{ readonly ok: true; readonly value: T }>
  | Readonly<{ readonly ok: false; readonly code: MediaCode; readonly value: MediaSnapshot }>;

export interface WebRtcMediaInstance {
  readonly start: (input: unknown) => MediaResult<MediaSnapshot>;
  readonly stop: () => MediaResult<MediaSnapshot>;
  readonly evaluate: (now: unknown) => Promise<MediaResult<MediaSnapshot>>;
  readonly publishTarget: (deviceId: unknown) => MediaResult<PublishTarget>;
  readonly playback: (deviceId: unknown) => MediaResult<PlaybackTarget>;
  readonly selectPlayer: (deviceId: unknown) => MediaResult<MediaSnapshot>;
  readonly clearPlayer: () => MediaResult<MediaSnapshot>;
  readonly snapshot: () => MediaSnapshot;
  readonly dispose: () => void;
}

const PROCESS_START_FAILED = "MediaMTX 进程未能启动。请检查桌面媒体服务。";
const PROCESS_EXITED = "MediaMTX 进程异常结束。请检查桌面媒体服务。";
const PATH_FAILED = "无法读取 MediaMTX 发布路径。请检查桌面媒体服务。";
const PLAYER_FAILED = "WHEP 播放器无法建立连接。请检查桌面媒体服务。";
const STOP_FAILED = "低延迟媒体服务清理失败。请检查桌面媒体服务。";
const HOST_FAILED = "未找到可用的局域网媒体地址。请连接手机和电脑到同一局域网。";

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const success = <T>(value: T): Readonly<{ readonly ok: true; readonly value: T }> => freeze({ ok: true as const, value });
const failure = <T>(code: MediaCode, value: MediaSnapshot): Extract<MediaResult<T>, { readonly ok: false }> => freeze({ ok: false as const, code, value });
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function validPort(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1_024 && value <= 65_535;
}

function validTimeout(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1_000 && value <= 60_000;
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validDeviceId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
}

function validPathPrefix(value: unknown): value is string {
  return typeof value === "string" && /^\/[A-Za-z0-9._-]{1,63}$/u.test(value);
}

function parseIpv4(value: unknown): readonly [number, number, number, number] | null {
  if (typeof value !== "string") return null;
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^(?:0|[1-9]\d{0,2})$/u.test(part))) return null;
  const numbers = parts.map((part) => Number(part));
  return numbers.every((part) => part >= 0 && part <= 255) ? [numbers[0]!, numbers[1]!, numbers[2]!, numbers[3]!] : null;
}

function privateIpv4(value: unknown): string | null {
  const parsed = parseIpv4(value);
  if (parsed === null) return null;
  const [first, second] = parsed;
  if (first !== 10 && !(first === 172 && second >= 16 && second <= 31) && !(first === 192 && second === 168)) return null;
  return parsed.join(".");
}

function ipv4Number(value: string): number {
  const parts = value.split(".").map(Number);
  return parts[0]! * 16_777_216 + parts[1]! * 65_536 + parts[2]! * 256 + parts[3]!;
}

function resolveHost(value: unknown, manualHost: unknown): string | null {
  if (manualHost !== null) return privateIpv4(manualHost);
  if (!Array.isArray(value)) return null;
  const candidates: string[] = [];
  for (const item of value) {
    if (!record(item)) continue;
    try {
      if (item.enabled !== true || item.internal !== false || (item.kind !== "physical" && item.kind !== "wifi")) continue;
      const host = privateIpv4(item.ipv4);
      if (host !== null) candidates.push(host);
    } catch { /* malformed adapter facts are ignored */ }
  }
  return candidates.sort((left, right) => ipv4Number(left) - ipv4Number(right))[0] ?? null;
}

function readStartInput(value: unknown): Readonly<{ readonly interfaces: unknown; readonly manualHost: string | null; readonly executablePath: string }> | null {
  if (!record(value)) return null;
  try {
    if (!Array.isArray(value.interfaces) || (value.manualHost !== null && typeof value.manualHost !== "string") || !validText(value.executablePath)) return null;
    return freeze({ interfaces: value.interfaces, manualHost: value.manualHost as string | null, executablePath: value.executablePath });
  } catch {
    return null;
  }
}

function validOptions(value: unknown): value is WebRtcMediaOptions {
  if (!record(value)) return false;
  try {
    return validPort(value.httpPort)
      && validPort(value.webRtcUdpPort)
      && validPort(value.apiPort)
      && new Set([value.httpPort, value.webRtcUdpPort, value.apiPort]).size === 3
      && validPathPrefix(value.pathPrefix)
      && value.mode === "whip-whep"
      && validTimeout(value.publisherTimeoutMs);
  } catch {
    return false;
  }
}

function validDependencies(value: unknown): value is WebRtcMediaDependencies {
  if (!record(value)) return false;
  try {
    return record(value.process) && record(value.paths) && record(value.player)
      && typeof value.process.launch === "function"
      && typeof value.paths.listPaths === "function"
      && typeof value.player.setTarget === "function"
      && typeof value.player.clear === "function"
      && (value.clock === undefined || typeof value.clock === "function");
  } catch {
    return false;
  }
}

function create(dependencies: WebRtcMediaDependencies, options: WebRtcMediaOptions): WebRtcMediaInstance {
  if (!validDependencies(dependencies)) throw new TypeError("Invalid WebRTC media dependencies");
  if (!validOptions(options)) throw new TypeError("Invalid WebRTC media options");

  const process: MediaMtxProcessInstance = MediaMtxProcess.create(dependencies.process);
  const paths: MediaPathMonitorInstance = MediaPathMonitor.create(dependencies.paths);
  const player: WhepPlaybackInstance = WhepPlayback.create(dependencies.player);
  const clock = dependencies.clock ?? (() => Date.now());
  const health = new Map<string, WebRtcHealthInstance>();
  let phase: MediaSnapshot["phase"] = "idle";
  let revision = 0;
  let diagnostic: string | null = null;
  let publicHost: string | null = null;
  let session = 0;
  let stopRequested = false;
  let stopFailed = false;
  let lastNow: number | null = null;

  const current = (): MediaSnapshot => freeze({
    phase,
    revision,
    streams: freeze([...health.entries()].map(([deviceId, item]) => {
      const snapshot = item.snapshot(deviceId);
      return freeze({ deviceId, phase: snapshot?.state ?? "failed", diagnostic: snapshot?.diagnostic ?? null });
    }).sort((left, right) => left.deviceId.localeCompare(right.deviceId))),
    player: player.snapshot(),
    diagnostic
  });
  const transition = (nextPhase: MediaSnapshot["phase"], nextDiagnostic: string | null): MediaSnapshot => {
    phase = nextPhase;
    diagnostic = nextDiagnostic;
    revision += 1;
    return current();
  };
  const touch = (): MediaSnapshot => { revision += 1; return current(); };
  const emptyHealth = (): void => { health.clear(); lastNow = null; };
  const safeNow = (): number | null => {
    try {
      const value = clock();
      return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
    } catch {
      return null;
    }
  };
  const failStreamsForProcess = (): void => {
    const now = safeNow();
    if (now === null) return;
    for (const [deviceId, item] of health) item.observe(deviceId, "process-exited", now);
  };
  const finishIdle = (): MediaSnapshot => {
    stopRequested = false;
    stopFailed = false;
    publicHost = null;
    emptyHealth();
    if (phase === "idle") return current();
    return transition("idle", null);
  };
  const processExit = (token: number, event: ProcessExit): void => {
    if (token !== session || phase === "disposed") return;
    if (stopRequested) {
      if (!stopFailed && process.snapshot().phase === "idle") finishIdle();
      return;
    }
    if (phase !== "starting" && phase !== "running") return;
    failStreamsForProcess();
    publicHost = null;
    transition("failed", event.kind === "failed" || event.kind === "exited" ? PROCESS_EXITED : PROCESS_EXITED);
  };
  const makeUrl = (protocol: "whip" | "whep", host: string, deviceId: string): string | null => {
    try {
      const encoded = encodeURIComponent(deviceId);
      const url = `http://${host}:${options.httpPort}${options.pathPrefix}/${encoded}/${protocol}`;
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" || parsed.hostname !== host || parsed.port !== String(options.httpPort) || parsed.search !== "" || parsed.hash !== "") return null;
      return url;
    } catch {
      return null;
    }
  };
  const readyDevice = (deviceId: string): boolean => {
    const item = health.get(deviceId);
    return item?.snapshot(deviceId)?.state === "publisher-ready";
  };

  return freeze({
    start: (rawInput) => {
      if (phase === "disposed") return failure("DISPOSED", current());
      if (phase === "starting" || phase === "running" || phase === "stopping") return failure("ALREADY_ACTIVE", current());
      const input = readStartInput(rawInput);
      if (input === null) return failure("INVALID_INPUT", current());
      const host = resolveHost(input.interfaces, input.manualHost);
      if (host === null) return failure("HOST_UNAVAILABLE", transition("failed", HOST_FAILED));

      session += 1;
      const token = session;
      publicHost = host;
      stopRequested = false;
      stopFailed = false;
      emptyHealth();
      transition("starting", null);
      const started = process.start({ executablePath: input.executablePath, httpPort: options.httpPort, webRtcUdpPort: options.webRtcUdpPort, apiPort: options.apiPort, pathPrefix: options.pathPrefix, publicHost: host, mode: options.mode }, { onExit: (event: ProcessExit) => processExit(token, event) });
      if (!started.ok) {
        publicHost = null;
        return failure("MEDIA_PROCESS_FAILED", transition("failed", started.value.diagnostic ?? PROCESS_START_FAILED));
      }
      const monitoring = paths.start();
      if (!monitoring.ok) {
        stopRequested = true;
        process.stop();
        publicHost = null;
        return failure("PATH_MONITOR_FAILED", transition("failed", PATH_FAILED));
      }
      return success(transition("running", null));
    },
    stop: () => {
      if (phase === "disposed") return failure("DISPOSED", current());
      if (phase !== "running" && phase !== "failed" && phase !== "stopping") return failure("NOT_RUNNING", current());
      stopRequested = true;
      stopFailed = false;
      if (phase !== "stopping") transition("stopping", null);

      let firstFailure: MediaCode | null = null;
      const playerResult = player.clear();
      if (!playerResult.ok) firstFailure = "PLAYER_FAILED";
      const pathsResult = paths.stop();
      if (!pathsResult.ok && paths.snapshot().phase === "monitoring") firstFailure ??= "STOP_FAILED";
      const processResult = process.stop();
      if (!processResult.ok && processResult.code !== "NOT_RUNNING") firstFailure ??= "STOP_FAILED";

      if (firstFailure !== null) {
        stopFailed = true;
        return failure(firstFailure, transition("failed", STOP_FAILED));
      }
      if (process.snapshot().phase === "idle") return success(finishIdle());
      return success(current());
    },
    evaluate: async (now) => {
      if (phase === "disposed") return failure("DISPOSED", current());
      if (phase !== "running") return failure("NOT_RUNNING", current());
      if (typeof now !== "number" || !Number.isFinite(now) || now < 0 || (lastNow !== null && now < lastNow)) return failure("INVALID_INPUT", current());
      const token = session;
      let refreshed: Awaited<ReturnType<MediaPathMonitorInstance["refresh"]>>;
      try {
        refreshed = await paths.refresh();
      } catch {
        return failure("EVALUATION_FAILED", current());
      }
      if (token !== session || phase !== "running") return failure("NOT_RUNNING", current());
      if (!refreshed.ok) return failure("PATH_MONITOR_FAILED", transition("failed", refreshed.value.diagnostic ?? PATH_FAILED));
      for (const event of refreshed.value.events) {
        if (event.event === "published") {
          let item = health.get(event.deviceId);
          if (item === undefined || item.snapshot(event.deviceId)?.state === "failed") {
            if (item !== undefined) item.stop(event.deviceId);
            item = WebRtcHealth.create({ publisherTimeoutMs: options.publisherTimeoutMs });
            health.set(event.deviceId, item);
            item.begin(event.deviceId, now);
          }
          item.observe(event.deviceId, "publisher-connected", now);
        } else {
          health.get(event.deviceId)?.observe(event.deviceId, "publisher-disconnected", now);
        }
      }
      for (const [deviceId, item] of health) item.evaluate(now);
      lastNow = now;
      return success(touch());
    },
    publishTarget: (deviceId) => {
      if (phase === "disposed") return failure("DISPOSED", current());
      if (phase !== "running") return failure("NOT_RUNNING", current());
      if (!validDeviceId(deviceId) || publicHost === null) return failure("INVALID_INPUT", current());
      const url = makeUrl("whip", publicHost, deviceId);
      if (url === null) return failure("INVALID_INPUT", current());
      return success(freeze({ kind: "whip" as const, deviceId, url }));
    },
    playback: (deviceId) => {
      if (phase === "disposed") return failure("DISPOSED", current());
      if (phase !== "running") return failure("NOT_RUNNING", current());
      if (!validDeviceId(deviceId)) return failure("INVALID_INPUT", current());
      if (!health.has(deviceId)) return failure("UNKNOWN_DEVICE", current());
      if (!readyDevice(deviceId)) return failure("VIDEO_NOT_READY", current());
      const url = makeUrl("whep", "127.0.0.1", deviceId);
      if (url === null) return failure("INVALID_INPUT", current());
      return success(freeze({ kind: "whep" as const, deviceId, url }));
    },
    selectPlayer: (deviceId) => {
      if (phase === "disposed") return failure("DISPOSED", current());
      if (phase !== "running") return failure("NOT_RUNNING", current());
      if (!validDeviceId(deviceId)) return failure("INVALID_INPUT", current());
      if (!health.has(deviceId)) return failure("UNKNOWN_DEVICE", current());
      if (!readyDevice(deviceId)) return failure("VIDEO_NOT_READY", current());
      const url = makeUrl("whep", "127.0.0.1", deviceId);
      if (url === null) return failure("INVALID_INPUT", current());
      const selected = player.select({ deviceId, target: { kind: "whep", url } });
      if (!selected.ok) return failure("PLAYER_FAILED", touch());
      return success(touch());
    },
    clearPlayer: () => {
      if (phase === "disposed") return failure("DISPOSED", current());
      const cleared = player.clear();
      if (!cleared.ok) return failure("PLAYER_FAILED", touch());
      return success(touch());
    },
    snapshot: current,
    dispose: () => {
      if (phase === "disposed") return;
      session += 1;
      stopRequested = true;
      stopFailed = true;
      player.clear();
      paths.stop();
      process.dispose();
      publicHost = null;
      emptyHealth();
      transition("disposed", null);
    }
  });
}

export const WebRtcMedia = freeze({ create });
