import { HttpFlvServer, type HttpFlvServerPort } from "./http-flv-server/index.js";
import { NetworkEndpoint, type InterfaceFact } from "./network-endpoint/index.js";
import { RtmpIngest, type RtmpIngressPort } from "./rtmp-ingest/index.js";
import { StreamHealth, type StreamHealthInstance, type StreamHealthOptions } from "./stream-health/index.js";
import { VideoPlayer, type VideoPlayerPort, type VideoPlayerSnapshot } from "./video-player/index.js";
import type { FileFacts } from "./ffmpeg-locator/index.js";
import type { TranscoderProcessPort } from "./transcode-runner/index.js";
import type { FfmpegCandidate } from "./ffmpeg-locator/index.js";

export interface MediaPipelineDependencies {
  readonly rtmp: RtmpIngressPort;
  readonly httpFlv: HttpFlvServerPort;
  /** 保留字段以兼容旧装配；生产 HTTP-FLV 路径不再定位或启动 FFmpeg。 */
  readonly fileFacts?: FileFacts;
  /** 保留字段以兼容旧装配；生产路径在 RTMP publish 时直接标记可播放，不再启动转码进程。 */
  readonly processFactory?: () => TranscoderProcessPort;
  /** 可选的当前 LAN 主机探测。只影响后续 RTMP 目标，绝不重启正在监听或发布的媒体服务。 */
  readonly resolveEndpointHost?: () => unknown;
  readonly player: VideoPlayerPort;
  readonly clock?: () => number;
}
export interface MediaPipelineOptions {
  readonly rtmpPort: number;
  /** HTTP-FLV 分发端口。 */
  readonly httpFlvPort: number;
  readonly health: StreamHealthOptions;
}
export interface MediaStreamSnapshot {
  readonly deviceId: string;
  readonly streamId: string;
  readonly phase: "awaiting-ingest" | "awaiting-playback" | "ready" | "failed";
  readonly playbackUrl: string | null;
  readonly diagnostic: string | null;
}
export interface MediaSnapshot {
  readonly phase: "idle" | "starting" | "running" | "stopping" | "failed" | "disposed";
  readonly revision: number;
  readonly endpoint: Readonly<{ readonly host: string; readonly port: number; readonly source: "manual" | "automatic" }> | null;
  readonly streams: readonly MediaStreamSnapshot[];
  readonly player: VideoPlayerSnapshot;
  readonly diagnostic: string | null;
}
export type PipelineResult<T> =
  | Readonly<{ readonly ok: true; readonly value: T }>
  | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" | "ALREADY_RUNNING" | "NOT_STARTED" | "DISPOSED" | "FFMPEG_NOT_FOUND" | "FFMPEG_INSPECTION_FAILED" | "HTTP_FLV_START_FAILED" | "RTMP_START_FAILED" | "HTTP_FLV_STOP_FAILED" | "RTMP_STOP_FAILED" | "PLAYER_FAILED" | "UNKNOWN_DEVICE"; readonly value: MediaSnapshot }>;
export interface MediaPipelineInstance {
  readonly start: (input: unknown) => PipelineResult<MediaSnapshot>;
  readonly stop: () => PipelineResult<MediaSnapshot>;
  readonly evaluate: (now: unknown) => PipelineResult<MediaSnapshot>;
  readonly notifyPlaybackReady: (deviceId: unknown) => PipelineResult<MediaSnapshot>;
  readonly selectPlayer: (deviceId: unknown) => PipelineResult<MediaSnapshot>;
  readonly clearPlayer: () => PipelineResult<MediaSnapshot>;
  readonly snapshot: () => MediaSnapshot;
  readonly dispose: () => void;
}

interface StartInput {
  readonly interfaces: readonly InterfaceFact[];
  readonly manualHost: string | null;
  readonly httpFlvRootDirectory: string;
  readonly ffmpegCandidates?: readonly FfmpegCandidate[];
}
interface StreamRecord {
  readonly streamId: string;
  readonly deviceId: string;
  readonly health: StreamHealthInstance;
  playbackUrl: string | null;
}

const DIAGNOSTIC = "媒体流水线启动失败。请检查桌面端服务配置。";

function freeze<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }
function success<T>(value: T): PipelineResult<T> { return freeze({ ok: true as const, value }); }
function failure(code: Extract<PipelineResult<never>, { ok: false }>['code'], value: MediaSnapshot): PipelineResult<never> { return freeze({ ok: false as const, code, value }); }
function privateIpv4(value: unknown): value is string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/u.test(value)) return false;
  const parts = value.split(".").map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts as [number, number, number, number];
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}
function validInput(value: unknown): value is StartInput {
  if (value === null) return false;
  const raw = value as StartInput;
  if (!Array.isArray(raw.interfaces)) return false;
  if (raw.ffmpegCandidates !== undefined && !Array.isArray(raw.ffmpegCandidates)) return false;
  if (typeof raw.httpFlvRootDirectory !== "string") return false;
  return raw.httpFlvRootDirectory.trim().length > 0;
}
function create(dependencies: MediaPipelineDependencies, options: MediaPipelineOptions): MediaPipelineInstance {
  const endpointApi = NetworkEndpoint.create(options.rtmpPort);
  const httpFlv = HttpFlvServer.create(dependencies.httpFlv);
  const player = VideoPlayer.create(dependencies.player);
  let phase: MediaSnapshot["phase"] = "idle";
  let revision = 0;
  let endpoint: MediaSnapshot["endpoint"] = null;
  let diagnostic: string | null = null;
  let nextStreamNumber = 1;
  let httpFlvListening = false;
  let rtmpListening = false;
  const streams = new Map<string, StreamRecord>();
  const clock = dependencies.clock ?? (() => Date.now());
  const flvUrl = (deviceId: string): string => `http://127.0.0.1:${options.httpFlvPort}/live/${encodeURIComponent(deviceId)}.flv`;
  const markReady = (record: StreamRecord, deviceId: string): void => {
    record.health.observe(record.streamId, "playback-ready", clock());
    record.playbackUrl = flvUrl(deviceId);
  };
  const currentEndpoint = (): MediaSnapshot["endpoint"] => {
    if (endpoint === null) return null;
    let host: unknown = null;
    try { host = dependencies.resolveEndpointHost?.() ?? null; } catch { host = null; }
    return privateIpv4(host)
      ? freeze({ host, port: endpoint.port, source: "automatic" as const })
      : freeze({ ...endpoint });
  };
  const current = (): MediaSnapshot => freeze({ phase, revision, endpoint: currentEndpoint(), streams: freeze([...streams].map(([deviceId, record]) => {
    const state = record.health.snapshot(record.streamId)!;
    return freeze({ deviceId, streamId: record.streamId, phase: state.state, playbackUrl: record.playbackUrl, diagnostic: state.diagnostic });
  }).sort((a, b) => a.deviceId.localeCompare(b.deviceId))), player: player.snapshot(), diagnostic });
  const transition = (next: MediaSnapshot["phase"], nextDiagnostic: string | null = null): MediaSnapshot => { phase = next; diagnostic = nextDiagnostic; revision += 1; return current(); };
  const syncStreams = (): void => {
    const ingest = rtmpIngest.snapshot();
    for (const stream of ingest.streams) {
      if (stream.phase === "active" && !streams.has(stream.deviceId)) {
        const streamId = `stream-${nextStreamNumber}`;
        nextStreamNumber += 1;
        const streamHealth = StreamHealth.create(options.health);
        streamHealth.begin(streamId, clock());
        streamHealth.observe(streamId, "ingest-started", clock());
        const record: StreamRecord = { streamId, deviceId: stream.deviceId, health: streamHealth, playbackUrl: null };
        streams.set(stream.deviceId, record);
        // HTTP-FLV 适配器在 publish 后即可拉流；不再等待假转码/HLS 播放列表。
        markReady(record, stream.deviceId);
      }
      if (stream.phase === "ended" && streams.has(stream.deviceId)) {
        const record = streams.get(stream.deviceId)!;
        record.health.stop(record.streamId);
        streams.delete(stream.deviceId);
      }
    }
  };
  let rtmpIngest: ReturnType<typeof RtmpIngest.create>;
  const wrappedRtmp: RtmpIngressPort = { listen: (port, events) => dependencies.rtmp.listen(port, { onPublished: (path) => { events.onPublished(path); syncStreams(); }, onUnpublished: (path) => { events.onUnpublished(path); syncStreams(); } }), close: () => dependencies.rtmp.close() };
  rtmpIngest = RtmpIngest.create(wrappedRtmp);
  return freeze({
    snapshot: current,
    start: (raw) => {
      if (phase === "disposed") return failure("DISPOSED", current());
      if (httpFlvListening || rtmpListening) return failure("ALREADY_RUNNING", current());
      if (!validInput(raw)) return failure("INVALID_INPUT", current());
      phase = "starting"; revision += 1;
      const resolved = endpointApi.resolve(raw.interfaces, raw.manualHost);
      if (!resolved.ok) return failure("INVALID_INPUT", transition("failed", DIAGNOSTIC));
      endpoint = freeze({ host: resolved.value.host, port: resolved.value.port, source: resolved.value.source });
      const httpFlvStarted = httpFlv.start({ port: options.httpFlvPort, rootDirectory: raw.httpFlvRootDirectory });
      if (!httpFlvStarted.ok) return failure("HTTP_FLV_START_FAILED", transition("failed", DIAGNOSTIC));
      httpFlvListening = true;
      phase = "running";
      const rtmpStarted = rtmpIngest.start(options.rtmpPort);
      if (!rtmpStarted.ok) {
        streams.clear();
        const stopped = httpFlv.stop();
        if (stopped.ok) httpFlvListening = false;
        return failure("RTMP_START_FAILED", transition("failed", DIAGNOSTIC));
      }
      rtmpListening = true;
      return success(transition("running"));
    },
    stop: () => {
      if (phase === "disposed") return failure("DISPOSED", current());
      if (phase !== "running" && phase !== "failed") return failure("NOT_STARTED", current());
      phase = "stopping"; revision += 1;
      streams.clear();
      const playerResult = player.clear();
      const rtmpResult = rtmpListening ? rtmpIngest.stop() : null;
      if (rtmpResult?.ok) rtmpListening = false;
      const httpFlvResult = httpFlvListening ? httpFlv.stop() : null;
      if (httpFlvResult?.ok) httpFlvListening = false;
      endpoint = null;
      if (rtmpResult !== null && !rtmpResult.ok) return failure("RTMP_STOP_FAILED", transition("failed", DIAGNOSTIC));
      if (httpFlvResult !== null && !httpFlvResult.ok) return failure("HTTP_FLV_STOP_FAILED", transition("failed", DIAGNOSTIC));
      if (!playerResult.ok) return failure("PLAYER_FAILED", transition("failed", DIAGNOSTIC));
      return success(transition("idle"));
    },
    evaluate: (now) => {
      if (phase === "disposed") return failure("DISPOSED", current());
      if (phase !== "running") return failure("NOT_STARTED", current());
      syncStreams();
      if (!Number.isFinite(now)) return failure("INVALID_INPUT", current());
      for (const record of streams.values()) {
        const result = record.health.evaluate(now);
        if (!result.ok) return failure("INVALID_INPUT", current());
      }
      return success(current());
    },
    notifyPlaybackReady: (deviceId) => {
      if (phase === "disposed") return failure("DISPOSED", current());
      if (phase !== "running") return failure("NOT_STARTED", current());
      const record = streams.get(deviceId as string);
      if (record === undefined) return failure("UNKNOWN_DEVICE", current());
      markReady(record, deviceId as string);
      return success(current());
    },
    selectPlayer: (deviceId) => {
      if (phase === "disposed") return failure("DISPOSED", current());
      if (phase !== "running") return failure("NOT_STARTED", current());
      const record = streams.get(deviceId as string);
      if (record === undefined || record.playbackUrl === null) return failure("UNKNOWN_DEVICE", current());
      const selected = player.select({ deviceId: deviceId as string, url: record.playbackUrl });
      return selected.ok ? success(current()) : failure("PLAYER_FAILED", transition("running", selected.value.diagnostic));
    },
    clearPlayer: () => {
      if (phase === "disposed") return failure("DISPOSED", current());
      const cleared = player.clear();
      return cleared.ok ? success(current()) : failure("PLAYER_FAILED", current());
    },
    dispose: () => {
      if (phase === "disposed") return;
      streams.clear();
      rtmpIngest.stop();
      httpFlv.stop();
      player.clear();
      phase = "disposed";
      revision += 1;
    }
  });
}

class MediaPipelineApi { readonly create = create; }
export const MediaPipeline = freeze(new MediaPipelineApi());
