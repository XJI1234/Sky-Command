export interface HlsServerPort {
  readonly listen: (input: Readonly<{ readonly host: "127.0.0.1"; readonly port: number; readonly rootDirectory: string }>) => void;
  readonly close: () => void;
}

export interface HlsServerSnapshot {
  readonly phase: "idle" | "listening" | "failed";
  readonly revision: number;
  readonly port: number | null;
  readonly diagnostic: string | null;
}

export type StartResult =
  | Readonly<{ readonly ok: true; readonly value: HlsServerSnapshot }>
  | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" | "ALREADY_LISTENING" | "LISTEN_FAILED"; readonly value: HlsServerSnapshot }>;
export type StopResult =
  | Readonly<{ readonly ok: true; readonly value: HlsServerSnapshot }>
  | Readonly<{ readonly ok: false; readonly code: "NOT_LISTENING" | "CLOSE_FAILED"; readonly value: HlsServerSnapshot }>;
export type PlaybackResult =
  | Readonly<{ readonly ok: true; readonly value: Readonly<{ readonly streamId: string; readonly url: string }> }>
  | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" | "NOT_LISTENING"; readonly value: HlsServerSnapshot }>;

export interface HlsServerInstance {
  readonly start: (input: unknown) => StartResult;
  readonly stop: () => StopResult;
  readonly playback: (streamId: unknown) => PlaybackResult;
  readonly snapshot: () => HlsServerSnapshot;
}

interface StartInput { readonly port: number; readonly rootDirectory: string; }

const LISTEN_FAILED = "无法启动本地 HLS 服务。请检查端口与桌面端权限。";
const CLOSE_FAILED = "无法停止本地 HLS 服务。请检查桌面端权限。";

function freeze<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }
function snapshot(value: HlsServerSnapshot): HlsServerSnapshot { return freeze({ ...value }); }
function validText(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function validPort(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 1024 && (value as number) <= 65535; }
function validStreamId(value: unknown): value is string { return validText(value) && value.length <= 128 && !value.includes("\0"); }

function startInput(value: unknown): StartInput | null {
  if (value == null) return null;
  const raw = value as StartInput;
  if (!validPort(raw.port)) return null;
  if (!validText(raw.rootDirectory)) return null;
  return raw;
}

function serverPort(value: unknown): value is HlsServerPort {
  return value != null && typeof (value as HlsServerPort).listen === "function" && typeof (value as HlsServerPort).close === "function";
}

function create(port: HlsServerPort): HlsServerInstance {
  if (!serverPort(port)) throw new TypeError("Invalid HLS server port");
  let state: HlsServerSnapshot = { phase: "idle", revision: 0, port: null, diagnostic: null };

  const transition = (next: Omit<HlsServerSnapshot, "revision">): HlsServerSnapshot => {
    state = { ...next, revision: state.revision + 1 };
    return snapshot(state);
  };

  return freeze({
    snapshot: () => snapshot(state),
    start: (raw) => {
      const input = startInput(raw);
      if (input === null) return freeze({ ok: false as const, code: "INVALID_INPUT" as const, value: snapshot(state) });
      if (state.phase === "listening") return freeze({ ok: false as const, code: "ALREADY_LISTENING" as const, value: snapshot(state) });
      try {
        port.listen(freeze({ host: "127.0.0.1" as const, port: input.port, rootDirectory: input.rootDirectory }));
        return freeze({ ok: true as const, value: transition({ phase: "listening", port: input.port, diagnostic: null }) });
      } catch {
        return freeze({ ok: false as const, code: "LISTEN_FAILED" as const, value: transition({ phase: "failed", port: null, diagnostic: LISTEN_FAILED }) });
      }
    },
    stop: () => {
      if (state.phase !== "listening") return freeze({ ok: false as const, code: "NOT_LISTENING" as const, value: snapshot(state) });
      try {
        port.close();
        return freeze({ ok: true as const, value: transition({ phase: "idle", port: null, diagnostic: null }) });
      } catch {
        return freeze({ ok: false as const, code: "CLOSE_FAILED" as const, value: transition({ phase: "listening", port: state.port, diagnostic: CLOSE_FAILED }) });
      }
    },
    playback: (streamId) => {
      if (!validStreamId(streamId)) return freeze({ ok: false as const, code: "INVALID_INPUT" as const, value: snapshot(state) });
      if (state.phase !== "listening") return freeze({ ok: false as const, code: "NOT_LISTENING" as const, value: snapshot(state) });
      const value = freeze({ streamId, url: `http://127.0.0.1:${state.port}/hls/${encodeURIComponent(streamId)}/index.m3u8` });
      return freeze({ ok: true as const, value });
    }
  });
}

class HlsServerApi { readonly create = create; }
export const HlsServer = freeze(new HlsServerApi());
