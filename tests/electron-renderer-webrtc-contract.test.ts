import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const preload = () => readFileSync(new URL("../src/production/electron-host/preload.cjs", import.meta.url), "utf8");
const renderer = () => readFileSync(new URL("../src/production/operator-console/renderer/main.ts", import.meta.url), "utf8");
const html = () => readFileSync(new URL("../src/production/operator-console/renderer/index.html", import.meta.url), "utf8");

describe("Electron WHEP 播放链路", () => {
  it("preload 只暴露低延迟播放器的固定事件桥", () => {
    const source = preload();
    for (const channel of ["webrtc-player-select", "webrtc-player-clear", "webrtc-player-ready", "webrtc-player-fatal"]) expect(source).toContain(channel);
    expect(source).toContain("onWhepSelect");
    expect(source).toContain("onWhepClear");
    expect(source).toContain("whepReady");
    expect(source).toContain("whepFatal");
    expect(source).not.toContain("gateway-invoke");
  });

  it("渲染器通过 recvonly PeerConnection 完成 WHEP offer/answer，并只在首帧后回报", () => {
    const source = renderer();
    for (const fragment of ["RTCPeerConnection", "recvonly", "createOffer", "application/sdp", "setRemoteDescription", "ontrack", "loadeddata", "whepReady", "whepFatal"]) expect(source).toContain(fragment);
    expect(source).toContain('bridge().invoke("stream-refresh")');
    expect(source).toContain("whepPeer !== null");
    for (const method of ["webrtc-start", "webrtc-stop", "webrtc-refresh", "webrtc-stream-start", "webrtc-stream-stop", "webrtc-stream-select"]) expect(source).toContain(method);
    expect(source).toContain("ANOTHER_VIDEO_TRANSPORT_ACTIVE");
    expect(source).toContain("另一路图传正在使用，请先停止");
    expect(source).toContain("飞行状态尚未确认");
    expect(source).toContain("等待手机就绪");
    expect(source).toContain('read(connection, "sdk") !== "ready"');
    expect(source).not.toContain("value !== \"disconnected\" && read(connection, \"sdk\")");
    expect(source).not.toContain("JSON.stringify(unwrap(");
  });

  it("操作台可显式运行实机预检，并展示开始操作被预检拦住的原因", () => {
    expect(html()).toContain('data-action="hardware-readiness"');
    const source = renderer();
    expect(source).toContain('"hardware-readiness"');
    expect(source).toContain("HARDWARE_NOT_READY");
    expect(source).toContain("实机预检未通过");
  });
});
