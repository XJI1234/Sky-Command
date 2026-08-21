import { describe, expect, it } from "vitest";
import { MediaPathMonitor } from "../src/modules/webrtc-media/media-path-monitor/index.js";

function fixture(values: readonly (readonly string[])[], errorAt: number | null = null) {
  let calls = 0;
  const monitor = MediaPathMonitor.create({
    listPaths: async () => {
      const index = calls++;
      if (errorAt === index) throw new Error("secret api path");
      return values[Math.min(index, values.length - 1)] ?? [];
    }
  });
  return { monitor, calls: () => calls };
}

describe("media-path-monitor 契约", () => {
  it("将合法 MediaMTX path 变化转换为发布和断开事件", async () => {
    const { monitor, calls } = fixture([
      ["/live/drone%20a", "/live/drone-b", "/other/drone-c", "/live/bad/path"],
      ["/live/drone-b"],
      []
    ]);
    expect(monitor.snapshot()).toEqual({ phase: "idle", revision: 0, devices: [], diagnostic: null });
    expect(monitor.start()).toMatchObject({ ok: true, value: { phase: "monitoring" } });
    await expect(monitor.refresh()).resolves.toEqual({ ok: true, value: { events: [{ deviceId: "drone a", event: "published" }, { deviceId: "drone-b", event: "published" }], snapshot: { phase: "monitoring", revision: 2, devices: ["drone a", "drone-b"], diagnostic: null } } });
    await expect(monitor.refresh()).resolves.toEqual({ ok: true, value: { events: [{ deviceId: "drone a", event: "unpublished" }], snapshot: { phase: "monitoring", revision: 3, devices: ["drone-b"], diagnostic: null } } });
    await expect(monitor.refresh()).resolves.toEqual({ ok: true, value: { events: [{ deviceId: "drone-b", event: "unpublished" }], snapshot: { phase: "monitoring", revision: 4, devices: [], diagnostic: null } } });
    expect(calls()).toBe(3);
  });

  it("不重复报告稳定路径，并将 API 错误脱敏", async () => {
    const { monitor } = fixture([["/live/drone-a"], ["/live/drone-a"]], 2);
    monitor.start();
    await expect(monitor.refresh()).resolves.toMatchObject({ ok: true, value: { events: [{ deviceId: "drone-a", event: "published" }] } });
    await expect(monitor.refresh()).resolves.toEqual({ ok: true, value: { events: [], snapshot: { phase: "monitoring", revision: 2, devices: ["drone-a"], diagnostic: null } } });
    await expect(monitor.refresh()).resolves.toMatchObject({ ok: false, code: "LIST_FAILED", value: { phase: "failed", devices: [] } });
    expect(JSON.stringify(monitor.snapshot())).not.toContain("secret");
  });

  it("拒绝非法端口、非法生命周期和恶意路径，并支持停止后重新开始", async () => {
    expect(() => MediaPathMonitor.create(null as never)).toThrow();
    expect(() => MediaPathMonitor.create({ listPaths: 1 } as never)).toThrow();
    const { monitor } = fixture([["/live/drone-a"]]);
    await expect(monitor.refresh()).resolves.toMatchObject({ ok: false, code: "NOT_MONITORING" });
    expect(monitor.stop()).toMatchObject({ ok: false, code: "NOT_MONITORING" });
    expect(monitor.start()).toMatchObject({ ok: true });
    expect(monitor.start()).toMatchObject({ ok: false, code: "ALREADY_MONITORING" });
    await monitor.refresh();
    expect(monitor.stop()).toMatchObject({ ok: true, value: { phase: "idle", devices: [] } });
    expect(monitor.stop()).toMatchObject({ ok: false, code: "NOT_MONITORING" });
    expect(monitor.start()).toMatchObject({ ok: true });
    await expect(monitor.refresh()).resolves.toMatchObject({ ok: true, value: { events: [{ deviceId: "drone-a", event: "published" }] } });
  });

  it("拒绝编码后的路径穿越和设备标识分隔符", async () => {
    const { monitor } = fixture([["/live/%2e%2e", "/live/a%2Fb", "/live/drone-a"]]);
    monitor.start();
    await expect(monitor.refresh()).resolves.toMatchObject({ ok: true, value: { events: [{ deviceId: "drone-a", event: "published" }] } });
  });
});
