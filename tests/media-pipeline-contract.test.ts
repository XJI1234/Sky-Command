import { describe, expect, it } from "vitest";
import { MediaPipeline } from "../src/modules/media-pipeline/index.js";

const input = {
  interfaces: [{ name: "Wi-Fi", enabled: true, internal: false, kind: "wifi", ipv4: "192.168.1.8" }],
  manualHost: null,
  hlsRootDirectory: "C:/private/hls",
};

function fixture(options: {
  readonly hlsStart?: () => void;
  readonly rtmpStart?: (port: number, events: { readonly onPublished: (path: string) => void; readonly onUnpublished: (path: string) => void }) => void;
  readonly hlsStop?: () => void;
  readonly rtmpStop?: () => void;
  readonly player?: { readonly setSource?: (input: Readonly<{ readonly deviceId: string; readonly url: string }>, onFatal: (error: unknown) => void) => void; readonly clear?: () => void };
} = {}) {
  let clock = 100;
  let rtmpEvents: { readonly onPublished: (path: string) => void; readonly onUnpublished: (path: string) => void } | null = null;
  const pipeline = MediaPipeline.create({
    rtmp: { listen: (port, events) => { rtmpEvents = events; options.rtmpStart?.(port, events); }, close: () => options.rtmpStop?.() },
    hls: { listen: () => options.hlsStart?.(), close: () => options.hlsStop?.() },
    player: { setSource: (value, onFatal) => options.player?.setSource?.(value, onFatal), clear: () => options.player?.clear?.() },
    clock: () => clock,
  }, { rtmpPort: 19500, hlsPort: 18080, health: { ingestTimeoutMs: 1_000, playlistTimeoutMs: 1_000 } });
  return { pipeline, events: () => rtmpEvents!, setClock: (value: number) => { clock = value; } };
}

describe("media-pipeline 一级组合根契约", () => {
  it("按固定顺序启动并暴露脱敏端点，不依赖 FFmpeg", () => {
    const calls: string[] = [];
    const { pipeline } = fixture({ hlsStart: () => calls.push("hls"), rtmpStart: () => calls.push("rtmp") });
    expect(pipeline.start(input)).toMatchObject({
      ok: true,
      value: { phase: "running", endpoint: { host: "192.168.1.8", port: 19500, source: "automatic" }, streams: [] },
    });
    expect(calls).toEqual(["hls", "rtmp"]);
    expect(JSON.stringify(pipeline.snapshot())).not.toContain("private");
  });

  it("RTMP 发布后立即标记 HTTP-FLV 可播放，多设备互不影响", () => {
    const { pipeline, events } = fixture();
    pipeline.start(input);
    events().onPublished("/live/phone-a");
    events().onPublished("/live/phone-b");
    expect(pipeline.snapshot().streams).toEqual([
      expect.objectContaining({
        deviceId: "phone-a",
        streamId: "stream-1",
        phase: "ready",
        playbackUrl: "http://127.0.0.1:18080/live/phone-a.flv",
      }),
      expect.objectContaining({
        deviceId: "phone-b",
        streamId: "stream-2",
        phase: "ready",
        playbackUrl: "http://127.0.0.1:18080/live/phone-b.flv",
      }),
    ]);
    expect(pipeline.selectPlayer("phone-a")).toMatchObject({ ok: true, value: { player: { phase: "playing", deviceId: "phone-a" } } });
  });

  it("只清理结束的设备流，且停止时按反向顺序尝试所有服务", () => {
    const calls: string[] = [];
    const { pipeline, events } = fixture({
      hlsStop: () => calls.push("hls"),
      rtmpStop: () => calls.push("rtmp"),
      player: { clear: () => calls.push("player") },
    });
    pipeline.start(input);
    events().onPublished("/live/phone-a");
    events().onPublished("/live/phone-b");
    events().onUnpublished("/live/phone-a");
    expect(pipeline.snapshot().streams.map((stream) => stream.deviceId)).toEqual(["phone-b"]);
    events().onPublished("/live/phone-c");
    expect(pipeline.snapshot().streams.map((stream) => stream.deviceId)).toEqual(["phone-b", "phone-c"]);
    expect(pipeline.stop()).toMatchObject({ ok: true, value: { phase: "idle", streams: [] } });
    expect(calls).toEqual(["player", "rtmp", "hls"]);
  });

  it("任一步启动失败都返回稳定错误并清理已启动服务", () => {
    let hlsClosed = 0;
    const { pipeline } = fixture({
      hlsStart: () => undefined,
      rtmpStart: () => { throw new Error("port secret"); },
      hlsStop: () => { hlsClosed += 1; },
    });
    expect(pipeline.start(input)).toMatchObject({ ok: false, code: "RTMP_START_FAILED", value: { phase: "failed" } });
    expect(hlsClosed).toBe(1);
  });

  it("HTTP 分发启动失败时不启动 RTMP", () => {
    let rtmpStarts = 0;
    const { pipeline } = fixture({
      hlsStart: () => { throw new Error("private root"); },
      rtmpStart: () => { rtmpStarts += 1; },
    });
    expect(pipeline.start(input)).toMatchObject({ ok: false, code: "HLS_START_FAILED", value: { phase: "failed" } });
    expect(rtmpStarts).toBe(0);
  });

  it("拒绝健康时间倒退，并将播放器选源异常转换为稳定错误", () => {
    let throwSource = true;
    const { pipeline, events } = fixture({
      player: { setSource: () => { if (throwSource) throw new Error("private"); } },
    });
    pipeline.start(input);
    events().onPublished("/live/phone-a");
    expect(pipeline.evaluate(-1)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(pipeline.selectPlayer("phone-a")).toMatchObject({ ok: false, code: "PLAYER_FAILED", value: { player: { phase: "failed" } } });
    throwSource = false;
    expect(pipeline.selectPlayer("phone-a")).toMatchObject({ ok: true, value: { player: { phase: "playing" } } });
  });

  it("处置后拒绝操作", () => {
    const { pipeline } = fixture();
    pipeline.start(input);
    pipeline.dispose();
    expect(pipeline.start(input)).toMatchObject({ ok: false, code: "DISPOSED" });
    expect(pipeline.notifyPlaylistReady("phone-a")).toMatchObject({ ok: false, code: "DISPOSED" });
    expect(pipeline.snapshot().phase).toBe("disposed");
  });

  it("未启动时拒绝播放列表通知与选源", () => {
    const { pipeline } = fixture();
    expect(pipeline.notifyPlaylistReady("phone-a")).toMatchObject({ ok: false, code: "NOT_STARTED" });
    expect(pipeline.selectPlayer("phone-a")).toMatchObject({ ok: false, code: "NOT_STARTED" });
  });

  it("拒绝非法启动输入", () => {
    const { pipeline } = fixture();
    expect(pipeline.start(null)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(pipeline.start({ ...input, hlsRootDirectory: " " })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});
