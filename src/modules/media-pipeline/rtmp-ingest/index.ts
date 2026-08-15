export interface RtmpIngressPort {
  readonly listen: (port: number, events: Readonly<{ readonly onPublished: (path: string) => void; readonly onUnpublished: (path: string) => void }>) => void;
  readonly close: () => void;
}

export interface IngestStreamSnapshot { readonly deviceId: string; readonly phase: "active" | "ended"; readonly revision: number; }
export interface RtmpIngestSnapshot { readonly phase: "idle" | "listening" | "failed"; readonly revision: number; readonly port: number | null; readonly streams: readonly IngestStreamSnapshot[]; readonly diagnostic: string | null; }
export type IngestResult = Readonly<{ readonly ok: true; readonly value: RtmpIngestSnapshot }> | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" | "ALREADY_LISTENING" | "LISTEN_FAILED" | "NOT_LISTENING" | "CLOSE_FAILED"; readonly value: RtmpIngestSnapshot }>;
export interface RtmpIngestInstance { readonly start: (port: unknown) => IngestResult; readonly stop: () => IngestResult; readonly snapshot: () => RtmpIngestSnapshot; }

type StreamPhase = IngestStreamSnapshot["phase"];
type Stream = { readonly phase: StreamPhase; readonly revision: number };
type State = Omit<RtmpIngestSnapshot, "streams">;

const LISTEN_FAILED = "无法启动 RTMP 接收服务。请检查端口与桌面端权限。";
const CLOSE_FAILED = "无法停止 RTMP 接收服务。请检查端口与桌面端权限。";

function freeze<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }

function validPort(value: unknown): value is number {
  if (!Number.isSafeInteger(value)) return false;
  const port = value as number;
  return port >= 1024 && port <= 65535;
}

function validDeviceId(value: string): boolean {
  if (value.trim().length === 0) return false;
  if (value.length > 128) return false;
  return !value.includes("\0");
}

function deviceId(path: string): string | null {
  const prefix = "/live/";
  if (!path.startsWith(prefix)) return null;
  const encoded = path.slice(prefix.length);
  try {
    const decoded = decodeURIComponent(encoded);
    if (!validDeviceId(decoded)) return null;
    return encodeURIComponent(decoded) === encoded ? decoded : null;
  } catch { return null; }
}

function validPortAdapter(value: unknown): value is RtmpIngressPort {
  if (value == null) return false;
  const port = value as RtmpIngressPort;
  return typeof port.listen === "function" && typeof port.close === "function";
}

function sortedStreams(streams: ReadonlyMap<string, Stream>): readonly IngestStreamSnapshot[] {
  return freeze([...streams]
    .map(([deviceId, stream]) => freeze({ deviceId, phase: stream.phase, revision: stream.revision }))
    .sort((left, right) => left.deviceId.localeCompare(right.deviceId)));
}

function snapshot(state: State, streams: ReadonlyMap<string, Stream>): RtmpIngestSnapshot {
  return freeze({ ...state, streams: sortedStreams(streams) });
}

function activeStream(previous: Stream | undefined): Stream | null {
  if (previous?.phase === "active") return null;
  return { phase: "active", revision: (previous?.revision ?? 0) + 1 };
}

function endedStream(previous: Stream | undefined): Stream | null {
  if (previous?.phase !== "active") return null;
  return { phase: "ended", revision: previous.revision + 1 };
}

function create(port: RtmpIngressPort): RtmpIngestInstance {
  if (!validPortAdapter(port)) throw new TypeError("Invalid RTMP ingress port");
  let state: State = { phase: "idle", revision: 0, port: null, diagnostic: null };
  let generation: object | null = null;
  const streams = new Map<string, Stream>();
  const current = (): RtmpIngestSnapshot => snapshot(state, streams);
  const transition = (next: Omit<State, "revision">): RtmpIngestSnapshot => {
    state = { ...next, revision: state.revision + 1 };
    return current();
  };
  const update = (path: string, phase: StreamPhase, token: object): void => {
    if (generation !== token) return;
    const id = deviceId(path);
    if (id === null) return;
    const next = phase === "active" ? activeStream(streams.get(id)) : endedStream(streams.get(id));
    if (next === null) return;
    streams.set(id, next);
    transition({ phase: state.phase, port: state.port, diagnostic: state.diagnostic });
  };

  return freeze({
    snapshot: current,
    start: (raw) => {
      if (!validPort(raw)) return freeze({ ok: false as const, code: "INVALID_INPUT" as const, value: current() });
      if (state.phase === "listening") return freeze({ ok: false as const, code: "ALREADY_LISTENING" as const, value: current() });
      const token = freeze({});
      generation = token;
      state = { phase: "listening", revision: state.revision, port: raw, diagnostic: null };
      try {
        port.listen(raw, freeze({ onPublished: (path) => update(path, "active", token), onUnpublished: (path) => update(path, "ended", token) }));
        return freeze({ ok: true as const, value: transition({ phase: "listening", port: raw, diagnostic: null }) });
      } catch {
        generation = null;
        streams.clear();
        return freeze({ ok: false as const, code: "LISTEN_FAILED" as const, value: transition({ phase: "failed", port: null, diagnostic: LISTEN_FAILED }) });
      }
    },
    stop: () => {
      if (state.phase !== "listening") return freeze({ ok: false as const, code: "NOT_LISTENING" as const, value: current() });
      try {
        port.close();
        generation = null;
        streams.clear();
        return freeze({ ok: true as const, value: transition({ phase: "idle", port: null, diagnostic: null }) });
      } catch {
        return freeze({ ok: false as const, code: "CLOSE_FAILED" as const, value: transition({ phase: "listening", port: state.port, diagnostic: CLOSE_FAILED }) });
      }
    }
  });
}

class RtmpIngestApi { readonly create = create; }
export const RtmpIngest = freeze(new RtmpIngestApi());
