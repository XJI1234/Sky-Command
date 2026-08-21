import type { MediaSnapshot, WebRtcMediaInstance } from "../../modules/webrtc-media/index.js";
import type { WhipDispatchSnapshot, WhipDispatchResult, WhipStreamControlInstance } from "../../modules/whip-stream-control/index.js";

export interface LowLatencyMediaDependencies {
  readonly media: WebRtcMediaInstance;
  readonly control: WhipStreamControlInstance;
  readonly startInput: unknown;
}

export interface LowLatencySnapshot {
  readonly media: MediaSnapshot;
  readonly streams: readonly WhipDispatchSnapshot[];
}

export type LowLatencyResult =
  | Readonly<{ readonly ok: true; readonly value: LowLatencySnapshot }>
  | Readonly<{ readonly ok: false; readonly code: string; readonly value: LowLatencySnapshot; readonly reason?: string }>;

export interface LowLatencyMediaInstance {
  readonly start: () => Promise<LowLatencyResult>;
  readonly stop: () => Promise<LowLatencyResult>;
  readonly refresh: (now: unknown) => Promise<LowLatencyResult>;
  readonly startStream: (deviceId: string) => Promise<LowLatencyResult>;
  readonly stopStream: (deviceId: string) => Promise<LowLatencyResult>;
  readonly selectPlayer: (deviceId: string) => LowLatencyResult;
  readonly clearPlayer: () => LowLatencyResult;
  readonly snapshot: () => LowLatencySnapshot;
  readonly dispose: () => Promise<void>;
}

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";

function validMedia(value: unknown): value is WebRtcMediaInstance {
  if (!record(value)) return false;
  try {
    return typeof value.start === "function"
      && typeof value.stop === "function"
      && typeof value.evaluate === "function"
      && typeof value.selectPlayer === "function"
      && typeof value.clearPlayer === "function"
      && typeof value.snapshot === "function"
      && typeof value.dispose === "function";
  } catch { return false; }
}

function validControl(value: unknown): value is WhipStreamControlInstance {
  if (!record(value)) return false;
  try {
    return typeof value.start === "function"
      && typeof value.stop === "function"
      && typeof value.list === "function";
  } catch { return false; }
}

function create(dependencies: LowLatencyMediaDependencies): LowLatencyMediaInstance {
  if (!validMedia(dependencies?.media) || !validControl(dependencies?.control)) throw new TypeError("Invalid low-latency media dependencies");
  const media = dependencies.media;
  const control = dependencies.control;
  let disposed = false;
  let stopCompleted = false;

  const snapshot = (): LowLatencySnapshot => freeze({ media: media.snapshot(), streams: freeze([...control.list()]) });
  const success = (): LowLatencyResult => freeze({ ok: true as const, value: snapshot() });
  const failure = (code: string, reason?: string): LowLatencyResult => freeze({ ok: false as const, code, value: snapshot(), ...(reason === undefined ? {} : { reason }) });
  const activeDevices = (): string[] => {
    try {
      return control.list().filter((item) => item.phase === "starting" || item.phase === "streaming" || item.phase === "stopping").map((item) => item.deviceId);
    } catch { return []; }
  };
  const stopActiveStreams = async (devices = activeDevices()): Promise<boolean> => {
    let clean = true;
    for (const deviceId of devices) {
      try {
        const result = await control.stop(deviceId);
        if (!result.ok) clean = false;
      } catch { clean = false; }
    }
    return clean;
  };
  const invokeMedia = (action: () => unknown): LowLatencyResult => {
    try {
      const result = action();
      if (record(result) && result.ok === true) return success();
      if (record(result) && typeof result.code === "string") return failure(result.code);
      return failure("DEPENDENCY_FAILURE");
    } catch { return failure("DEPENDENCY_FAILURE"); }
  };

  return freeze({
    start: async () => {
      if (disposed) return failure("DISPOSED");
      if (media.snapshot().phase === "running" || media.snapshot().phase === "starting" || media.snapshot().phase === "stopping") return failure("ALREADY_ACTIVE");
      try {
        const result = media.start(dependencies.startInput);
        if (result.ok) {
          stopCompleted = false;
          return success();
        }
        return failure(result.code);
      } catch { return failure("DEPENDENCY_FAILURE"); }
    },
    stop: async () => {
      if (disposed) return failure("DISPOSED");
      const active = activeDevices();
      const streamsClean = await stopActiveStreams(active);
      if (streamsClean && active.length === 0 && media.snapshot().phase === "idle") {
        stopCompleted = true;
        return success();
      }
      const mediaResult = invokeMedia(() => media.stop());
      stopCompleted = mediaResult.ok;
      if (!streamsClean) return failure("STREAM_STOP_FAILED");
      return mediaResult;
    },
    refresh: async (now) => {
      if (disposed) return failure("DISPOSED");
      try {
        const result = await media.evaluate(now);
        if (result.ok) return success();
        return failure(result.code);
      } catch { return failure("DEPENDENCY_FAILURE"); }
    },
    startStream: async (deviceId) => {
      if (disposed) return failure("DISPOSED");
      try {
        const result = await control.start(deviceId);
        return result.ok ? success() : failure(result.code, result.reason);
      } catch { return failure("DEPENDENCY_FAILURE"); }
    },
    stopStream: async (deviceId) => {
      if (disposed) return failure("DISPOSED");
      try {
        const result: WhipDispatchResult = await control.stop(deviceId);
        return result.ok ? success() : failure(result.code, result.reason);
      } catch { return failure("DEPENDENCY_FAILURE"); }
    },
    selectPlayer: (deviceId) => {
      if (disposed) return failure("DISPOSED");
      return invokeMedia(() => media.selectPlayer(deviceId));
    },
    clearPlayer: () => {
      if (disposed) return failure("DISPOSED");
      return invokeMedia(() => media.clearPlayer());
    },
    snapshot,
    dispose: async () => {
      if (disposed) return;
      if (!stopCompleted) await (async () => {
        await stopActiveStreams();
        try { media.stop(); } catch { /* disposal continues */ }
      })();
      try { media.dispose(); } catch { /* disposal is idempotent */ }
      disposed = true;
    },
  });
}

export const LowLatencyMedia = freeze({ create });
