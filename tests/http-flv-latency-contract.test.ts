import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mediaPorts = () => readFileSync(new URL("../src/production/electron-host/media-ports.ts", import.meta.url), "utf8");
const renderer = () => readFileSync(new URL("../src/production/operator-console/renderer/main.ts", import.meta.url), "utf8");
const html = () => readFileSync(new URL("../src/production/operator-console/renderer/index.html", import.meta.url), "utf8");
const pipeline = () => readFileSync(new URL("../src/modules/media-pipeline/index.ts", import.meta.url), "utf8");
const launch = () => readFileSync(new URL("../src/production/electron-host/launch.ts", import.meta.url), "utf8");

describe("旧图传本机 HTTP-FLV 播放契约", () => {
  it("手机 RTMP 推流后由本机过滤 HTTP-FLV 播放，不再切 HLS 也不再开 ffplay", () => {
    const source = mediaPorts();
    expect(source).toContain("gop_cache: true");
    expect(source).toContain("NodeFlvSession");
    expect(source).toContain("keepAvcVideoTag");
    expect(source).toContain("filterSeiOnlyWrites");
    expect(source).toContain("直连 NMS 发布会话");
    expect(source).toContain("http-flv-listening");
    expect(source).not.toContain("NodeRtmpClient");
    expect(source).not.toContain("startPull");
    expect(source).not.toContain("dropUntilSync");
    expect(source).not.toContain("waitingDrain");
    expect(source).not.toContain("processFactory");
    expect(source).not.toContain("ffplay.exe");
    expect(source).not.toContain("NodeHttpServer");
    expect(source).not.toContain("-hls_segment_type");
    expect(pipeline()).toContain(".flv");
    expect(pipeline()).toContain("/live/");
    expect(pipeline()).toContain("markReady");
    expect(pipeline()).not.toContain("TranscodeRunner");
    expect(launch()).not.toContain("lowLatency:");
    expect(launch()).not.toContain("discoverFfmpegCandidates");
  });

  it("及时性优先：timeupdate 发现明显积压才跳一次，跳转中和冷却期内不得再 seek", () => {
    const source = renderer();
    const chase = source.slice(source.indexOf("const chaseLiveEdge"), source.indexOf("const scheduleFlvReattach"));
    const start = source.slice(source.indexOf("const startPlaybackWatch"), source.indexOf("const stopPlaybackWatch"));
    const bind = source.slice(source.indexOf("const bindVideoPlayEvents"), source.indexOf("const unbindVideoPlayEvents"));
    const unbind = source.slice(source.indexOf("const unbindVideoPlayEvents"), source.indexOf("const detachVideo"));
    const stall = source.slice(source.indexOf("const watchPlaybackStall"), source.indexOf("const reportPlaybackHealth"));
    const attach = source.slice(source.indexOf("const attachVideo"), source.indexOf("const accepted"));
    const maxLag = Number(/LIVE_EDGE_MAX_LAG_S = ([0-9.]+)/.exec(source)?.[1]);
    const keep = Number(/LIVE_EDGE_KEEP_S = ([0-9.]+)/.exec(source)?.[1]);
    const watchMs = Number(/PLAYBACK_WATCH_MS = ([0-9]+)/.exec(source)?.[1]);
    const cooldown = Number(/LIVE_EDGE_SEEK_COOLDOWN_MS = ([0-9]+)/.exec(source)?.[1]);
    const maxBackward = Number(/LIVE_BACKWARD_MAX_S = ([0-9.]+)/.exec(source)?.[1]);
    const minBackward = Number(/LIVE_BACKWARD_KEEP_S = ([0-9.]+)/.exec(source)?.[1]);

    expect(maxLag).toBeGreaterThanOrEqual(1);
    expect(maxLag).toBeLessThanOrEqual(2);
    expect(keep).toBeGreaterThanOrEqual(0);
    expect(keep).toBeLessThanOrEqual(0.15);
    expect(watchMs).toBeGreaterThanOrEqual(1_000);
    expect(watchMs).toBeLessThanOrEqual(2_000);
    expect(cooldown).toBeGreaterThanOrEqual(1_000);
    expect(maxBackward).toBeGreaterThanOrEqual(3);
    expect(minBackward).toBeGreaterThanOrEqual(1);
    expect(chase).toContain("LIVE_EDGE_MAX_LAG_S");
    expect(chase).toContain("video.seeking");
    expect(chase).toContain("LIVE_EDGE_SEEK_COOLDOWN_MS");
    expect(start).toContain("PLAYBACK_WATCH_MS");
    expect(start).not.toContain("chaseLiveEdge");
    expect(stall).not.toContain("chaseLiveEdge");
    expect(bind).toContain("timeupdate");
    expect(bind).toContain("chaseLiveEdge");
    expect(unbind).toContain("timeupdate");
    expect(attach).toContain("autoCleanupMaxBackwardDuration: LIVE_BACKWARD_MAX_S");
    expect(attach).toContain("autoCleanupMinBackwardDuration: LIVE_BACKWARD_KEEP_S");
  });

  it("附着期间周期性追直播前沿，卸载时停掉看门狗", () => {
    const source = renderer();
    const start = source.slice(source.indexOf("const startPlaybackWatch"), source.indexOf("const stopPlaybackWatch"));
    const stop = source.slice(source.indexOf("const stopPlaybackWatch"), source.indexOf("const chaseLiveEdge"));
    const detach = source.slice(source.indexOf("const detachVideo"), source.indexOf("const playVideo"));
    const attach = source.slice(source.indexOf("const attachVideo"), source.indexOf("const accepted"));

    expect(start).toContain("setInterval");
    expect(start).toContain("watchPlaybackStall");
    expect(stop).toContain("clearInterval");
    expect(detach).toContain("stopPlaybackWatch");
    expect(attach).toContain("startPlaybackWatch");
  });

  it("飞行页用 flv.js 在本页播放，并对未出画/画面停住做看门狗恢复", () => {
    const source = renderer();
    const page = html();
    expect(source).toContain("mpegts");
    expect(source).toContain("mpegts.createPlayer");
    const noFrame = Number(/NO_FRAME_MS = ([0-9_]+)/.exec(source)?.[1]?.replaceAll("_", ""));
    expect(noFrame).toBeGreaterThanOrEqual(20_000);
    expect(source).toContain("hasAudio: false");
    expect(source).toContain("hasVideo: true");
    expect(source).toContain("enableStashBuffer: false");
    expect(source).toContain("chaseLiveEdge");
    expect(source).toContain("playbackUrl(");
    expect(source).toContain("attachVideo(url)");
    expect(source).toContain("softReloadFlv");
    expect(source).toContain("scheduleFlvReattach");
    expect(source).toContain("watchPlaybackStall");
    expect(source).toContain("recoverStuckFlv");
    expect(source).not.toContain("photoHandoff");
    expect(source).not.toContain("画面暂停");
    expect(source).toContain("NO_FRAME_MS");
    expect(source).toContain("STALL_MS");
    expect(source).toContain("video-playback");
    expect(source).not.toContain('from "hls.js"');
    expect(source).not.toContain('invoke("webrtc-refresh")');
    expect(source).not.toContain("图传已在独立窗口播放");
    expect(page).toContain('data-flight-status="stream-reach"');
    expect(page).toContain("#workspace-flight video");
    expect(page.slice(page.indexOf('id="workspace-flight"'))).toContain('<video id="video"');
  });

  it("同一 HTTP-FLV 地址的轮询不销毁正在播放的 flv.js 实例", () => {
    const source = renderer();
    const attach = source.slice(source.indexOf("const attachVideo"), source.indexOf("const accepted"));
    const reuse = attach.indexOf("if (attachedUrl === url && flvPlayer !== null)");
    const detach = attach.indexOf("detachVideo();");

    expect(reuse).toBeGreaterThanOrEqual(0);
    expect(detach).toBeGreaterThan(reuse);
  });

  it("慢速 HTTP-FLV 播放客户端达到写入上限时丢掉直到下一关键帧，不断开会话", () => {
    const source = mediaPorts();

    expect(source).toContain("MAX_FLV_PENDING_BYTES");
    const pendingMatch = /MAX_FLV_PENDING_BYTES = ([0-9_]+)/.exec(source);
    expect(Number(pendingMatch?.[1]?.replaceAll("_", ""))).toBeGreaterThanOrEqual(8 * 1024 * 1024);
    expect(source).toContain("res.writableLength");
    expect(source).toContain("skipUntilKeyframe");
    expect(source).toContain("deliveredSync");
    expect(source).toContain("isAvcSyncTag");
    expect(source).toContain("http-flv-client-backpressure");
    expect(source).not.toContain("res.destroy()");
    expect(source).not.toContain("terminateSlowPlayer");
  });

  it("HTTP-FLV 写出时把无音轨流的 FLV 头标成有视频，避免 flv.js 探测成空轨", () => {
    const source = mediaPorts();
    expect(source).toContain("markFlvHeaderHasVideo");
    expect(source).toContain("chunk[4] |= 0x01");
  });

  it("只为已有 RTMP 发布者创建 HTTP-FLV 播放会话，避免无源请求滞留为 NMS idlePlayers", () => {
    const source = mediaPorts();

    expect(source).toContain("mediaContext.publishers.has");
    expect(source).toContain("HTTP-FLV source is unavailable");
    expect(source).toContain("res.writeHead(404");
  });

  it("FULL_HD HEVC 在交给页面播放器前转成 H.264，AVC 直出不得再进 ffmpeg", () => {
    const source = mediaPorts();
    const filter = source.slice(source.indexOf("function filterSeiOnlyWrites"), source.indexOf("function createRtmpPort"));
    expect(source).toContain("libx264");
    expect(source).toContain("http-flv-hevc-transcode");
    expect(source).toContain("pipe:0");
    expect(source).toContain("pipe:1");
    expect(source).toContain("http-flv-first-video-tag");
    expect(source).toContain("hev1");
    expect(source).toContain("http-flv-publisher-error");
    expect(source).toContain("rtmp-video-error");
    expect(source).toMatch(/payload\[0\]\s*&\s*0x0f/);
    expect(source).not.toContain("if (!decided)");
    expect(filter).not.toMatch(/let transcode = startHevcTranscode/);
    expect(filter).toContain('route = "avc"');
    expect(filter).toContain('route = "hevc"');
    expect(filter).toContain("startHevcTranscode(write, onLog)");
  });

  it("无法按 AVC NAL 切开的大视频包仍送给播放器，只丢掉小的 SEI-only 包", () => {
    const source = mediaPorts();
    const keep = source.slice(source.indexOf("function keepAvcVideoTag"), source.indexOf("function deviceIdFromFlvPath"));
    expect(keep).toContain("payload.length > 64");
  });
});
