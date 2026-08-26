import { describe, expect, it } from "vitest";
import { MediaPipeline } from "../src/modules/media-pipeline/index.js";
import type { ProcessExit, TranscodeJob } from "../src/modules/media-pipeline/transcode-runner/index.js";

const input = { interfaces: [{ name: "Wi-Fi", enabled: true, internal: false, kind: "wifi", ipv4: "192.168.1.8" }], manualHost: null, hlsRootDirectory: "C:/private/hls", ffmpegCandidates: [{ source: "bundled", executablePath: "C:/private/ffmpeg.exe" }] };

function fixture(options: { readonly executable?: (path: string) => boolean; readonly inspect?: () => void; readonly hlsStart?: () => void; readonly rtmpStart?: (port: number, events: { readonly onPublished: (path: string) => void; readonly onUnpublished: (path: string) => void }) => void; readonly hlsStop?: () => void; readonly rtmpStop?: () => void; readonly player?: { readonly setSource?: (input: Readonly<{ readonly deviceId: string; readonly url: string }>, onFatal: (error: unknown) => void) => void; readonly clear?: () => void } } = {}) {
  let clock = 100;
  let rtmpEvents: { readonly onPublished: (path: string) => void; readonly onUnpublished: (path: string) => void } | null = null;
  const jobs: TranscodeJob[] = [];
  const exits: Array<(event: ProcessExit) => void> = [];
  let terminateCount = 0;
  const pipeline = MediaPipeline.create({
    rtmp: { listen: (port, events) => { rtmpEvents = events; options.rtmpStart?.(port, events); }, close: () => options.rtmpStop?.() },
    hls: { listen: () => options.hlsStart?.(), close: () => options.hlsStop?.() },
    fileFacts: { isExecutableFile: (path) => { options.inspect?.(); return options.executable?.(path) ?? true; } },
    processFactory: () => ({ launch: (job, onExit) => { jobs.push(job); exits.push(onExit); return { terminate: () => { terminateCount += 1; } }; } }),
    player: { setSource: (value, onFatal) => options.player?.setSource?.(value, onFatal), clear: () => options.player?.clear?.() },
    clock: () => clock
  }, { rtmpPort: 19500, hlsPort: 18080, health: { ingestTimeoutMs: 1_000, playlistTimeoutMs: 1_000 } });
  return { pipeline, events: () => rtmpEvents!, jobs, exits, setClock: (value: number) => { clock = value; }, terminateCount: () => terminateCount };
}

describe("media-pipeline 一级组合根契约", () => {
  it("按固定顺序启动并暴露脱敏端点", () => {
    const calls: string[] = [];
    const { pipeline } = fixture({ hlsStart: () => calls.push("hls"), rtmpStart: () => calls.push("rtmp") });
    expect(pipeline.start(input)).toMatchObject({ ok: true, value: { phase: "running", endpoint: { host: "192.168.1.8", port: 19500, source: "automatic" }, streams: [] } });
    expect(calls).toEqual(["hls", "rtmp"]);
    expect(JSON.stringify(pipeline.snapshot())).not.toContain("private");
  });

  it("多设备发布、播放列表就绪和播放器选择互不影响", () => {
    const { pipeline, events, jobs } = fixture();
    pipeline.start(input);
    events().onPublished("/live/phone-a");
    events().onPublished("/live/phone-b");
    expect(jobs).toHaveLength(2);
    expect(pipeline.notifyPlaylistReady("phone-a")).toMatchObject({ ok: true, value: { streams: [{ deviceId: "phone-a", streamId: "stream-1", phase: "ready" }, { deviceId: "phone-b", streamId: "stream-2", phase: "awaiting-playlist" }] } });
    expect(pipeline.selectPlayer("phone-a")).toMatchObject({ ok: true, value: { player: { phase: "playing", deviceId: "phone-a" } } });
  });

  it("只清理结束的设备流，且停止时按反向顺序尝试所有服务", () => {
    const calls: string[] = [];
    const { pipeline, events, terminateCount, jobs } = fixture({ hlsStop: () => calls.push("hls"), rtmpStop: () => calls.push("rtmp"), player: { clear: () => calls.push("player") } });
    pipeline.start(input);
    events().onPublished("/live/phone-a");
    events().onPublished("/live/phone-b");
    events().onUnpublished("/live/phone-a");
    expect(pipeline.snapshot().streams.map((stream) => stream.deviceId)).toEqual(["phone-b"]);
    expect(jobs).toHaveLength(2);
    events().onPublished("/live/phone-c");
    expect(jobs).toHaveLength(3);
    expect(pipeline.stop()).toMatchObject({ ok: true, value: { phase: "idle", streams: [] } });
    expect(calls).toEqual(["player", "rtmp", "hls"]);
    expect(terminateCount()).toBe(3);
  });

  it("任一步启动失败都返回稳定错误并清理已启动服务", () => {
    let hlsClosed = 0;
    const { pipeline } = fixture({ hlsStart: () => undefined, rtmpStart: () => { throw new Error("port secret"); }, hlsStop: () => { hlsClosed += 1; } });
    expect(pipeline.start(input)).toMatchObject({ ok: false, code: "RTMP_START_FAILED", value: { phase: "failed" } });
    expect(hlsClosed).toBe(1);
  });

  it("区分 FFmpeg 缺失、检查异常和 HLS 启动失败，且不错误启动 RTMP", () => {
    const missing = fixture({ executable: () => false }).pipeline;
    expect(missing.start(input)).toMatchObject({ ok: false, code: "FFMPEG_NOT_FOUND", value: { phase: "failed" } });
    const inspection = fixture({ inspect: () => { throw new Error("C:/private/secret"); } }).pipeline;
    expect(inspection.start(input)).toMatchObject({ ok: false, code: "FFMPEG_INSPECTION_FAILED", value: { phase: "failed" } });
    let rtmpStarts = 0;
    const hls = fixture({ hlsStart: () => { throw new Error("private root"); }, rtmpStart: () => { rtmpStarts += 1; } }).pipeline;
    expect(hls.start(input)).toMatchObject({ ok: false, code: "HLS_START_FAILED", value: { phase: "failed" } });
    expect(rtmpStarts).toBe(0);
  });

  it("健康超时请求停止对应转码，播放器故障后可以重新选择", () => {
    const { pipeline, events, setClock, exits, terminateCount } = fixture();
    pipeline.start(input);
    events().onPublished("/live/phone-a");
    setClock(1_101);
    expect(pipeline.evaluate(1_101)).toMatchObject({ ok: true, value: { streams: [{ deviceId: "phone-a", phase: "failed" }] } });
    expect(terminateCount()).toBe(1);
    exits[0]!({ kind: "exited" });
    expect(pipeline.clearPlayer()).toMatchObject({ ok: true, value: { player: { phase: "idle" } } });
  });

  it("拒绝健康时间倒退，并将播放器选源异常转换为稳定错误", () => {
    let throwSource = true;
    const { pipeline, events } = fixture({ player: { setSource: () => { if (throwSource) throw new Error("private"); } } });
    pipeline.start(input);
    events().onPublished("/live/phone-a");
    expect(pipeline.evaluate(-1)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    pipeline.notifyPlaylistReady("phone-a");
    expect(pipeline.selectPlayer("phone-a")).toMatchObject({ ok: false, code: "PLAYER_FAILED", value: { player: { phase: "failed" } } });
    throwSource = false;
    expect(pipeline.selectPlayer("phone-a")).toMatchObject({ ok: true, value: { player: { phase: "playing" } } });
  });

  it("停止过程中的重复停止请求被拒绝且不打断外层清理", () => {
    let pipeline!: ReturnType<typeof MediaPipeline.create>;
    let nested: unknown;
    pipeline = MediaPipeline.create({
      rtmp: { listen: () => undefined, close: () => undefined },
      hls: { listen: () => undefined, close: () => undefined },
      fileFacts: { isExecutableFile: () => true },
      processFactory: () => ({ launch: () => ({ terminate: () => undefined }) }),
      player: { setSource: () => undefined, clear: () => { nested = pipeline.stop(); } }
    }, { rtmpPort: 19500, hlsPort: 18080, health: { ingestTimeoutMs: 1_000, playlistTimeoutMs: 1_000 } });
    pipeline.start(input);
    expect(pipeline.stop()).toMatchObject({ ok: true, value: { phase: "idle" } });
    expect(nested).toMatchObject({ ok: false, code: "NOT_STARTED" });
  });

  it("每次可见状态转换均单调增加修订号", () => {
    const { pipeline } = fixture();
    expect(pipeline.snapshot().revision).toBe(0);
    expect(pipeline.start(input)).toMatchObject({ ok: true, value: { revision: 2 } });
    expect(pipeline.stop()).toMatchObject({ ok: true, value: { revision: 4 } });
  });

  it("转码和播放器当前代次故障只影响关联流或播放器状态", () => {
    let fatal: ((error: unknown) => void) | null = null;
    const { pipeline, events, exits } = fixture({ player: { setSource: (_value, onFatal) => { fatal = onFatal; } } });
    pipeline.start(input);
    events().onPublished("/live/phone-a");
    events().onPublished("/live/phone-b");
    exits[0]!({ kind: "failed" });
    expect(pipeline.snapshot().streams).toEqual(expect.arrayContaining([expect.objectContaining({ deviceId: "phone-a", phase: "failed" }), expect.objectContaining({ deviceId: "phone-b", phase: "awaiting-playlist" })]));
    pipeline.notifyPlaylistReady("phone-b");
    pipeline.selectPlayer("phone-b");
    fatal!(new Error("private HLS URL"));
    expect(pipeline.snapshot().player).toMatchObject({ phase: "failed", deviceId: "phone-b" });
    expect(JSON.stringify(pipeline.snapshot())).not.toContain("private");
  });

  it("停止时即使某个清理失败也会继续后续清理并给出精确失败码", () => {
    const calls: string[] = [];
    const { pipeline } = fixture({ player: { clear: () => calls.push("player") }, rtmpStop: () => { calls.push("rtmp"); throw new Error("secret"); }, hlsStop: () => calls.push("hls") });
    pipeline.start(input);
    expect(pipeline.stop()).toMatchObject({ ok: false, code: "RTMP_STOP_FAILED", value: { phase: "failed" } });
    expect(calls).toEqual(["player", "rtmp", "hls"]);
  });

  it("RTMP 停止失败后保留监听事实，下一次停止会重试而非跳过", () => {
    let fails = true;
    let closes = 0;
    const { pipeline } = fixture({ rtmpStop: () => { closes += 1; if (fails) throw new Error("secret"); } });
    pipeline.start(input);
    expect(pipeline.stop()).toMatchObject({ ok: false, code: "RTMP_STOP_FAILED" });
    fails = false;
    expect(pipeline.stop()).toMatchObject({ ok: true, value: { phase: "idle" } });
    expect(closes).toBe(2);
  });

  it("在 HLS 或播放器清理失败时保留失败状态并且仍可再次启动", () => {
    let hlsFail = true;
    const hls = fixture({ hlsStop: () => { if (hlsFail) throw new Error("secret"); } }).pipeline;
    hls.start(input);
    expect(hls.stop()).toMatchObject({ ok: false, code: "HLS_STOP_FAILED", value: { phase: "failed" } });
    hlsFail = false;
    expect(hls.start(input)).toMatchObject({ ok: false, code: "ALREADY_RUNNING", value: { phase: "failed" } });
    expect(hls.stop()).toMatchObject({ ok: true, value: { phase: "idle" } });
    expect(hls.start(input)).toMatchObject({ ok: true, value: { phase: "running" } });

    let playerFail = true;
    const player = fixture({ player: { clear: () => { if (playerFail) throw new Error("secret"); } } }).pipeline;
    player.start(input);
    expect(player.stop()).toMatchObject({ ok: false, code: "PLAYER_FAILED", value: { phase: "failed" } });
    playerFail = false;
    expect(player.stop()).toMatchObject({ ok: true, value: { phase: "idle" } });
  });

  it("拒绝运行期的无效时间、未就绪播放源和当前播放器清理失败", () => {
    let playerFail = true;
    const { pipeline, events } = fixture({ player: { clear: () => { if (playerFail) throw new Error("secret"); } } });
    pipeline.start(input);
    expect(pipeline.start(input)).toMatchObject({ ok: false, code: "ALREADY_RUNNING" });
    expect(pipeline.evaluate("100" as never)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(pipeline.notifyPlaylistReady(null)).toMatchObject({ ok: false, code: "UNKNOWN_DEVICE" });
    expect(pipeline.selectPlayer("phone-a")).toMatchObject({ ok: false, code: "UNKNOWN_DEVICE" });
    events().onPublished("/live/phone-a");
    expect(pipeline.selectPlayer("phone-a")).toMatchObject({ ok: false, code: "UNKNOWN_DEVICE" });
    expect(pipeline.clearPlayer()).toMatchObject({ ok: false, code: "PLAYER_FAILED" });
    playerFail = false;
    expect(pipeline.clearPlayer()).toMatchObject({ ok: true, value: { phase: "running", player: { phase: "idle" } } });
  });

  it("将转码启动失败安全地局限在对应设备，并忽略重复和迟到发布", () => {
    let launches = 0;
    let receive: { readonly onPublished: (path: string) => void; readonly onUnpublished: (path: string) => void } | null = null;
    const broken = MediaPipeline.create({
      rtmp: { listen: (_port, value) => { receive = value; }, close: () => undefined },
      hls: { listen: () => undefined, close: () => undefined },
      fileFacts: { isExecutableFile: () => true },
      processFactory: () => ({ launch: () => { launches += 1; throw new Error("secret"); } }),
      player: { setSource: () => undefined, clear: () => undefined },
      clock: () => 100
    }, { rtmpPort: 19500, hlsPort: 18080, health: { ingestTimeoutMs: 1_000, playlistTimeoutMs: 1_000 } });
    broken.start(input);
    receive!.onPublished("/live/phone-a");
    receive!.onPublished("/live/phone-a");
    expect(launches).toBe(1);
    expect(broken.snapshot().streams).toEqual([expect.objectContaining({ deviceId: "phone-a", phase: "failed" })]);
  });

  it("将有路径字符的设备标识隔离为安全的内部流标识", () => {
    const { pipeline, events, jobs } = fixture();
    pipeline.start(input);
    events().onPublished("/live/phone%2Fone");
    expect(jobs[0]).toMatchObject({ streamId: "stream-1", outputDirectory: "C:/private/hls/stream-1", inputUrl: "rtmp://127.0.0.1:19500/live/phone%2Fone" });
    expect(pipeline.snapshot().streams).toEqual([expect.objectContaining({ deviceId: "phone/one", streamId: "stream-1" })]);
  });

  it("拒绝非法输入、未知设备和释放后的操作", () => {
    const { pipeline } = fixture();
    expect(pipeline.start(null)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(pipeline.notifyPlaylistReady("missing")).toMatchObject({ ok: false, code: "NOT_STARTED" });
    expect(pipeline.selectPlayer("missing")).toMatchObject({ ok: false, code: "NOT_STARTED" });
    pipeline.evaluate(Infinity);
    pipeline.clearPlayer();
    pipeline.dispose();
    pipeline.dispose();
    expect(pipeline.start(input)).toMatchObject({ ok: false, code: "DISPOSED" });
    expect(pipeline.stop()).toMatchObject({ ok: false, code: "DISPOSED" });
    expect(pipeline.evaluate(1)).toMatchObject({ ok: false, code: "DISPOSED" });
    expect(pipeline.notifyPlaylistReady("missing")).toMatchObject({ ok: false, code: "DISPOSED" });
    expect(pipeline.selectPlayer("missing")).toMatchObject({ ok: false, code: "DISPOSED" });
    expect(pipeline.clearPlayer()).toMatchObject({ ok: false, code: "DISPOSED" });
  });

  it("严格校验启动输入的每一项，不允许缺项或仅空白目录", () => {
    for (const invalid of [1, () => undefined, { ...input, interfaces: {} }, { ...input, interfaces: "x" }, { ...input, manualHost: 1 }, { ...input, hlsRootDirectory: 1 }, { ...input, hlsRootDirectory: " " }, { ...input, ffmpegCandidates: {} }]) {
      expect(fixture().pipeline.start(invalid)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
  });

  it("没有可用端点时不启动任何服务，失败状态可以被显式复位", () => {
    let hlsStarts = 0;
    const { pipeline } = fixture({ hlsStart: () => { hlsStarts += 1; } });
    expect(pipeline.start({ ...input, interfaces: [] })).toMatchObject({ ok: false, code: "INVALID_INPUT", value: { phase: "failed", endpoint: null } });
    expect(hlsStarts).toBe(0);
    expect(pipeline.stop()).toMatchObject({ ok: true, value: { phase: "idle", endpoint: null } });
  });

  it("同步发布会在服务进入运行态后被编排，默认时钟同样可用", () => {
    let receive: { readonly onPublished: (path: string) => void; readonly onUnpublished: (path: string) => void } | null = null;
    const jobs: TranscodeJob[] = [];
    const pipeline = MediaPipeline.create({
      rtmp: { listen: (_port, events) => { receive = events; events.onPublished("/live/phone-a"); }, close: () => undefined },
      hls: { listen: () => undefined, close: () => undefined },
      fileFacts: { isExecutableFile: () => true },
      processFactory: () => ({ launch: (job) => { jobs.push(job); return { terminate: () => undefined }; } }),
      player: { setSource: () => undefined, clear: () => undefined }
    }, { rtmpPort: 19500, hlsPort: 18080, health: { ingestTimeoutMs: 1_000, playlistTimeoutMs: 1_000 } });
    expect(pipeline.start(input)).toMatchObject({ ok: true, value: { streams: [expect.objectContaining({ deviceId: "phone-a" })] } });
    expect(jobs).toHaveLength(1);
    receive!.onPublished("/live/phone-a");
    expect(jobs).toHaveLength(1);
  });

  it("RTMP 启动失败后的 HLS 清理结果决定是否允许新启动", () => {
    let hlsStops = 0;
    let rtmpFails = true;
    const clean = fixture({ rtmpStart: () => { if (rtmpFails) throw new Error("fail"); }, hlsStop: () => { hlsStops += 1; } }).pipeline;
    expect(clean.start(input)).toMatchObject({ ok: false, code: "RTMP_START_FAILED" });
    rtmpFails = false;
    expect(clean.start(input)).toMatchObject({ ok: true, value: { phase: "running" } });
    expect(hlsStops).toBe(1);

    let hlsFailed = true;
    let syncReceive: { readonly onPublished: (path: string) => void; readonly onUnpublished: (path: string) => void } | null = null;
    const rollbackFailure = MediaPipeline.create({
      rtmp: { listen: (_port, events) => { syncReceive = events; events.onPublished("/live/phone-a"); throw new Error("rtmp"); }, close: () => undefined },
      hls: { listen: () => undefined, close: () => { if (hlsFailed) throw new Error("hls"); } },
      fileFacts: { isExecutableFile: () => true },
      processFactory: () => ({ launch: () => ({ terminate: () => undefined }) }),
      player: { setSource: () => undefined, clear: () => undefined },
      clock: () => 100
    }, { rtmpPort: 19500, hlsPort: 18080, health: { ingestTimeoutMs: 1_000, playlistTimeoutMs: 1_000 } });
    expect(rollbackFailure.start(input)).toMatchObject({ ok: false, code: "RTMP_START_FAILED" });
    expect(syncReceive).not.toBeNull();
    hlsFailed = false;
    expect(rollbackFailure.stop()).toMatchObject({ ok: true, value: { phase: "idle" } });

    const retained = fixture({ rtmpStart: () => { throw new Error("fail"); }, hlsStop: () => { throw new Error("retain"); } }).pipeline;
    retained.start(input);
    expect(retained.start(input)).toMatchObject({ ok: false, code: "ALREADY_RUNNING" });
  });

  it("按字典序公开设备流，并在停止后拒绝运行期操作", () => {
    const { pipeline, events } = fixture();
    pipeline.start(input);
    events().onPublished("/live/phone-b");
    events().onPublished("/live/phone-a");
    expect(pipeline.snapshot().streams.map((item) => item.deviceId)).toEqual(["phone-a", "phone-b"]);
    pipeline.stop();
    expect(pipeline.evaluate(1)).toMatchObject({ ok: false, code: "NOT_STARTED" });
    expect(pipeline.notifyPlaylistReady("phone-a")).toMatchObject({ ok: false, code: "NOT_STARTED" });
    expect(pipeline.selectPlayer("phone-a")).toMatchObject({ ok: false, code: "NOT_STARTED" });
  });

  it("健康评估只停止产生请求的流，已就绪的其他流在推流仍在时会重启转码", () => {
    const { pipeline, events, setClock, exits, terminateCount, jobs } = fixture();
    pipeline.start(input);
    events().onPublished("/live/phone-a");
    events().onPublished("/live/phone-b");
    pipeline.notifyPlaylistReady("phone-b");
    setClock(1_101);
    pipeline.evaluate(1_101);
    expect(pipeline.snapshot().streams).toEqual(expect.arrayContaining([expect.objectContaining({ deviceId: "phone-a", phase: "failed" }), expect.objectContaining({ deviceId: "phone-b", phase: "ready" })]));
    expect(terminateCount()).toBe(1);
    const launchesBefore = jobs.length;
    exits[1]!({ kind: "exited" });
    expect(jobs.length).toBeGreaterThan(launchesBefore);
    expect(pipeline.snapshot().streams).toEqual(expect.arrayContaining([expect.objectContaining({ deviceId: "phone-b", phase: "ready" })]));
  });

  it("释放运行实例时停止所有已拥有资源，并且快照修订号变化一次", () => {
    const calls: string[] = [];
    const { pipeline, events } = fixture({ player: { clear: () => calls.push("player") }, rtmpStop: () => calls.push("rtmp"), hlsStop: () => calls.push("hls") });
    pipeline.start(input);
    events().onPublished("/live/phone-a");
    const before = pipeline.snapshot().revision;
    pipeline.dispose();
    expect(pipeline.snapshot()).toMatchObject({ phase: "disposed", revision: before + 1, streams: [] });
    expect(calls).toEqual(["rtmp", "hls", "player"]);
  });

  it("空闲或已释放的实例不会在 dispose 时访问任何服务", () => {
    const calls: string[] = [];
    const idle = MediaPipeline.create({
      rtmp: { listen: () => undefined, close: () => calls.push("rtmp") },
      hls: { listen: () => undefined, close: () => calls.push("hls") },
      fileFacts: { isExecutableFile: () => true },
      processFactory: () => ({ launch: () => ({ terminate: () => undefined }) }),
      player: { setSource: () => undefined, clear: () => calls.push("player") }
    }, { rtmpPort: 19500, hlsPort: 18080, health: { ingestTimeoutMs: 1_000, playlistTimeoutMs: 1_000 } });
    idle.dispose();
    idle.dispose();
    expect(calls).toEqual(["player"]);
  });

  it("快照、结果和迟到 RTMP 回调均为隔离的冻结值", () => {
    const { pipeline, events } = fixture();
    const result = pipeline.start(input);
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.streams)).toBe(true);
    }
    pipeline.stop();
    events().onPublished("/live/late");
    expect(pipeline.snapshot()).toMatchObject({ phase: "idle", streams: [] });
  });
});
