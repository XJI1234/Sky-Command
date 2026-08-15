export type StreamHealthState = "awaiting-ingest" | "awaiting-playlist" | "ready" | "failed";
export type StreamHealthEvent = "ingest-started" | "transcoder-started" | "playlist-ready" | "transcoder-exited";
export interface StreamHealthOptions {
  readonly ingestTimeoutMs: number;
  readonly playlistTimeoutMs: number;
}
export interface StreamHealthSnapshot {
  readonly streamId: string;
  readonly revision: number;
  readonly state: StreamHealthState;
  readonly lastEventAt: number;
  readonly diagnostic: string | null;
}
export interface StopRequest {
  readonly streamId: string;
  readonly diagnostic: string;
}
export type BeginResult = Readonly<{ readonly ok: true; readonly value: StreamHealthSnapshot }> | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" | "ALREADY_TRACKED" }>;
export type ObserveResult = Readonly<{ readonly ok: true; readonly value: StreamHealthSnapshot }> | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" | "UNKNOWN_STREAM" | "STALE_EVENT" }>;
export type StopResult = Readonly<{ readonly ok: true; readonly value: undefined }> | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" | "UNKNOWN_STREAM" }>;
export type HealthEvaluation = Readonly<{ readonly ok: true; readonly value: Readonly<{ readonly snapshots: readonly StreamHealthSnapshot[]; readonly stopRequests: readonly StopRequest[] }> }> | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" }>;
export interface StreamHealthInstance {
  readonly begin: (streamId: unknown, now: unknown) => BeginResult;
  readonly observe: (streamId: unknown, event: unknown, now: unknown) => ObserveResult;
  readonly evaluate: (now: unknown) => HealthEvaluation;
  readonly stop: (streamId: unknown) => StopResult;
  readonly snapshot: (streamId: unknown) => StreamHealthSnapshot | null;
  readonly snapshots: () => readonly StreamHealthSnapshot[];
}

const INPUT_TIMEOUT = "未收到手机端 RTMP 推流。请确认手机已开始图传，且电脑地址可从局域网访问。";
const PLAYLIST_TIMEOUT = "已收到 RTMP 推流，但转码或本地分片未就绪。请检查转码器和磁盘写入。";
const TRANSCODER_EXITED = "转码进程异常结束。请检查 FFmpeg 与输入流。";

interface RecordState {
  streamId: string;
  revision: number;
  state: StreamHealthState;
  lastEventAt: number;
  stageStartedAt: number;
  diagnostic: string | null;
  stopPending: boolean;
}

function freeze<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }
function validStreamId(value: unknown): value is string { return typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value); }
function validTime(value: unknown): value is number { return Number.isFinite(value); }
function validEvent(value: unknown): value is StreamHealthEvent { return typeof value === "string" && /^(?:ingest-started|transcoder-started|playlist-ready|transcoder-exited)$/.test(value); }
function validOptions(value: StreamHealthOptions): boolean {
  return validTime(value.ingestTimeoutMs) && validTime(value.playlistTimeoutMs) && value.ingestTimeoutMs >= 1_000 && value.ingestTimeoutMs <= 60_000 && value.playlistTimeoutMs >= 1_000 && value.playlistTimeoutMs <= 60_000;
}
function snapshot(record: RecordState): StreamHealthSnapshot {
  return freeze({ streamId: record.streamId, revision: record.revision, state: record.state, lastEventAt: record.lastEventAt, diagnostic: record.diagnostic });
}
function snapshots(records: Map<string, RecordState>): readonly StreamHealthSnapshot[] {
  return freeze([...records.values()].sort((left, right) => left.streamId.localeCompare(right.streamId)).map(snapshot));
}
function failure<TCode extends string>(code: TCode): Readonly<{ readonly ok: false; readonly code: TCode }> { return freeze({ ok: false as const, code }); }
function success<T>(value: T): Readonly<{ readonly ok: true; readonly value: T }> { return freeze({ ok: true as const, value }); }
function accepts(state: StreamHealthState, event: StreamHealthEvent): boolean {
  if (event === "ingest-started") return state === "awaiting-ingest";
  if (event === "transcoder-exited") return state === "awaiting-playlist" || state === "ready";
  return state === "awaiting-playlist";
}

function create(options: StreamHealthOptions): StreamHealthInstance {
  if (!validOptions(options)) throw new TypeError("Invalid stream health options");
  const records = new Map<string, RecordState>();
  let latestTime = 0;
  const canUseTime = (now: unknown): now is number => validTime(now) && now >= latestTime;
  const advance = (record: RecordState, now: number, state: StreamHealthState, diagnostic: string | null, stageStartedAt = record.stageStartedAt): StreamHealthSnapshot => {
    record.revision += 1;
    record.state = state;
    record.lastEventAt = now;
    record.stageStartedAt = stageStartedAt;
    record.diagnostic = diagnostic;
    latestTime = now;
    return snapshot(record);
  };
  const fail = (record: RecordState, now: number, diagnostic: string, isEvent: boolean): StreamHealthSnapshot => {
    record.stopPending = true;
    record.revision += 1;
    record.state = "failed";
    if (isEvent) record.lastEventAt = now;
    record.diagnostic = diagnostic;
    latestTime = now;
    return snapshot(record);
  };

  return freeze({
    begin: (streamId, now) => {
      if (!validStreamId(streamId) || !canUseTime(now)) return failure("INVALID_INPUT");
      if (records.has(streamId)) return failure("ALREADY_TRACKED");
      const record: RecordState = { streamId, revision: 1, state: "awaiting-ingest", lastEventAt: now, stageStartedAt: now, diagnostic: null, stopPending: false };
      records.set(streamId, record);
      latestTime = now;
      return success(snapshot(record));
    },
    observe: (streamId, event, now) => {
      if (!validStreamId(streamId) || !validEvent(event) || !canUseTime(now)) return failure("INVALID_INPUT");
      const record = records.get(streamId);
      if (!record) return failure("UNKNOWN_STREAM");
      if (!accepts(record.state, event)) return failure("STALE_EVENT");
      if (event === "ingest-started") return success(advance(record, now, "awaiting-playlist", null, now));
      if (event === "playlist-ready") return success(advance(record, now, "ready", null));
      if (event === "transcoder-exited") return success(fail(record, now, TRANSCODER_EXITED, true));
      return success(advance(record, now, "awaiting-playlist", null));
    },
    evaluate: (now) => {
      if (!canUseTime(now)) return failure("INVALID_INPUT");
      const stopRequests: StopRequest[] = [];
      for (const record of records.values()) {
        const timeout = record.state === "awaiting-ingest" ? options.ingestTimeoutMs : record.state === "awaiting-playlist" ? options.playlistTimeoutMs : null;
        if (timeout !== null && now - record.stageStartedAt > timeout) fail(record, now, record.state === "awaiting-ingest" ? INPUT_TIMEOUT : PLAYLIST_TIMEOUT, false);
        if (record.stopPending) {
          stopRequests.push(freeze({ streamId: record.streamId, diagnostic: record.diagnostic! }));
          record.stopPending = false;
        }
      }
      latestTime = now;
      return success(freeze({ snapshots: snapshots(records), stopRequests: freeze(stopRequests.sort((left, right) => left.streamId.localeCompare(right.streamId))) }));
    },
    stop: (streamId) => {
      if (!validStreamId(streamId)) return failure("INVALID_INPUT");
      if (!records.delete(streamId)) return failure("UNKNOWN_STREAM");
      return success(undefined);
    },
    snapshot: (streamId) => validStreamId(streamId) && records.has(streamId) ? snapshot(records.get(streamId)!) : null,
    snapshots: () => snapshots(records)
  });
}

class StreamHealthApi {
  readonly create = create;
}

export const StreamHealth = freeze(new StreamHealthApi());
