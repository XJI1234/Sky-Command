import { describe, expect, it } from "vitest";
import { RelayDeviceSettings } from "../src/adapters/relay-device-settings/index.js";

const cameraResult = Object.freeze({
  kind: "object" as const,
  fields: Object.freeze({
    domain: Object.freeze({ kind: "string" as const, value: "camera" }),
    settings: Object.freeze({ kind: "object" as const, fields: Object.freeze({
      autoExposureLockEnabled: Object.freeze({ kind: "boolean" as const, value: true }),
      focusMode: Object.freeze({ kind: "string" as const, value: "AF" }),
      cameraIndex: Object.freeze({ kind: "string" as const, value: "LEFT_OR_MAIN" })
    }) })
  })
});
const transmissionResult = Object.freeze({
  kind: "object" as const,
  fields: Object.freeze({
    domain: Object.freeze({ kind: "string" as const, value: "transmission" }),
    settings: Object.freeze({ kind: "object" as const, fields: Object.freeze({
      frequencyBand: Object.freeze({ kind: "string" as const, value: "BAND_2_DOT_4G" }),
      channelSelectionMode: Object.freeze({ kind: "string" as const, value: "AUTO" }),
      bandwidth: Object.freeze({ kind: "string" as const, value: "BANDWIDTH_10MHZ" }),
      dynamicDataRateMbps: Object.freeze({ kind: "number" as const, value: "12.5" })
    }) })
  })
});

type Request = Readonly<{ readonly name: string; readonly fields: Readonly<Record<string, unknown>> }>;

function relay(outcome: unknown = null): { readonly calls: Request[]; readonly sendCommand: (deviceId: string, request: Request) => Promise<unknown> } {
  const calls: Request[] = [];
  return {
    calls,
    sendCommand: async (_deviceId, request) => {
      calls.push(request);
      return outcome ?? Object.freeze({ status: "succeeded", detail: "Settings confirmed", result: request.name.includes("camera") ? cameraResult : transmissionResult });
    }
  };
}

describe("中继设备设置适配器契约", () => {
  it("将四种设置操作映射为手机端命令，并只返回已确认的完整快照", async () => {
    const gateway = relay();
    const port = RelayDeviceSettings.create({ relay: gateway });
    await expect(port.readCamera("phone-1")).resolves.toEqual({ ok: true, value: { autoExposureLockEnabled: true, focusMode: "AF", cameraIndex: "LEFT_OR_MAIN" } });
    await expect(port.writeCamera("phone-1", { autoExposureLockEnabled: false })).resolves.toMatchObject({ ok: true, value: { focusMode: "AF" } });
    await expect(port.readTransmission("phone-1")).resolves.toEqual({ ok: true, value: { frequencyBand: "BAND_2_DOT_4G", channelSelectionMode: "AUTO", bandwidth: "BANDWIDTH_10MHZ", dynamicDataRateMbps: 12.5 } });
    await expect(port.writeTransmission("phone-1", { bandwidth: "BANDWIDTH_10MHZ" })).resolves.toMatchObject({ ok: true, value: { bandwidth: "BANDWIDTH_10MHZ" } });
    expect(gateway.calls).toEqual([
      { name: "device.settings.camera.read", fields: {} },
      { name: "device.settings.camera.write", fields: { autoExposureLockEnabled: { kind: "boolean", value: false } } },
      { name: "device.settings.transmission.read", fields: {} },
      { name: "device.settings.transmission.write", fields: { bandwidth: { kind: "string", value: "BANDWIDTH_10MHZ" } } }
    ]);
    expect(Object.isFrozen(gateway.calls[1]?.fields)).toBe(true);
  });

  it.each([
    [Object.freeze({ status: "timed-out", detail: "late" }), "timed-out"],
    [Object.freeze({ status: "disconnected", detail: "lost" }), "transport-failed"],
    [Object.freeze({ status: "rejected", detail: "no" }), "rejected"],
    [Object.freeze({ status: "succeeded", detail: "missing" }), "rejected"],
    [Object.freeze({ status: "succeeded", detail: "wrong domain", result: transmissionResult }), "rejected"]
  ] as const)("将中继终态或不匹配的结果稳定映射为 %s", async (outcome, reason) => {
    const port = RelayDeviceSettings.create({ relay: relay(outcome) });
    await expect(port.readCamera("phone-1")).resolves.toEqual({ ok: false, reason });
  });

  it("拒绝不完整或畸形快照，并把中继异常收敛为稳定失败", async () => {
    const malformed = Object.freeze({ kind: "object", fields: Object.freeze({ domain: Object.freeze({ kind: "string", value: "camera" }), settings: Object.freeze({ kind: "object", fields: Object.freeze({ autoExposureLockEnabled: Object.freeze({ kind: "boolean", value: true }), focusMode: Object.freeze({ kind: "string", value: "AF" }) }) }) }) });
    const invalid = RelayDeviceSettings.create({ relay: relay(Object.freeze({ status: "succeeded", detail: "bad", result: malformed })) });
    await expect(invalid.readCamera("phone-1")).resolves.toEqual({ ok: false, reason: "rejected" });
    const throwing = RelayDeviceSettings.create({ relay: { calls: [], sendCommand: async () => { throw new Error("network secret"); } } });
    await expect(throwing.readTransmission("phone-1")).resolves.toEqual({ ok: false, reason: "transport-failed" });
  });

  it("防御性拒绝直接传入的无效补丁和恶意枚举器，不向中继发送命令", async () => {
    const gateway = relay();
    const port = RelayDeviceSettings.create({ relay: gateway });
    const writeCamera = port.writeCamera as (id: string, patch: unknown) => Promise<unknown>;
    const writeTransmission = port.writeTransmission as (id: string, patch: unknown) => Promise<unknown>;
    await expect(writeCamera("phone-1", {})).resolves.toEqual({ ok: false, reason: "rejected" });
    await expect(writeCamera("phone-1", { focusMode: "bad" })).resolves.toEqual({ ok: false, reason: "rejected" });
    await expect(writeTransmission("phone-1", { bandwidth: 1 })).resolves.toEqual({ ok: false, reason: "rejected" });
    await expect(writeTransmission("phone-1", new Proxy({}, { ownKeys() { throw new Error("secret"); } }))).resolves.toEqual({ ok: false, reason: "rejected" });
    expect(gateway.calls).toEqual([]);
  });

  it("覆盖补丁白名单、空输入和图传快照的空码率边界", async () => {
    const nullRate = Object.freeze({ kind: "object", fields: Object.freeze({
      domain: Object.freeze({ kind: "string", value: "transmission" }),
      settings: Object.freeze({ kind: "object", fields: Object.freeze({
        frequencyBand: Object.freeze({ kind: "string", value: "BAND_2_DOT_4G" }),
        channelSelectionMode: Object.freeze({ kind: "string", value: "AUTO" }),
        bandwidth: Object.freeze({ kind: "string", value: "BANDWIDTH_10MHZ" }),
        dynamicDataRateMbps: Object.freeze({ kind: "null" })
      }) })
    }) });
    const gateway = relay(Object.freeze({ status: "succeeded", detail: "confirmed", result: nullRate }));
    const port = RelayDeviceSettings.create({ relay: gateway });
    await expect(port.readTransmission("phone-1")).resolves.toEqual({ ok: true, value: { frequencyBand: "BAND_2_DOT_4G", channelSelectionMode: "AUTO", bandwidth: "BANDWIDTH_10MHZ", dynamicDataRateMbps: null } });
    const writeCamera = port.writeCamera as (id: string, patch: unknown) => Promise<unknown>;
    const writeTransmission = port.writeTransmission as (id: string, patch: unknown) => Promise<unknown>;
    await expect(writeCamera("phone-1", null)).resolves.toEqual({ ok: false, reason: "rejected" });
    await expect(writeCamera("phone-1", { unsupported: true })).resolves.toEqual({ ok: false, reason: "rejected" });
    await expect(writeCamera("phone-1", { autoExposureLockEnabled: "true" })).resolves.toEqual({ ok: false, reason: "rejected" });
    await expect(writeTransmission("phone-1", null)).resolves.toEqual({ ok: false, reason: "rejected" });
    await expect(writeTransmission("phone-1", {})).resolves.toEqual({ ok: false, reason: "rejected" });
    await expect(writeTransmission("phone-1", { unsupported: "AUTO" })).resolves.toEqual({ ok: false, reason: "rejected" });
  });

  it("隔离手机端的空结果、抛错字段和不合法设置值", async () => {
    const nullOutcome = RelayDeviceSettings.create({ relay: { sendCommand: async () => null } });
    await expect(nullOutcome.readCamera("phone-1")).resolves.toEqual({ ok: false, reason: "rejected" });
    await expect(nullOutcome.readTransmission("phone-1")).resolves.toEqual({ ok: false, reason: "rejected" });
    const nullSnapshot = RelayDeviceSettings.create({ relay: relay(Object.freeze({ status: "succeeded", detail: "missing", result: null })) });
    await expect(nullSnapshot.readTransmission("phone-1")).resolves.toEqual({ ok: false, reason: "rejected" });
    const hostileOutcome = new Proxy({}, { get() { throw new Error("secret"); } });
    const hostile = RelayDeviceSettings.create({ relay: relay(hostileOutcome) });
    await expect(hostile.readCamera("phone-1")).resolves.toEqual({ ok: false, reason: "transport-failed" });
    const cameraWithBadLock = Object.freeze({ kind: "object", fields: Object.freeze({ domain: Object.freeze({ kind: "string", value: "camera" }), settings: Object.freeze({ kind: "object", fields: Object.freeze({ autoExposureLockEnabled: Object.freeze({ kind: "string", value: "true" }), focusMode: Object.freeze({ kind: "string", value: "AF" }), cameraIndex: Object.freeze({ kind: "string", value: "LEFT_OR_MAIN" }) }) }) }) });
    const cameraWithoutSettings = Object.freeze({ kind: "object", fields: Object.freeze({ domain: Object.freeze({ kind: "string", value: "camera" }), settings: null }) });
    const badCamera = RelayDeviceSettings.create({ relay: relay(Object.freeze({ status: "succeeded", detail: "bad", result: cameraWithBadLock })) });
    await expect(badCamera.readCamera("phone-1")).resolves.toEqual({ ok: false, reason: "rejected" });
    const missingCamera = RelayDeviceSettings.create({ relay: relay(Object.freeze({ status: "succeeded", detail: "bad", result: cameraWithoutSettings })) });
    await expect(missingCamera.readCamera("phone-1")).resolves.toEqual({ ok: false, reason: "rejected" });
    const transmission = (rate: string) => Object.freeze({ kind: "object", fields: Object.freeze({ domain: Object.freeze({ kind: "string", value: "transmission" }), settings: Object.freeze({ kind: "object", fields: Object.freeze({ frequencyBand: Object.freeze({ kind: "string", value: "BAND_2_DOT_4G" }), channelSelectionMode: Object.freeze({ kind: "string", value: "AUTO" }), bandwidth: Object.freeze({ kind: "string", value: "BANDWIDTH_10MHZ" }), dynamicDataRateMbps: Object.freeze({ kind: "number", value: rate }) }) }) }) });
    for (const rate of ["NaN", "-1"]) {
      const port = RelayDeviceSettings.create({ relay: relay(Object.freeze({ status: "succeeded", detail: "bad", result: transmission(rate) })) });
      await expect(port.readTransmission("phone-1")).resolves.toEqual({ ok: false, reason: "rejected" });
    }
    const transmissionWithoutSettings = Object.freeze({ kind: "object", fields: Object.freeze({ domain: Object.freeze({ kind: "string", value: "transmission" }), settings: null }) });
    const missingTransmission = RelayDeviceSettings.create({ relay: relay(Object.freeze({ status: "succeeded", detail: "bad", result: transmissionWithoutSettings })) });
    await expect(missingTransmission.readTransmission("phone-1")).resolves.toEqual({ ok: false, reason: "rejected" });
    const writeCamera = badCamera.writeCamera as (id: string, patch: unknown) => Promise<unknown>;
    await expect(writeCamera("phone-1", new Proxy({ focusMode: "AF" }, { get() { throw new Error("secret"); } }))).resolves.toEqual({ ok: false, reason: "rejected" });
    await expect(badCamera.writeCamera("phone-1", { focusMode: "AF" })).resolves.toEqual({ ok: false, reason: "rejected" });
  });
});
