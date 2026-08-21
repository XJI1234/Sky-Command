export type WhepPlaybackPhase = "idle" | "connecting" | "playing" | "failed";

export interface WhepPlaybackPort {
  readonly setTarget: (
    input: Readonly<{ readonly deviceId: string; readonly url: string }>,
    onReady: () => void,
    onFatalError: (error: unknown) => void
  ) => void;
  readonly clear: () => void;
}

export interface PlaybackTarget {
  readonly kind: "whep";
  readonly url: string;
}

export interface PlaybackSnapshot {
  readonly phase: WhepPlaybackPhase;
  readonly deviceId: string | null;
  readonly revision: number;
  readonly diagnostic: string | null;
}

export type SelectResult =
  | Readonly<{ readonly ok: true; readonly value: PlaybackSnapshot }>
  | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" }>
  | Readonly<{ readonly ok: false; readonly code: "SOURCE_FAILED"; readonly value: PlaybackSnapshot }>;

export type ClearResult =
  | Readonly<{ readonly ok: true; readonly value: PlaybackSnapshot }>
  | Readonly<{ readonly ok: false; readonly code: "CLEAR_FAILED"; readonly value: PlaybackSnapshot }>;

export interface WhepPlaybackInstance {
  readonly select: (input: unknown) => SelectResult;
  readonly clear: () => ClearResult;
  readonly snapshot: () => PlaybackSnapshot;
}

const DIAGNOSTIC = "WHEP 播放器无法建立连接。请检查桌面媒体服务。";

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const success = <T>(value: T): Readonly<{ readonly ok: true; readonly value: T }> => freeze({ ok: true as const, value });
const invalid = (): Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" }> => freeze({ ok: false as const, code: "INVALID_INPUT" });
const failure = <TCode extends string, TValue>(code: TCode, value: TValue): Readonly<{ readonly ok: false; readonly code: TCode; readonly value: TValue }> => freeze({ ok: false as const, code, value });

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function validDeviceId(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && Array.from(value).length <= 128
    && !/[\p{Cc}]/u.test(value);
}

function validPort(value: unknown): value is WhepPlaybackPort {
  if (!record(value)) return false;
  try {
    return typeof value.setTarget === "function" && typeof value.clear === "function";
  } catch {
    return false;
  }
}

function readInput(value: unknown): Readonly<{ readonly deviceId: string; readonly url: string }> | null {
  if (!record(value)) return null;
  try {
    const deviceId = value.deviceId;
    const target = value.target;
    if (!validDeviceId(deviceId) || !record(target) || target.kind !== "whep" || typeof target.url !== "string") return null;
    const url = target.url;
    const encodedDeviceId = encodeURIComponent(deviceId);
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") return null;
    if (parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") return null;
    if (parsed.pathname !== `/live/${encodedDeviceId}/whep`) return null;
    return freeze({ deviceId, url });
  } catch {
    return null;
  }
}

function create(port: WhepPlaybackPort): WhepPlaybackInstance {
  if (!validPort(port)) throw new TypeError("Invalid WHEP playback port");

  let state: PlaybackSnapshot = freeze({ phase: "idle", deviceId: null, revision: 0, diagnostic: null });
  let generation = 0;

  const transition = (phase: WhepPlaybackPhase, deviceId: string | null, diagnostic: string | null): PlaybackSnapshot => {
    state = freeze({ phase, deviceId, revision: state.revision + 1, diagnostic });
    return state;
  };

  const failCurrent = (currentGeneration: number): void => {
    if (currentGeneration !== generation) return;
    if (state.phase !== "connecting" && state.phase !== "playing") return;
    transition("failed", state.deviceId, DIAGNOSTIC);
  };

  return freeze({
    select: (input) => {
      const target = readInput(input);
      if (target === null) return invalid();

      generation += 1;
      const currentGeneration = generation;
      transition("connecting", target.deviceId, null);
      try {
        port.setTarget(
          target,
          () => {
            if (currentGeneration !== generation || state.phase !== "connecting") return;
            transition("playing", target.deviceId, null);
          },
          () => failCurrent(currentGeneration)
        );
      } catch {
        failCurrent(currentGeneration);
        return failure("SOURCE_FAILED", state);
      }
      if (state.phase === "failed") return failure("SOURCE_FAILED", state);
      return success(state);
    },
    clear: () => {
      generation += 1;
      try {
        port.clear();
      } catch {
        return failure("CLEAR_FAILED", transition("failed", null, DIAGNOSTIC));
      }
      return success(transition("idle", null, null));
    },
    snapshot: () => state
  });
}

export const WhepPlayback = freeze({ create });
