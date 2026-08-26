import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mediaPorts = () => readFileSync(new URL("../src/production/electron-host/media-ports.ts", import.meta.url), "utf8");
const renderer = () => readFileSync(new URL("../src/production/operator-console/renderer/main.ts", import.meta.url), "utf8");
const html = () => readFileSync(new URL("../src/production/operator-console/renderer/index.html", import.meta.url), "utf8");
const pipeline = () => readFileSync(new URL("../src/modules/media-pipeline/index.ts", import.meta.url), "utf8");

describe("旧图传本机 HTTP-FLV 播放契约", () => {
  it("手机 RTMP 推流后由本机过滤 HTTP-FLV 播放，不再切 HLS 也不再开 ffplay", () => {
    const source = mediaPorts();
    expect(source).toContain("gop_cache: true");
    expect(source).toContain("NodeRtmpClient");
    expect(source).toContain("keepAvcVideoTag");
    expect(source).toContain("startPull");
    expect(source).toContain("http-flv-ready");
    expect(source).toContain("onPlaylistReady(deviceId)");
    expect(source).not.toContain("ffplay.exe");
    expect(source).not.toContain("NodeHttpServer");
    expect(source).not.toContain("dump_extra");
    expect(source).not.toContain("-hls_segment_type");
    expect(pipeline()).toContain(".flv");
    expect(pipeline()).toContain("/live/");
  });

  it("飞行页用 flv.js 在本页播放，不再提示独立窗口", () => {
    const source = renderer();
    const page = html();
    expect(source).toContain("flvjs");
    expect(source).toContain("enableStashBuffer: false");
    expect(source).toContain("playbackUrl(");
    expect(source).toContain("attachVideo(url)");
    expect(source).toContain("video-playback");
    expect(source).not.toContain("图传已在独立窗口播放");
    expect(page).toContain("左侧会显示实时画面");
    expect(page).toContain("#workspace-flight video");
    expect(page.slice(page.indexOf('id="workspace-flight"'))).toContain('<video id="video"');
  });
});
