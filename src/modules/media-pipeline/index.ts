import { HlsServer, type HlsServerPort } from "./hls-server/index.js";
import { NetworkEndpoint, type InterfaceFact } from "./network-endpoint/index.js";
import { RtmpIngest, type RtmpIngressPort } from "./rtmp-ingest/index.js";
import { StreamHealth, type StreamHealthInstance, type StreamHealthOptions } from "./stream-health/index.js";
import { VideoPlayer, type VideoPlayerPort, type VideoPlayerSnapshot } from "./video-player/index.js";
import type { FileFacts } from "./ffmpeg-locator/index.js";
import type { TranscoderProcessPort } from "./transcode-runner/index.js";
import type { FfmpegCandidate } from "./ffmpeg-locator/index.js";

export interface MediaPipelineDependencies {
  readonly rtmp: RtmpIngressPort;
  readonly hls: HlsServerPort;
  /** 保留字段以兼容旧装配；生产 HTTP-FLV 路径不再定位或启动 FFmpeg。 */
  readonly fileFacts?: FileFacts;
  /** 保留字段以兼容旧装配；生产路径在 RTMP publish 时直接标记可播放，不再启动转码进程。 */
  readonly processFactory?: () => TranscoderProcessPort;
  readonly player: VideoPlayerPort;
  readonly clock?: () => number;
}
export interface MediaPipelineOptions {
  readonly rtmpPort: number;
  /** HTTP-FLV 分发端口（历史字段名 hlsPort，行为已是 FLV）。 */
  readonly hlsPort: number;
  readonly health: StreamHealthOptions;
}
export interface MediaStreamSnapshot {
  readonly deviceId: string;
  readonly streamId: string;
  readonly phase: "awaiting-ingest" | "awaiting-playlist" | "ready" | "failed";
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
  | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" | "ALREADY_RUNNING" | "NOT_STARTED" | "DISPOSED" | "FFMPEG_NOT_FOUND" | "FFMPEG_INSPECTION_FAILED" | "HLS_START_FAILED" | "RTMP_START_FAILED" | "HLS_STOP_FAILED" | "RTMP_STOP_FAILED" | "PLAYER_FAILED" | "UNKNOWN_DEVICE"; readonly value: MediaSnapshot }>;
export interface MediaPipelineInstance {
  readonly start: (input: unknown) => PipelineResult<MediaSnapshot>;
  readonly stop: () => PipelineResult<MediaSnapshot>;
  readonly evaluate: (now: unknown) => PipelineResult<MediaSnapshot>;
  readonly notifyPlaylistReady: (deviceId: unknown) => PipelineResult<MediaSnapshot>;
  readonly selectPlayer: (deviceId: unknown) => PipelineResult<MediaSnapshot>;
  readonly clearPlayer: () => PipelineResult<MediaSnapshot>;
  readonly snapshot: () => MediaSnapshot;
  readonly dispose: () => void;
}

interface StartInput {
  readonly interfaces: readonly InterfaceFact[];
  readonly manualHost: string | null;
  readonly hlsRootDirectory: string;
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
function validInput(value: unknown): value is StartInput {
  if (value === null) return false;
  const raw = value as StartInput;
  if (!Array.isArray(raw.interfaces)) return false;
  if (raw.ffmpegCandidates !== undefined && !Array.isArray(raw.ffmpegCandidates)) return false;
  if (typeof raw.hlsRootDirectory !== "string") return false;
  return raw.hlsRootDirectory.trim().length > 0;
}
function create(dependencies: MediaPipelineDependencies, options: MediaPipelineOptions): MediaPipelineInstance {
  const endpointApi = NetworkEndpoint.create(options.rtmpPort);
  const hls = HlsServer.create(dependencies.hls);
  const player = VideoPlayer.create(dependencies.player);
  let phase: MediaSnapshot["phase"] = "idle";
  let revision = 0;
  let endpoint: MediaSnapshot["endpoint"] = null;
  let diagnostic: string | null = null;
  let nextStreamNumber = 1;
  let hlsListening = false;
  let rtmpListening = false;
  const streams = new Map<string, StreamRecord>();
  const clock = dependencies.clock ?? (() => Date.now());
  const flvUrl = (deviceId: string): string => `http://127.0.0.1:${options.hlsPort}/live/${encodeURIComponent(deviceId)}.flv`;
  const markReady = (record: StreamRecord, deviceId: string): void => {
    record.health.observe(record.streamId, "playlist-ready", clock());
    record.playbackUrl = flvUrl(deviceId);
  };
  const current = (): MediaSnapshot => freeze({ phase, revision, endpoint: endpoint === null ? null : freeze({ ...endpoint }), streams: freeze([...streams].map(([deviceId, record]) => {
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
      if (hlsListening || rtmpListening) return failure("ALREADY_RUNNING", current());
      if (!validInput(raw)) return failure("INVALID_INPUT", current());
      phase = "starting"; revision += 1;
      const resolved = endpointApi.resolve(raw.interfaces, raw.manualHost);
      if (!resolved.ok) return failure("INVALID_INPUT", transition("failed", DIAGNOSTIC));
      endpoint = freeze({ host: resolved.value.host, port: resolved.value.port, source: resolved.value.source });
      const hlsStarted = hls.start({ port: options.hlsPort, rootDirectory: raw.hlsRootDirectory });
      if (!hlsStarted.ok) return failure("HLS_START_FAILED", transition("failed", DIAGNOSTIC));
      hlsListening = true;
      phase = "running";
      const rtmpStarted = rtmpIngest.start(options.rtmpPort);
      if (!rtmpStarted.ok) {
        streams.clear();
        const stopped = hls.stop();
        if (stopped.ok) hlsListening = false;
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
      const hlsResult = hlsListening ? hls.stop() : null;
      if (hlsResult?.ok) hlsListening = false;
      endpoint = null;
      if (rtmpResult !== null && !rtmpResult.ok) return failure("RTMP_STOP_FAILED", transition("failed", DIAGNOSTIC));
      if (hlsResult !== null && !hlsResult.ok) return failure("HLS_STOP_FAILED", transition("failed", DIAGNOSTIC));
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
    notifyPlaylistReady: (deviceId) => {
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
      hls.stop();
      player.clear();
      phase = "disposed";
      revision += 1;
    }
  });
}

class MediaPipelineApi { readonly create = create; }
export const MediaPipeline = freeze(new MediaPipelineApi());
