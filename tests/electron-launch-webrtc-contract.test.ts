import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () => readFileSync(new URL("../src/production/electron-host/launch.ts", import.meta.url), "utf8");

describe("Electron 主进程低延迟装配", () => {
  it("使用独立 MediaMTX 端口和端口适配器，并保留旧启动链路", () => {
    const text = source();
    for (const fragment of ["createMediaMtxProcessPort", "createMediaPathPort", "createWhepPlaybackBridge", "const webrtcHttpPort = 8_890", "const webrtcUdpPort = 8_189", "const webrtcApiPort = 9_997", "lowLatency:"]) expect(text).toContain(fragment);
    expect(text).toContain("webRtcUdpPort: webrtcUdpPort");
    expect(text).not.toMatch(/options:\s*\{[^}]*\bwebRtcUdpPort,/u);
    expect(text).toContain("executablePath");
    expect(text).toContain("webrtc-player-ready");
    expect(text).toContain("webrtc-player-fatal");
    expect(text).toContain('await created.value.start()');
    expect(text).toContain("relayHint: () => [`ws://${preferred.ipv4}:${relayPort}/relay`]");
    expect(text).toContain("confirm-${++nextConfirmationId}");
    expect(text).not.toContain("createConfirmationId: () => `confirm-${Date.now()}`");
    expect(text).not.toContain("lanCards().map((card) => `ws://${card.ipv4}:${relayPort}/relay`)");
    expect(text).toContain("handshakeTimeoutMs: 15_000");
    expect(text).toContain('ipv4.startsWith("172.20.10.")');
    expect(text).toContain("return -10");
    expect(text).toContain("commandTimeoutMs: 120_000");
    expect(text).toContain("missionTimeoutMs: 600_000");
  });

  it("旧 FFmpeg 缺失只记录旧链路故障，不阻断 WebRTC 应用启动", () => {
    const text = source();
    expect(text).toContain("legacyMediaRequired: false");
    expect(text).toContain('event: "FFMPEG_NOT_FOUND"');
    expect(text).toContain("hardwareReadiness:");
    expect(text).toContain("legacyMediaAvailable: usableFfmpeg.length > 0");
    expect(text).toContain("sessionStableAfterMs: 15_000");
    expect(text).not.toContain('dialog.showErrorBox("Sky Command", "未找到可用的 FFmpeg');
  });
});
