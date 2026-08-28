export interface VideoPlayerPort {
  readonly setSource: (input: Readonly<{ readonly deviceId: string; readonly url: string }>, onFatalError: (error: unknown) => void) => void;
  readonly clear: () => void;
}

export interface VideoPlayerSnapshot {
  readonly phase: "idle" | "playing" | "failed";
  readonly deviceId: string | null;
  readonly revision: number;
  readonly diagnostic: string | null;
}

export type SelectResult =
  | Readonly<{ readonly ok: true; readonly value: VideoPlayerSnapshot }>
  | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" | "SOURCE_FAILED"; readonly value: VideoPlayerSnapshot }>;
export type ClearResult =
  | Readonly<{ readonly ok: true; readonly value: VideoPlayerSnapshot }>
  | Readonly<{ readonly ok: false; readonly code: "CLEAR_FAILED"; readonly value: VideoPlayerSnapshot }>;

export interface VideoPlayerInstance {
  readonly select: (input: unknown) => SelectResult;
  readonly clear: () => ClearResult;
  readonly snapshot: () => VideoPlayerSnapshot;
}

interface SourceInput { readonly deviceId: string; readonly url: string; }

const SOURCE_FAILED = "播放器无法加载视频源。请检查图传流与本地图传服务。";
const CLEAR_FAILED = "播放器无法清理当前视频源。请检查播放器状态。";
const FATAL = "播放器报告了致命错误。请检查图传流与本地图传服务。";

function freeze<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }

function validDeviceId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128 && !value.includes("\0");
}

function validUrl(value: unknown): value is string {
  if (typeof value !== "string" || !URL.canParse(value)) return false;
  const url = new URL(value);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username.length > 0 || url.password.length > 0 || url.search.length > 0 || url.hash.length > 0) return false;
  return url.pathname.endsWith(".flv");
}

function sourceInput(value: unknown): SourceInput | null {
  if (value === null || typeof value !== "object") return null;
  const input = value as SourceInput;
  return validDeviceId(input.deviceId) && validUrl(input.url) ? input : null;
}

function validPort(value: unknown): value is VideoPlayerPort {
  if (value === null || typeof value !== "object") return false;
  const port = value as VideoPlayerPort;
  return typeof port.setSource === "function" && typeof port.clear === "function";
}

function snapshot(state: VideoPlayerSnapshot): VideoPlayerSnapshot { return freeze({ ...state }); }

function create(port: VideoPlayerPort): VideoPlayerInstance {
  if (!validPort(port)) throw new TypeError("Invalid video player port");
  let state: VideoPlayerSnapshot = { phase: "idle", deviceId: null, revision: 0, diagnostic: null };
  let generation: object | null = null;
  const transition = (next: Omit<VideoPlayerSnapshot, "revision">): VideoPlayerSnapshot => {
    state = { ...next, revision: state.revision + 1 };
    return snapshot(state);
  };
  const sourceFailure = (): VideoPlayerSnapshot => transition({ phase: "failed", deviceId: state.deviceId, diagnostic: SOURCE_FAILED });

  return freeze({
    snapshot: () => snapshot(state),
    select: (raw) => {
      const input = sourceInput(raw);
      if (input === null) return freeze({ ok: false as const, code: "INVALID_INPUT" as const, value: snapshot(state) });
      const token = freeze({});
      generation = token;
      transition({ phase: "playing", deviceId: input.deviceId, diagnostic: null });
      const onFatalError = (_error: unknown): void => {
        if (generation !== token || state.phase !== "playing") return;
        transition({ phase: "failed", deviceId: state.deviceId, diagnostic: FATAL });
      };
      try {
        port.setSource(freeze({ deviceId: input.deviceId, url: input.url }), onFatalError);
        return freeze({ ok: true as const, value: snapshot(state) });
      } catch {
        sourceFailure();
        return freeze({ ok: false as const, code: "SOURCE_FAILED" as const, value: snapshot(state) });
      }
    },
    clear: () => {
      generation = null;
      try {
        port.clear();
        return freeze({ ok: true as const, value: transition({ phase: "idle", deviceId: null, diagnostic: null }) });
      } catch {
        return freeze({ ok: false as const, code: "CLEAR_FAILED" as const, value: transition({ phase: "failed", deviceId: null, diagnostic: CLEAR_FAILED }) });
      }
    }
  });
}

class VideoPlayerApi { readonly create = create; }
export const VideoPlayer = freeze(new VideoPlayerApi());
