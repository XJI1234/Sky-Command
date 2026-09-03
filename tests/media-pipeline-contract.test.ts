import { describe, expect, it } from "vitest";
import { MediaPipeline } from "../src/modules/media-pipeline/index.js";

const input = {
  interfaces: [{ name: "Wi-Fi", enabled: true, internal: false, kind: "wifi", ipv4: "192.168.1.8" }],
  manualHost: null,
  httpFlvRootDirectory: "C:/private/http-flv",
};

function fixture(options: {
  readonly httpFlvStart?: () => void;
  readonly rtmpStart?: (port: number, events: { readonly onPublished: (path: string) => void; readonly onUnpublished: (path: string) => void }) => void;
  readonly httpFlvStop?: () => void;
  readonly rtmpStop?: () => void;
  readonly endpointHost?: () => unknown;
  readonly useDefaultClock?: boolean;
  readonly player?: { readonly setSource?: (input: Readonly<{ readonly deviceId: string; readonly url: string }>, onFatal: (error: unknown) => void) => void; readonly clear?: () => void };
} = {}) {
  let clock = 100;
  let rtmpEvents: { readonly onPublished: (path: string) => void; readonly onUnpublished: (path: string) => void } | null = null;
  const pipeline = MediaPipeline.create({
    rtmp: { listen: (port, events) => { rtmpEvents = events; options.rtmpStart?.(port, events); }, close: () => options.rtmpStop?.() },
    httpFlv: { listen: () => options.httpFlvStart?.(), close: () => options.httpFlvStop?.() },
    player: { setSource: (value, onFatal) => options.player?.setSource?.(value, onFatal), clear: () => options.player?.clear?.() },
    ...(options.useDefaultClock ? {} : { clock: () => clock }),
    ...(options.endpointHost === undefined ? {} : { resolveEndpointHost: options.endpointHost }),
  }, { rtmpPort: 19500, httpFlvPort: 18080, health: { ingestTimeoutMs: 1_000, playbackTimeoutMs: 1_000 } });
  return { pipeline, events: () => rtmpEvents!, setClock: (value: number) => { clock = value; } };
}

describe("media-pipeline 一级组合根契约", () => {
  it("按固定顺序启动并暴露脱敏端点，不依赖 FFmpeg", () => {
    const calls: string[] = [];
    const { pipeline } = fixture({ httpFlvStart: () => calls.push("http-flv"), rtmpStart: () => calls.push("rtmp") });
    expect(pipeline.start(input)).toMatchObject({
      ok: true,
      value: { phase: "running", endpoint: { host: "192.168.1.8", port: 19500, source: "automatic" }, streams: [] },
    });
    expect(calls).toEqual(["http-flv", "rtmp"]);
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

  it("network switch refreshes only the next RTMP endpoint and preserves an active ingest", () => {
    let currentHost = "10.208.164.188";
    const calls: string[] = [];
    const { pipeline, events } = fixture({
      endpointHost: () => currentHost,
      httpFlvStart: () => calls.push("http-flv"),
      rtmpStart: () => calls.push("rtmp"),
    });
    pipeline.start({ ...input, manualHost: "10.208.164.188" });
    events().onPublished("/live/phone-1");
    currentHost = "172.20.10.12";

    expect(pipeline.snapshot()).toMatchObject({
      endpoint: { host: "172.20.10.12", port: 19500 },
      streams: [expect.objectContaining({ deviceId: "phone-1", phase: "ready" })],
    });
    expect(calls).toEqual(["http-flv", "rtmp"]);
  });

  it("ignores invalid or failed dynamic endpoint probes and keeps the resolved endpoint", () => {
    for (const endpointHost of [
      () => "8.8.8.8",
      () => "999.20.10.12",
      () => { throw new Error("network unavailable"); },
    ]) {
      const { pipeline } = fixture({ endpointHost });
      pipeline.start({ ...input, manualHost: "172.20.10.12" });
      expect(pipeline.snapshot().endpoint).toEqual({ host: "172.20.10.12", port: 19500, source: "manual" });
    }
  });

  it("只清理结束的设备流，且停止时按反向顺序尝试所有服务", () => {
    const calls: string[] = [];
    const { pipeline, events } = fixture({
      httpFlvStop: () => calls.push("http-flv"),
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
    expect(calls).toEqual(["player", "rtmp", "http-flv"]);
  });

  it("图传源失效时立即清空当前播放器，并禁止旧的 RTMP 发布自行恢复", () => {
    const calls: string[] = [];
    const { pipeline, events } = fixture({ player: { clear: () => calls.push("clear") } });
    pipeline.start(input);
    events().onPublished("/live/phone-a");
    expect(pipeline.selectPlayer("phone-a")).toMatchObject({ ok: true, value: { player: { phase: "playing", deviceId: "phone-a" } } });

    expect(pipeline.invalidateStreamSource("phone-a")).toMatchObject({ ok: true, value: {
      streams: [], player: { phase: "idle", deviceId: null },
    } });
    expect(calls).toEqual(["clear"]);
    expect(pipeline.evaluate(200)).toMatchObject({ ok: true, value: { streams: [] } });

    expect(pipeline.allowStreamSource("phone-a")).toMatchObject({ ok: true, value: {
      streams: [expect.objectContaining({ deviceId: "phone-a", phase: "ready" })],
    } });
  });

  it("图传源失效入口对无效输入、播放器失败和已处置媒体安全失败", () => {
    const { pipeline, events } = fixture({ player: { clear: () => { throw new Error("player clear"); } } });
    pipeline.start(input);
    expect(pipeline.invalidateStreamSource(" ")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(pipeline.allowStreamSource(" ")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    events().onPublished("/live/phone-a");
    expect(pipeline.selectPlayer("phone-a")).toMatchObject({ ok: true });
    expect(pipeline.invalidateStreamSource("phone-a")).toMatchObject({ ok: false, code: "PLAYER_FAILED" });
    pipeline.dispose();
    expect(pipeline.invalidateStreamSource("phone-a")).toMatchObject({ ok: false, code: "DISPOSED" });
    expect(pipeline.allowStreamSource("phone-a")).toMatchObject({ ok: false, code: "DISPOSED" });
  });

  it("任一步启动失败都返回稳定错误并清理已启动服务", () => {
    let hlsClosed = 0;
    const { pipeline } = fixture({
      httpFlvStart: () => undefined,
      rtmpStart: () => { throw new Error("port secret"); },
      httpFlvStop: () => { hlsClosed += 1; },
    });
    expect(pipeline.start(input)).toMatchObject({ ok: false, code: "RTMP_START_FAILED", value: { phase: "failed" } });
    expect(hlsClosed).toBe(1);
  });

  it("HTTP 分发启动失败时不启动 RTMP", () => {
    let rtmpStarts = 0;
    const { pipeline } = fixture({
      httpFlvStart: () => { throw new Error("private root"); },
      rtmpStart: () => { rtmpStarts += 1; },
    });
    expect(pipeline.start(input)).toMatchObject({ ok: false, code: "HTTP_FLV_START_FAILED", value: { phase: "failed" } });
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
    expect(pipeline.notifyPlaybackReady("phone-a")).toMatchObject({ ok: false, code: "DISPOSED" });
    expect(pipeline.snapshot().phase).toBe("disposed");
  });

  it("未启动时拒绝可播放通知与选源", () => {
    const { pipeline } = fixture();
    expect(pipeline.notifyPlaybackReady("phone-a")).toMatchObject({ ok: false, code: "NOT_STARTED" });
    expect(pipeline.selectPlayer("phone-a")).toMatchObject({ ok: false, code: "NOT_STARTED" });
  });

  it("拒绝非法启动输入", () => {
    const { pipeline } = fixture();
    expect(pipeline.start(null)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(pipeline.start({ ...input, interfaces: "not-an-array" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(pipeline.start({ ...input, ffmpegCandidates: "not-an-array" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(pipeline.start({ ...input, httpFlvRootDirectory: null })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(pipeline.start({ ...input, httpFlvRootDirectory: " " })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("keeps every media failure recoverable and exposes only deliberate player operations", () => {
    for (const endpointHost of [() => "172.31.255.1", () => "192.168.1.99"]) {
      const { pipeline } = fixture({ endpointHost });
      expect(pipeline.start(input)).toMatchObject({ ok: true, value: { endpoint: { host: endpointHost(), port: 19500, source: "automatic" } } });
    }

    const defaultClock = fixture({ useDefaultClock: true });
    defaultClock.pipeline.start(input);
    defaultClock.events().onPublished("/live/phone-a");
    expect(defaultClock.pipeline.evaluate(Date.now())).toMatchObject({ ok: true });
    expect(defaultClock.pipeline.notifyPlaybackReady("missing")).toMatchObject({ ok: false, code: "UNKNOWN_DEVICE" });
    expect(defaultClock.pipeline.notifyPlaybackReady("phone-a")).toMatchObject({ ok: true });
    expect(defaultClock.pipeline.selectPlayer("missing")).toMatchObject({ ok: false, code: "UNKNOWN_DEVICE" });
    expect(defaultClock.pipeline.clearPlayer()).toMatchObject({ ok: true });
    expect(defaultClock.pipeline.start(input)).toMatchObject({ ok: false, code: "ALREADY_RUNNING" });
    defaultClock.pipeline.dispose();
    defaultClock.pipeline.dispose();
    expect(defaultClock.pipeline.stop()).toMatchObject({ ok: false, code: "DISPOSED" });
    expect(defaultClock.pipeline.evaluate(1)).toMatchObject({ ok: false, code: "DISPOSED" });
    expect(defaultClock.pipeline.selectPlayer("phone-a")).toMatchObject({ ok: false, code: "DISPOSED" });
    expect(defaultClock.pipeline.clearPlayer()).toMatchObject({ ok: false, code: "DISPOSED" });

    const idle = fixture();
    expect(idle.pipeline.stop()).toMatchObject({ ok: false, code: "NOT_STARTED" });
    expect(idle.pipeline.evaluate(1)).toMatchObject({ ok: false, code: "NOT_STARTED" });
    expect(idle.pipeline.evaluate(Number.NaN)).toMatchObject({ ok: false, code: "NOT_STARTED" });
    const invalidEndpoint = fixture();
    expect(invalidEndpoint.pipeline.start({ ...input, interfaces: [{ ...input.interfaces[0], ipv4: "8.8.8.8" }] })).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    const rtmpStopFailure = fixture({ rtmpStop: () => { throw new Error("rtmp stop"); } });
    rtmpStopFailure.pipeline.start(input);
    expect(rtmpStopFailure.pipeline.stop()).toMatchObject({ ok: false, code: "RTMP_STOP_FAILED" });
    const rtmpStartFailureWithUnstoppedHttpFlv = fixture({ rtmpStart: () => { throw new Error("rtmp start"); }, httpFlvStop: () => { throw new Error("http flv stop"); } });
    expect(rtmpStartFailureWithUnstoppedHttpFlv.pipeline.start(input)).toMatchObject({ ok: false, code: "RTMP_START_FAILED" });
    expect(rtmpStartFailureWithUnstoppedHttpFlv.pipeline.start(input)).toMatchObject({ ok: false, code: "ALREADY_RUNNING" });
    const httpFlvStopFailure = fixture({ httpFlvStop: () => { throw new Error("http flv stop"); } });
    httpFlvStopFailure.pipeline.start(input);
    expect(httpFlvStopFailure.pipeline.stop()).toMatchObject({ ok: false, code: "HTTP_FLV_STOP_FAILED" });
    const playerFailure = fixture({ player: { clear: () => { throw new Error("player clear"); } } });
    playerFailure.pipeline.start(input);
    expect(playerFailure.pipeline.clearPlayer()).toMatchObject({ ok: false, code: "PLAYER_FAILED" });
    expect(playerFailure.pipeline.stop()).toMatchObject({ ok: false, code: "PLAYER_FAILED" });

    const invalidTime = fixture();
    invalidTime.pipeline.start(input);
    expect(invalidTime.pipeline.evaluate(Number.NaN)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});
