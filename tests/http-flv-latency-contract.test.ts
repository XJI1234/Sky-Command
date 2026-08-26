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

  it("飞行页用 flv.js 在本页播放，并对未出画/画面停住做看门狗恢复", () => {
    const source = renderer();
    const page = html();
    expect(source).toContain("flvjs");
    expect(source).toContain("enableStashBuffer: false");
    expect(source).toContain("chaseLiveEdge");
    expect(source).toContain("playbackUrl(");
    expect(source).toContain("attachVideo(url)");
    expect(source).toContain("softReloadFlv");
    expect(source).toContain("scheduleFlvReattach");
    expect(source).toContain("watchPlaybackStall");
    expect(source).toContain("recoverStuckFlv");
    expect(source).toContain("NO_FRAME_MS");
    expect(source).toContain("STALL_MS");
    expect(source).toContain("video-playback");
    expect(source).not.toContain('from "hls.js"');
    expect(source).not.toContain('invoke("webrtc-refresh")');
    expect(source).not.toContain("图传已在独立窗口播放");
    expect(page).toContain("未就绪时「启动图传」不可点");
    expect(page).toContain("#workspace-flight video");
    expect(page.slice(page.indexOf('id="workspace-flight"'))).toContain('<video id="video"');
  });

  it("同一 HTTP-FLV 地址的轮询不销毁正在播放的 flv.js 实例", () => {
    const source = renderer();
    const attach = source.slice(source.indexOf("const attachVideo"), source.indexOf("const whepTarget"));
    const reuse = attach.indexOf("if (attachedUrl === url && flvPlayer !== null)");
    const closeWhep = attach.indexOf("closeWhep();");

    expect(reuse).toBeGreaterThanOrEqual(0);
    expect(closeWhep).toBeGreaterThan(reuse);
  });
});
