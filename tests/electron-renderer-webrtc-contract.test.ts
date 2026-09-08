import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const preload = () => readFileSync(new URL("../src/production/electron-host/preload.cjs", import.meta.url), "utf8");
const renderer = () => readFileSync(new URL("../src/production/operator-console/renderer/main.ts", import.meta.url), "utf8");
const deviceFactSummary = () => readFileSync(new URL("../src/production/operator-console/device-fact-summary/index.ts", import.meta.url), "utf8");
const html = () => readFileSync(new URL("../src/production/operator-console/renderer/index.html", import.meta.url), "utf8");

describe("Electron 生产图传渲染", () => {
  it("preload 与渲染器不再暴露已封存的旁路", () => {
    for (const source of [preload(), renderer()]) expect(source).not.toMatch(/\b(?:webrtc|whip|whep|lowLatency)\b/i);
    expect(preload()).not.toContain("gateway-invoke");
  });

  it("渲染器仍只使用 HTTP-FLV 播放并保留恢复策略", () => {
    const source = renderer();
    expect(source).toContain('bridge().invoke("stream-refresh")');
    expect(source).toContain("flvjs.createPlayer");
    expect(source).toContain("chaseLiveEdge");
    expect(source).toContain("recoverStuckFlv");
    expect(source).toContain("videoTransportStatusRows(connection)");
    expect(source).toContain('statusRow("MSDK 图传观测 [手机 MSDK 图传运行观测]"');
    expect(deviceFactSummary()).toContain("飞行状态尚未确认");
    expect(source).not.toContain("等待手机就绪");
    expect(source).toContain("flightActionLabel");
  });

  it("飞行页只暴露 RTMP 图传按钮，图传状态写在飞行页内", () => {
    const page = html();
    expect(page).not.toContain("video-dock");
    expect(renderer()).not.toContain("video-dock");
    const flight = page.slice(page.indexOf('<main id="workspace-flight"'));
    expect(flight).toContain('id="stream-label"');
    expect(flight).toContain('id="stream-ready"');
    expect(page.indexOf('id="stream-label"')).toBeGreaterThan(page.indexOf('id="workspace-flight"'));
    expect(renderer()).not.toContain("DJI 硬件产品未连接");
    expect(renderer()).not.toContain("DJI 硬件产品状态未知");
    expect(renderer()).not.toContain("ProductKey.KeyConnection");
    expect(renderer()).toContain("streamCanStart");
    expect(renderer()).toContain('button[data-action="stream-start"]');
    expect(page).toContain('<video id="video"');
    expect(page).toContain('data-action="stream-start"');
    expect(page).toContain('data-action="stream-stop"');
    expect(page).toContain('data-action="flight-takeoff"');
    expect(page).not.toContain('data-action="stream-select"');
    expect(page).not.toContain("启动低延迟");
    expect(page).toContain("启动图传要求手机中继、MSDK、AirLink 和主相机均已就绪；DJI 回调、推流状态和实际出画仍需分别确认。");
    expect(renderer()).toContain("图传可请求启动：手机中继、MSDK、AirLink 和主相机均已就绪；发送前会检查电脑接收端，实际推流和出画仍分别确认");
    expect(renderer()).toContain("playVideo");
    expect(renderer()).toContain("flvjs");
    expect(renderer()).toContain("自动播放被拦截，请点一下上方画面");
  });

  it("操作台不提供独立实机预检按钮或 IPC，图传接收条件失败仍展示模块原文", () => {
    expect(html()).not.toContain('data-action="hardware-readiness"');
    expect(html()).not.toContain("实机预检");
    const source = renderer();
    expect(source).not.toContain('"hardware-readiness"');
    expect(source).not.toContain("实机预检");
    expect(source).toContain("HARDWARE_NOT_READY");
    expect(preload()).not.toContain("hardware-readiness");
  });
});
