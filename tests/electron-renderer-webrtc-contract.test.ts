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
    expect(source).toContain("deviceFactRows(connection)");
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
    expect(renderer()).toContain("飞机未连接");
    expect(renderer()).toContain("飞机状态未知");
    expect(renderer()).toContain("streamCanStart");
    expect(renderer()).toContain('button[data-action="stream-start"]');
    expect(page).toContain('<video id="video"');
    expect(page).toContain('data-action="stream-start"');
    expect(page).toContain('data-action="stream-stop"');
    expect(page).toContain('data-action="flight-takeoff"');
    expect(page).not.toContain('data-action="stream-select"');
    expect(page).not.toContain("启动低延迟");
    expect(page).toContain("未就绪时「启动图传」不可点");
    expect(renderer()).toContain("playVideo");
    expect(renderer()).toContain("flvjs");
    expect(renderer()).toContain("自动播放被拦截，请点一下上方画面");
  });

  it("操作台可显式运行实机预检，并展示开始操作被预检拦住的原因", () => {
    expect(html()).toContain('data-action="hardware-readiness"');
    const source = renderer();
    expect(source).toContain('"hardware-readiness"');
    expect(source).toContain("HARDWARE_NOT_READY");
    expect(source).toContain("实机预检未通过");
  });
});
