import { describe, expect, it, vi } from "vitest";
import { PairingController } from "../src/modules/device-console/pairing-controller/index.js";

describe("遥控器配对控制契约", () => {
  it("发送准确命令但不把成功伪造成已配对", async () => {
    const sendCommand = vi.fn(async () => ({ status: "accepted" as const, detail: "accepted" }));
    const controller = PairingController.create({ relay: { sendCommand } });
    expect(await controller.start("phone-1")).toEqual({ ok: true, action: "start" });
    expect(sendCommand).toHaveBeenCalledWith("phone-1", { name: "pairing.start", fields: {} });
    expect(controller.snapshot("phone-1")).toEqual({ deviceId: "phone-1", phase: "idle", lastAction: "start", notice: null });
    expect(await controller.refresh("phone-1")).toEqual({ ok: true, action: "refresh" });
    expect(sendCommand).toHaveBeenLastCalledWith("phone-1", { name: "pairing.status", fields: {} });
  });

  it("同设备互斥而不同设备可并行", async () => {
    const completes: Array<(value: { status: "accepted"; detail: string }) => void> = [];
    const controller = PairingController.create({ relay: { sendCommand: vi.fn(() => new Promise((resolve) => { completes.push(resolve); })) } });
    const pending = controller.start("phone-1");
    expect(controller.snapshot("phone-1")).toMatchObject({ phase: "starting" });
    expect(await controller.stop("phone-1")).toEqual({ ok: false, reason: "busy" });
    const second = controller.start("phone-2");
    completes[0]!({ status: "accepted", detail: "ok" });
    completes[1]!({ status: "accepted", detail: "ok" });
    expect(await pending).toEqual({ ok: true, action: "start" });
    await second;
  });

  it.each([
    [{ status: "rejected", detail: "no" }, "rejected"],
    [{ status: "timeout", detail: "late" }, "timeout"]
  ])("映射中继失败结果", async (outcome, reason) => {
    const controller = PairingController.create({ relay: { sendCommand: async () => outcome } });
    expect(await controller.stop("phone-1")).toEqual({ ok: false, reason });
    expect(controller.snapshot("phone-1")).toMatchObject({ phase: "idle", lastAction: "stop", notice: { code: reason.toUpperCase() } });
  });

  it("拒绝非法设备标识并隔离端口异常", async () => {
    const controller = PairingController.create({ relay: { sendCommand: async () => { throw new Error("secret"); } } });
    expect(await controller.start(" ")).toEqual({ ok: false, reason: "invalid-device" });
    expect(await controller.start("phone-1")).toEqual({ ok: false, reason: "adapter-failed" });
    expect(controller.snapshot("phone-1")).toMatchObject({ notice: { code: "ADAPTER_FAILED" } });
  });

  it("为停止和刷新保留精确的请求阶段和中继命令", async () => {
    const resolves: Array<(value: { status: "accepted"; detail: string }) => void> = [];
    const sendCommand = vi.fn(() => new Promise<{ status: "accepted"; detail: string }>((resolve) => { resolves.push(resolve); }));
    const controller = PairingController.create({ relay: { sendCommand } });
    const stop = controller.stop("phone-1");
    expect(controller.snapshot("phone-1")).toMatchObject({ phase: "stopping" });
    resolves[0]!({ status: "accepted", detail: "ok" });
    await expect(stop).resolves.toEqual({ ok: true, action: "stop" });
    expect(sendCommand).toHaveBeenLastCalledWith("phone-1", { name: "pairing.stop", fields: {} });
    const refresh = controller.refresh("phone-1");
    expect(controller.snapshot("phone-1")).toMatchObject({ phase: "refreshing" });
    resolves[1]!({ status: "accepted", detail: "ok" });
    await expect(refresh).resolves.toEqual({ ok: true, action: "refresh" });
  });

  it("拒绝类型错误、超长和控制字符设备标识而不调用中继", async () => {
    const sendCommand = vi.fn(async () => ({ status: "accepted" as const, detail: "ok" }));
    const controller = PairingController.create({ relay: { sendCommand } });
    const start = controller.start as (deviceId: unknown) => Promise<unknown>;
    await expect(start(1)).resolves.toEqual({ ok: false, reason: "invalid-device" });
    await expect(start("x".repeat(128))).resolves.toEqual({ ok: true, action: "start" });
    sendCommand.mockClear();
    await expect(start("x".repeat(129))).resolves.toEqual({ ok: false, reason: "invalid-device" });
    await expect(start("phone\u0000-1")).resolves.toEqual({ ok: false, reason: "invalid-device" });
    expect(sendCommand).not.toHaveBeenCalled();
  });
});
