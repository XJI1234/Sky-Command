import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DesktopShell } from "../src/production/desktop-shell/index.js";

const source = () => readFileSync(new URL("../src/production/electron-host/launch.ts", import.meta.url), "utf8");

describe("Electron 主进程图传装配（HTTP-FLV 单路径）", () => {
  it("只装配 RTMP→HTTP-FLV，不挂载 WHIP/WHEP 旁路", () => {
    const text = source();
    expect(text).toContain("createMediaPorts");
    expect(text).toContain("httpFlvPort: 18_080");
    expect(text).toContain("rtmpPort: 19_500");
    expect(text).toContain("legacyMediaRequired: true");
    expect(text).toContain("legacyMediaAvailable: true");
    expect(text).toContain('图传服务未能启动。请确认 19500（RTMP）与 18080（HTTP-FLV）未被占用。');
    expect(text).not.toContain("lowLatency:");
    expect(text).not.toContain("createMediaMtxProcessPort");
    expect(text).not.toContain("createWhepPlaybackBridge");
    expect(text).not.toContain("webrtc-player-ready");
    expect(text).not.toContain("discoverFfmpegCandidates");
    expect(text).not.toContain('event: "FFMPEG_NOT_FOUND"');
  });

  it("保留局域网选卡与中继超时", () => {
    const text = source();
    expect(text).toContain("handshakeTimeoutMs: 15_000");
    expect(text).toContain("commandTimeoutMs: 120_000");
    expect(text).toContain("missionTimeoutMs: 600_000");
    expect(text).toContain('ipv4.startsWith("172.20.10.")');
    expect(text).toContain("meshIpv4");
    expect(text).toContain("100.64.0.0/10");
    expect(text).toContain('app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required")');
    expect(text).toContain("relayHint: () => lanCards().map((card) => `ws://${card.ipv4}:${relayPort}/relay`)");
  });

  it("将封存的 WebRTC/WHIP 从生产 UI、IPC 与装配入口完全移除", () => {
    const productionEntrypoints = [
      "src/production/desktop-application/index.ts",
      "src/production/desktop-ui-gateway/index.ts",
      "src/production/desktop-shell/index.ts",
      "src/production/electron-host/preload.cjs",
      "src/production/operator-console/index.ts",
      "src/production/operator-console/renderer/main.ts",
      "src/production/operation-workflow/index.ts",
    ];

    for (const path of productionEntrypoints) {
      expect(readFileSync(join(process.cwd(), path), "utf8")).not.toMatch(/\b(?:webrtc|whip|lowLatency)\b/i);
    }

    expect(Object.keys(DesktopShell.methods)).not.toContain("webrtc-start");
    expect(Object.keys(DesktopShell.methods)).not.toContain("webrtc-stream-start");
    expect(Object.keys(DesktopShell.methods)).toEqual(expect.arrayContaining([
      "stream-start",
      "stream-stop",
      "video-playback",
    ]));
  });
});
