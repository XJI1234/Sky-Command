export type WebRtcHealthState = "awaiting-publisher" | "publisher-ready" | "failed";
export type WebRtcHealthEvent = "publisher-connected" | "publisher-disconnected" | "first-frame-rendered" | "process-exited" | "stop";
export interface WebRtcHealthOptions { readonly publisherTimeoutMs: number; }
export interface HealthSnapshot {
  readonly streamId: string;
  readonly revision: number;
  readonly state: WebRtcHealthState;
  readonly lastEvent: WebRtcHealthEvent | null;
  readonly lastEventAt: number;
  readonly diagnostic: string | null;
}
export interface StopRequest { readonly streamId: string; readonly diagnostic: string; }
export type BeginResult = Readonly<{ readonly ok: true; readonly value: HealthSnapshot }> | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" | "ALREADY_TRACKED" }>;
export type ObserveResult = Readonly<{ readonly ok: true; readonly value: HealthSnapshot }> | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" | "UNKNOWN_STREAM" | "STALE_EVENT" }>;
export type StopResult = Readonly<{ readonly ok: true; readonly value: undefined }> | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" | "UNKNOWN_STREAM" }>;
export type EvaluationResult = Readonly<{ readonly ok: true; readonly value: Readonly<{ readonly snapshots: readonly HealthSnapshot[]; readonly stopRequests: readonly StopRequest[] }> }> | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" }>;
export interface WebRtcHealthInstance {
  readonly begin: (streamId: unknown, now: unknown) => BeginResult;
  readonly observe: (streamId: unknown, event: unknown, now: unknown) => ObserveResult;
  readonly evaluate: (now: unknown) => EvaluationResult;
  readonly stop: (streamId: unknown) => StopResult;
  readonly snapshot: (streamId: unknown) => HealthSnapshot | null;
  readonly snapshots: () => readonly HealthSnapshot[];
}

const NO_PUBLISHER = "未观察到 WHIP 发布。请确认手机端图传和局域网地址。";
const DISCONNECTED = "WebRTC 媒体发布已中断。请检查手机端和局域网连接。";
const PROCESS_EXITED = "MediaMTX 进程异常结束。请检查桌面媒体服务。";
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const failure = <TCode extends string>(code: TCode): Readonly<{ readonly ok: false; readonly code: TCode }> => freeze({ ok: false as const, code });
const success = <T>(value: T): Readonly<{ readonly ok: true; readonly value: T }> => freeze({ ok: true as const, value });
const validStreamId = (value: unknown): value is string =>
  typeof value === "string"
  && value.trim().length > 0
  && value !== "."
  && value !== ".."
  && Array.from(value).length <= 128
  && !/[\\/\p{Cc}]/u.test(value);
const validTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const validEvent = (value: unknown): value is WebRtcHealthEvent => typeof value === "string" && /^(?:publisher-connected|publisher-disconnected|first-frame-rendered|process-exited|stop)$/u.test(value);
const validOptions = (value: unknown): value is WebRtcHealthOptions => {
  if (value === null || typeof value !== "object") return false;
  try {
    const timeout = (value as { readonly publisherTimeoutMs?: unknown }).publisherTimeoutMs;
    return typeof timeout === "number" && Number.isSafeInteger(timeout) && timeout >= 1_000 && timeout <= 60_000;
  } catch {
    return false;
  }
};

interface RecordState {
  readonly streamId: string;
  revision: number;
  state: WebRtcHealthState;
  lastEvent: WebRtcHealthEvent | null;
  lastEventAt: number;
  stageStartedAt: number;
  diagnostic: string | null;
  stopPending: boolean;
}

function snapshot(record: RecordState): HealthSnapshot {
  return freeze({ streamId: record.streamId, revision: record.revision, state: record.state, lastEvent: record.lastEvent, lastEventAt: record.lastEventAt, diagnostic: record.diagnostic });
}

function sortedSnapshots(records: Map<string, RecordState>): readonly HealthSnapshot[] {
  return freeze([...records.values()].sort((left, right) => left.streamId.localeCompare(right.streamId)).map(snapshot));
}

function create(options: WebRtcHealthOptions): WebRtcHealthInstance {
  if (!validOptions(options)) throw new TypeError("Invalid WebRTC health options");
  const records = new Map<string, RecordState>();
  let latestTime = 0;
  const validNow = (value: unknown): value is number => validTime(value) && value >= latestTime;
  const advance = (record: RecordState, now: number, state: WebRtcHealthState, event: WebRtcHealthEvent, diagnostic: string | null, stageStartedAt = record.stageStartedAt): HealthSnapshot => {
    record.revision += 1;
    record.state = state;
    record.lastEvent = event;
    record.lastEventAt = now;
    record.stageStartedAt = stageStartedAt;
    record.diagnostic = diagnostic;
    latestTime = now;
    return snapshot(record);
  };
  const fail = (record: RecordState, now: number, diagnostic: string, event: WebRtcHealthEvent | null): HealthSnapshot => {
    record.revision += 1;
    record.state = "failed";
    record.lastEvent = event;
    if (event !== null) record.lastEventAt = now;
    record.diagnostic = diagnostic;
    record.stopPending = true;
    latestTime = now;
    return snapshot(record);
  };
  const canObserve = (record: RecordState, event: WebRtcHealthEvent): boolean => {
    if (record.state === "failed" || event === "stop") return false;
    if (event === "publisher-connected") return record.state === "awaiting-publisher";
    if (event === "publisher-disconnected") return record.state === "publisher-ready";
    if (event === "first-frame-rendered") return record.state === "publisher-ready";
    return record.state === "awaiting-publisher" || record.state === "publisher-ready";
  };

  return freeze({
    begin: (streamId, now) => {
      if (!validStreamId(streamId) || !validNow(now)) return failure("INVALID_INPUT");
      if (records.has(streamId)) return failure("ALREADY_TRACKED");
      const record: RecordState = { streamId, revision: 1, state: "awaiting-publisher", lastEvent: null, lastEventAt: now, stageStartedAt: now, diagnostic: null, stopPending: false };
      records.set(streamId, record);
      latestTime = now;
      return success(snapshot(record));
    },
    observe: (streamId, event, now) => {
      if (!validStreamId(streamId) || !validEvent(event) || !validNow(now)) return failure("INVALID_INPUT");
      const record = records.get(streamId);
      if (record === undefined) return failure("UNKNOWN_STREAM");
      if (!canObserve(record, event)) return failure("STALE_EVENT");
      if (event === "publisher-connected") return success(advance(record, now, "publisher-ready", event, null, now));
      if (event === "publisher-disconnected") return success(advance(record, now, "awaiting-publisher", event, DISCONNECTED, now));
      if (event === "first-frame-rendered") return success(advance(record, now, "publisher-ready", event, record.diagnostic));
      return success(fail(record, now, PROCESS_EXITED, event));
    },
    evaluate: (now) => {
      if (!validNow(now)) return failure("INVALID_INPUT");
      const stopRequests: StopRequest[] = [];
      for (const record of records.values()) {
        if (record.state === "awaiting-publisher" && now - record.stageStartedAt > options.publisherTimeoutMs) {
          const diagnostic = record.lastEvent === "publisher-disconnected" ? DISCONNECTED : NO_PUBLISHER;
          fail(record, now, diagnostic, null);
        }
        if (record.stopPending) {
          stopRequests.push(freeze({ streamId: record.streamId, diagnostic: record.diagnostic! }));
          record.stopPending = false;
        }
      }
      latestTime = now;
      return success(freeze({ snapshots: sortedSnapshots(records), stopRequests: freeze(stopRequests.sort((left, right) => left.streamId.localeCompare(right.streamId))) }));
    },
    stop: (streamId) => {
      if (!validStreamId(streamId)) return failure("INVALID_INPUT");
      if (!records.delete(streamId)) return failure("UNKNOWN_STREAM");
      return success(undefined);
    },
    snapshot: (streamId) => validStreamId(streamId) && records.has(streamId) ? snapshot(records.get(streamId)!) : null,
    snapshots: () => sortedSnapshots(records)
  });
}

export const WebRtcHealth = freeze({ create });
