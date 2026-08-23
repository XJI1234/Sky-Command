import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mediaPorts = () => readFileSync(new URL("../src/production/electron-host/media-ports.ts", import.meta.url), "utf8");
const renderer = () => readFileSync(new URL("../src/production/operator-console/renderer/main.ts", import.meta.url), "utf8");

describe("旧 HLS 延迟契约", () => {
  it("保留可解码 GOP，并以无转码、无音频的短片段输出 HLS", () => {
    const source = mediaPorts();

    expect(source).toContain("gop_cache: true");
    expect(source).toContain('"-fflags", "nobuffer+discardcorrupt"');
    expect(source).toContain('"-probesize", "32768"');
    expect(source).toContain('"-analyzeduration", "0"');
    expect(source).toContain('"-c:v", "copy"');
    expect(source).toContain('"-an"');
    expect(source).toContain('"-hls_time", "1"');
    expect(source).toContain('"-hls_list_size", "3"');
    expect(source).toContain('"-flush_packets", "1"');
    expect(source).toContain("delete_segments+append_list+independent_segments");
    expect(source).not.toContain('"-c:a", "aac"');
    expect(source).not.toContain("split_by_time");
    expect(source).not.toContain('"-flags", "low_delay"');
  });

  it("以一段同步距离播放经典 HLS，并保留 hls.js 追帧能力", () => {
    const source = renderer();

    expect(source).toContain("lowLatencyMode: true");
    expect(source).toContain("liveSyncDurationCount: 1");
    expect(source).toContain("liveMaxLatencyDurationCount: 4");
    expect(source).toContain("maxLiveSyncPlaybackRate: 1.2");
    expect(source).toContain("maxBufferLength: 4");
    expect(source).toContain("maxMaxBufferLength: 8");
    expect(source).toContain("backBufferLength: 0");
    expect(source).toContain("Hls.Events.ERROR");
    expect(source).toContain("data?.fatal");
    expect(source).toContain("经典图传画面中断，请停止后重试");
    expect(source).toContain("hlsBlocked");
    expect(source).toContain("if (hlsBlocked) return");
    expect(source).toContain("if (!view.playbackReady) hlsBlocked = false");
  });
});
