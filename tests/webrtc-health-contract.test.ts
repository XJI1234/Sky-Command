import { describe, expect, it } from "vitest";
import { WebRtcHealth } from "../src/modules/webrtc-media/webrtc-health/index.js";

const timeoutDiagnostic = "未观察到 WHIP 发布。请确认手机端图传和局域网地址。";
const disconnectDiagnostic = "WebRTC 媒体发布已中断。请检查手机端和局域网连接。";
const processDiagnostic = "MediaMTX 进程异常结束。请检查桌面媒体服务。";

describe("webrtc-health 契约", () => {
  it("区分发布成功、首帧事实和发布断开", () => {
    const health = WebRtcHealth.create({ publisherTimeoutMs: 1_000 });
    expect(health.begin("drone-a", 0)).toMatchObject({ ok: true, value: { state: "awaiting-publisher" } });
    expect(health.observe("drone-a", "publisher-connected", 10)).toMatchObject({ ok: true, value: { state: "publisher-ready", lastEvent: "publisher-connected" } });
    expect(health.observe("drone-a", "first-frame-rendered", 20)).toMatchObject({ ok: true, value: { state: "publisher-ready", lastEvent: "first-frame-rendered" } });
    expect(health.observe("drone-a", "publisher-disconnected", 30)).toMatchObject({ ok: true, value: { state: "awaiting-publisher", lastEvent: "publisher-disconnected", diagnostic: disconnectDiagnostic } });
    expect(health.observe("drone-a", "publisher-connected", 40)).toMatchObject({ ok: true, value: { state: "publisher-ready", diagnostic: null } });
  });

  it("在等待发布超时后只产生一次停止建议", () => {
    const health = WebRtcHealth.create({ publisherTimeoutMs: 1_000 });
    health.begin("drone-a", 0);
    expect(health.evaluate(1_000)).toEqual({ ok: true, value: { snapshots: [health.snapshot("drone-a")], stopRequests: [] } });
    expect(health.evaluate(1_001)).toMatchObject({ ok: true, value: { snapshots: [{ state: "failed", diagnostic: timeoutDiagnostic }], stopRequests: [{ streamId: "drone-a", diagnostic: timeoutDiagnostic }] } });
    expect(health.evaluate(1_002)).toEqual({ ok: true, value: { snapshots: [health.snapshot("drone-a")], stopRequests: [] } });
  });

  it("把 MediaMTX 退出转换为安全失败并隔离设备", () => {
    const health = WebRtcHealth.create({ publisherTimeoutMs: 1_000 });
    health.begin("drone-b", 0);
    health.begin("drone-a", 0);
    health.observe("drone-b", "publisher-connected", 1);
    expect(health.observe("drone-b", "process-exited", 2)).toMatchObject({ ok: true, value: { state: "failed", diagnostic: processDiagnostic } });
    expect(health.observe("drone-b", "publisher-connected", 3)).toEqual({ ok: false, code: "STALE_EVENT" });
    expect(health.evaluate(1_001)).toMatchObject({ ok: true, value: { snapshots: [{ streamId: "drone-a", state: "failed" }, { streamId: "drone-b", state: "failed" }] } });
  });

  it("拒绝非法输入、倒退时间和未知流，并返回冻结副本", () => {
    expect(() => WebRtcHealth.create({ publisherTimeoutMs: 999 })).toThrow();
    expect(() => WebRtcHealth.create({ publisherTimeoutMs: 60_001 })).toThrow();
    const health = WebRtcHealth.create({ publisherTimeoutMs: 1_000 });
    expect(health.begin(" ", 0)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(health.begin(".", 0)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(health.begin("a/b", 0)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(health.begin("a\\b", 0)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(health.begin("drone-a", -1)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(health.begin("1-drone", 0)).toMatchObject({ ok: true, value: { streamId: "1-drone", state: "awaiting-publisher" } });
    expect(health.begin("550e8400-e29b-41d4-a716-446655440000", 0)).toMatchObject({ ok: true, value: { streamId: "550e8400-e29b-41d4-a716-446655440000", state: "awaiting-publisher" } });
    expect(health.begin("drone-a", 0)).toMatchObject({ ok: true });
    expect(health.observe("drone-a", "publisher-connected", -1)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(health.observe("missing", "publisher-connected", 1)).toEqual({ ok: false, code: "UNKNOWN_STREAM" });
    expect(health.observe("drone-a", "unknown", 1)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(health.evaluate(-1)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(Object.isFrozen(health.snapshot("drone-a"))).toBe(true);
    expect(Object.isFrozen(health.snapshots())).toBe(true);
  });
});
