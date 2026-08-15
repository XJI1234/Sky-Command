import { describe, expect, it } from "vitest";
import { StreamHealth } from "../src/modules/media-pipeline/stream-health/index.js";

const INPUT_TIMEOUT = "未收到手机端 RTMP 推流。请确认手机已开始图传，且电脑地址可从局域网访问。";
const PLAYLIST_TIMEOUT = "已收到 RTMP 推流，但转码或本地分片未就绪。请检查转码器和磁盘写入。";
const TRANSCODER_EXITED = "转码进程异常结束。请检查 FFmpeg 与输入流。";

describe("媒体管线 stream-health 契约", () => {
  it("按接收、转码和播放列表事件推进单条流，并只在播放列表就绪后报告 ready", () => {
    const health = StreamHealth.create({ ingestTimeoutMs: 1_000, playlistTimeoutMs: 1_000 });

    expect(health.begin("drone-a", 10)).toEqual({
      ok: true,
      value: { streamId: "drone-a", revision: 1, state: "awaiting-ingest", lastEventAt: 10, diagnostic: null }
    });
    expect(health.observe("drone-a", "ingest-started", 20)).toEqual({
      ok: true,
      value: { streamId: "drone-a", revision: 2, state: "awaiting-playlist", lastEventAt: 20, diagnostic: null }
    });
    expect(health.observe("drone-a", "transcoder-started", 21)).toEqual({
      ok: true,
      value: { streamId: "drone-a", revision: 3, state: "awaiting-playlist", lastEventAt: 21, diagnostic: null }
    });
    expect(health.observe("drone-a", "playlist-ready", 22)).toEqual({
      ok: true,
      value: { streamId: "drone-a", revision: 4, state: "ready", lastEventAt: 22, diagnostic: null }
    });
    expect(health.evaluate(10_000)).toEqual({ ok: true, value: { snapshots: [health.snapshot("drone-a")], stopRequests: [] } });
  });

  it("在输入或播放列表等待超时后只产生一次有诊断的停止建议", () => {
    const health = StreamHealth.create({ ingestTimeoutMs: 1_000, playlistTimeoutMs: 1_000 });
    health.begin("drone-a", 0);
    expect(health.evaluate(1_000)).toEqual({ ok: true, value: { snapshots: [health.snapshot("drone-a")], stopRequests: [] } });
    expect(health.evaluate(1_001)).toEqual({
      ok: true,
      value: {
        snapshots: [{ streamId: "drone-a", revision: 2, state: "failed", lastEventAt: 0, diagnostic: INPUT_TIMEOUT }],
        stopRequests: [{ streamId: "drone-a", diagnostic: INPUT_TIMEOUT }]
      }
    });
    expect(health.evaluate(1_002)).toEqual({ ok: true, value: { snapshots: [health.snapshot("drone-a")], stopRequests: [] } });

    const playlist = StreamHealth.create({ ingestTimeoutMs: 1_000, playlistTimeoutMs: 1_000 });
    playlist.begin("drone-b", 0);
    playlist.observe("drone-b", "ingest-started", 1);
    expect(playlist.evaluate(1_002)).toEqual({
      ok: true,
      value: {
        snapshots: [{ streamId: "drone-b", revision: 3, state: "failed", lastEventAt: 1, diagnostic: PLAYLIST_TIMEOUT }],
        stopRequests: [{ streamId: "drone-b", diagnostic: PLAYLIST_TIMEOUT }]
      }
    });
  });

  it("隔离多条流，忽略过期事件，并将异常退出转为单条流的安全失败", () => {
    const health = StreamHealth.create({ ingestTimeoutMs: 1_000, playlistTimeoutMs: 1_000 });
    health.begin("drone-b", 0);
    health.begin("drone-a", 0);
    health.observe("drone-b", "ingest-started", 1);
    health.observe("drone-b", "playlist-ready", 2);
    expect(health.observe("drone-b", "transcoder-exited", 3)).toEqual({
      ok: true,
      value: { streamId: "drone-b", revision: 4, state: "failed", lastEventAt: 3, diagnostic: TRANSCODER_EXITED }
    });
    expect(health.observe("drone-b", "playlist-ready", 4)).toEqual({ ok: false, code: "STALE_EVENT" });
    expect(health.evaluate(1_001)).toEqual({
      ok: true,
      value: {
        snapshots: [
          { streamId: "drone-a", revision: 2, state: "failed", lastEventAt: 0, diagnostic: INPUT_TIMEOUT },
          { streamId: "drone-b", revision: 4, state: "failed", lastEventAt: 3, diagnostic: TRANSCODER_EXITED }
        ],
        stopRequests: [
          { streamId: "drone-a", diagnostic: INPUT_TIMEOUT },
          { streamId: "drone-b", diagnostic: TRANSCODER_EXITED }
        ]
      }
    });
  });

  it("拒绝非法输入而不改状态，并向调用方只交付冻结副本", () => {
    expect(() => StreamHealth.create({ ingestTimeoutMs: 999, playlistTimeoutMs: 1_000 })).toThrow();
    expect(() => StreamHealth.create({ ingestTimeoutMs: "1000", playlistTimeoutMs: 1_000 } as never)).toThrow();
    expect(() => StreamHealth.create({ ingestTimeoutMs: 1_000, playlistTimeoutMs: 999 })).toThrow();
    expect(() => StreamHealth.create({ ingestTimeoutMs: 60_001, playlistTimeoutMs: 1_000 })).toThrow();
    expect(() => StreamHealth.create({ ingestTimeoutMs: 1_000, playlistTimeoutMs: 60_001 })).toThrow();
    expect(() => StreamHealth.create({ ingestTimeoutMs: 60_000, playlistTimeoutMs: 60_000 })).not.toThrow();
    const health = StreamHealth.create({ ingestTimeoutMs: 1_000, playlistTimeoutMs: 1_000 });
    expect(health.begin("1-drone", 0)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(health.begin("drone-a", -1)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(health.begin("drone-z", Infinity)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(health.begin("drone-z", "1" as never)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(health.begin({ toString: () => "drone-z" } as never, 0)).toEqual({ ok: false, code: "INVALID_INPUT" });
    health.begin("drone-a", 0);
    expect(health.begin("drone-a", 1)).toEqual({ ok: false, code: "ALREADY_TRACKED" });
    expect(health.observe("missing", "ingest-started", 1)).toEqual({ ok: false, code: "UNKNOWN_STREAM" });
    expect(health.observe("drone-a", "unknown" as never, 1)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(health.observe("drone-a", "xplaylist-ready" as never, 1)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(health.observe("drone-a", "playlist-ready-now" as never, 1)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(health.observe("drone-a", { toString: () => "playlist-ready" } as never, 1)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(health.observe("drone-a", "ingest-started", -1)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(health.stop("not valid")).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(health.stop("missing")).toEqual({ ok: false, code: "UNKNOWN_STREAM" });
    expect(health.evaluate(-1)).toEqual({ ok: false, code: "INVALID_INPUT" });

    const snapshot = health.snapshot("drone-a");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(health.snapshots())).toBe(true);
    expect(Object.isFrozen(health.stop("drone-a"))).toBe(true);
    expect(health.snapshot("drone-a")).toBeNull();
  });

  it("不让旧时刻或不符合当前阶段的事件延后超时，并保持多流快照的稳定排序", () => {
    const health = StreamHealth.create({ ingestTimeoutMs: 1_000, playlistTimeoutMs: 1_000 });
    health.begin("drone-b", 0);
    health.begin("drone-a", 1);
    expect(health.snapshots().map((item) => item.streamId)).toEqual(["drone-a", "drone-b"]);
    expect(health.observe("drone-a", "playlist-ready", 2)).toEqual({ ok: false, code: "STALE_EVENT" });
    expect(health.observe("drone-a", "ingest-started", 2)).toMatchObject({ ok: true });
    expect(health.observe("drone-a", "ingest-started", 3)).toEqual({ ok: false, code: "STALE_EVENT" });
    expect(health.observe("drone-a", "transcoder-started", 3)).toMatchObject({ ok: true });
    expect(health.observe("drone-a", "playlist-ready", 4)).toMatchObject({ ok: true });
    expect(health.observe("drone-a", "transcoder-started", 5)).toEqual({ ok: false, code: "STALE_EVENT" });
    expect(health.observe("drone-b", "transcoder-exited", 6)).toEqual({ ok: false, code: "STALE_EVENT" });
    expect(health.observe("drone-b", "ingest-started", 6)).toMatchObject({ ok: true });
    expect(health.observe("drone-b", "transcoder-exited", 7)).toMatchObject({ ok: true, value: { state: "failed" } });
    expect(health.begin("drone-c", 3)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(health.evaluate(3)).toEqual({ ok: false, code: "INVALID_INPUT" });

    const result = health.evaluate(1_005);
    expect(result).toMatchObject({ ok: true, value: { stopRequests: [{ streamId: "drone-b", diagnostic: TRANSCODER_EXITED }] } });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.ok && result.value)).toBe(true);
    expect(Object.isFrozen(result.ok && result.value.stopRequests)).toBe(true);
    expect(Object.isFrozen(result.ok && result.value.stopRequests[0]!)).toBe(true);
    expect(health.snapshot("not valid")).toBeNull();
  });

  it("以收到输入的时刻作为播放列表等待起点，而不是以创建流的时刻计时", () => {
    const health = StreamHealth.create({ ingestTimeoutMs: 1_000, playlistTimeoutMs: 1_000 });
    health.begin("drone-a", 0);
    health.observe("drone-a", "ingest-started", 900);
    expect(health.evaluate(1_500)).toMatchObject({ ok: true, value: { stopRequests: [] } });
  });
});
