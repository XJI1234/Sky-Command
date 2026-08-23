import { describe, expect, it } from "vitest";
import { DeviceGuidance } from "../src/modules/device-console/device-guidance/index.js";

const readyLink = Object.freeze({
  deviceId: "phone-1",
  overall: "ready" as const,
  computerToPhone: "connected" as const,
  phoneToRemoteController: "connected" as const,
  remoteControllerToAircraft: "connected" as const
});

describe("设备连接引导契约", () => {
  it.each([
    [{ link: { ...readyLink, overall: "offline", computerToPhone: "disconnected", phoneToRemoteController: "unknown", remoteControllerToAircraft: "unknown" } }, "CONNECT_PHONE", "reconnect-phone"],
    [{ link: { ...readyLink, overall: "degraded", phoneToRemoteController: "unknown", remoteControllerToAircraft: "unknown" } }, "WAIT_FOR_SDK", "wait-for-sdk"],
    [{ link: { ...readyLink, overall: "degraded", phoneToRemoteController: "disconnected", remoteControllerToAircraft: "unknown" } }, "CONNECT_REMOTE_CONTROLLER", "connect-remote-controller"],
    [{ link: { ...readyLink, overall: "degraded", remoteControllerToAircraft: "unknown" } }, "WAIT_FOR_SDK", "wait-for-sdk"],
    [{ link: { ...readyLink, overall: "degraded", remoteControllerToAircraft: "disconnected" }, pairingState: "IDLE" }, "START_PAIRING", "start-pairing"],
    [{ link: { ...readyLink, overall: "degraded", remoteControllerToAircraft: "disconnected" }, pairingState: "PAIRING" }, "WAIT_FOR_PAIRING", "wait-for-pairing"],
    [{ link: { ...readyLink, overall: "degraded", remoteControllerToAircraft: "disconnected" }, pairingState: "STOPPING" }, "WAIT_FOR_PAIRING", "wait-for-pairing"],
    [{ link: { ...readyLink, overall: "degraded", remoteControllerToAircraft: "disconnected" }, pairingState: "FAILED" }, "PAIRING_FAILED", "resolve-pairing-failure"],
    [{ link: { ...readyLink, overall: "degraded", remoteControllerToAircraft: "disconnected" }, pairingState: "PAIRED" }, "CONNECT_AIRCRAFT", "connect-aircraft"],
    [{ link: readyLink, pairingState: "PAIRED" }, "READY", null],
    [{ link: readyLink, pairingState: "PAIRING" }, "WAIT_FOR_PAIRING", "wait-for-pairing"],
    [{ link: readyLink, pairingState: "STOPPING" }, "WAIT_FOR_PAIRING", "wait-for-pairing"],
    [{ link: readyLink, pairingState: "FAILED" }, "PAIRING_FAILED", "resolve-pairing-failure"]
  ])("对当前阻塞步骤给出唯一且可执行的 %s 引导", (input, code, action) => {
    const result = DeviceGuidance.evaluate(input);
    expect(result).toMatchObject({ ok: true, value: { deviceId: "phone-1", code, action } });
  });

  it("把未知未来配对状态安全地处理为可以重新发起配对，而不是伪造已配对", () => {
    expect(DeviceGuidance.evaluate({ link: { ...readyLink, overall: "degraded", remoteControllerToAircraft: "disconnected" }, pairingState: "FUTURE_STATE" })).toMatchObject({ ok: true, value: { code: "START_PAIRING", action: "start-pairing" } });
    expect(DeviceGuidance.evaluate({ link: { ...readyLink, overall: "degraded", remoteControllerToAircraft: "disconnected" } })).toMatchObject({ ok: true, value: { code: "START_PAIRING", action: "start-pairing" } });
  });

  it.each([
    ["UNKNOWN", "START_PAIRING"],
    ["IDLE", "START_PAIRING"],
    ["PAIRING", "WAIT_FOR_PAIRING"],
    ["STOPPING", "WAIT_FOR_PAIRING"],
    ["PAIRED", "CONNECT_AIRCRAFT"],
    ["FAILED", "PAIRING_FAILED"]
  ] as const)("保留手机端已定义的配对状态 %s 的安全语义", (pairingState, code) => {
    expect(DeviceGuidance.evaluate({ link: { ...readyLink, overall: "degraded", remoteControllerToAircraft: "disconnected" }, pairingState })).toMatchObject({ ok: true, value: { code } });
  });

  it.each([
    [null, "input", "invalid-container"],
    [1, "input", "invalid-container"],
    [{ link: { ...readyLink, overall: "ready", computerToPhone: "disconnected", phoneToRemoteController: "unknown", remoteControllerToAircraft: "unknown" } }, "link", "invalid-value"],
    [{ link: { ...readyLink, deviceId: " " } }, "link.deviceId", "invalid-value"],
    [{ link: { ...readyLink, deviceId: 1 } }, "link.deviceId", "invalid-value"],
    [{ link: { ...readyLink, deviceId: "x".repeat(129) } }, "link.deviceId", "invalid-value"],
    [{ link: { ...readyLink, deviceId: "phone\u0000-1" } }, "link.deviceId", "invalid-value"],
    [{ link: null }, "link", "invalid-container"],
    [{ link: 1 }, "link", "invalid-container"],
    [{ link: { ...readyLink, overall: "missing" } }, "link.overall", "invalid-value"],
    [{ link: { ...readyLink, computerToPhone: "unknown" } }, "link.computerToPhone", "invalid-value"],
    [{ link: { ...readyLink, phoneToRemoteController: null } }, "link.phoneToRemoteController", "invalid-value"],
    [{ link: { ...readyLink, remoteControllerToAircraft: null } }, "link.remoteControllerToAircraft", "invalid-value"],
    [{ link: readyLink, pairingState: false }, "pairingState", "invalid-value"]
  ])("拒绝非法或矛盾输入", (input, field, reason) => {
    expect(DeviceGuidance.evaluate(input)).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field, reason } } });
  });

  it("接受允许的最长设备标识", () => {
    expect(DeviceGuidance.evaluate({ link: { ...readyLink, deviceId: "x".repeat(128) } })).toMatchObject({ ok: true, value: { deviceId: "x".repeat(128), code: "READY" } });
  });

  it.each([
    { ...readyLink, overall: "offline", computerToPhone: "disconnected", phoneToRemoteController: "connected", remoteControllerToAircraft: "unknown" },
    { ...readyLink, overall: "offline", computerToPhone: "disconnected", phoneToRemoteController: "unknown", remoteControllerToAircraft: "connected" },
    { ...readyLink, overall: "ready", phoneToRemoteController: "unknown", remoteControllerToAircraft: "unknown" },
    { ...readyLink, overall: "degraded", phoneToRemoteController: "unknown", remoteControllerToAircraft: "connected" },
    { ...readyLink, overall: "degraded", phoneToRemoteController: "unknown", remoteControllerToAircraft: "disconnected" },
    { ...readyLink, overall: "ready", phoneToRemoteController: "disconnected", remoteControllerToAircraft: "unknown" },
    { ...readyLink, overall: "degraded", phoneToRemoteController: "disconnected", remoteControllerToAircraft: "connected" },
    { ...readyLink, overall: "degraded", phoneToRemoteController: "disconnected", remoteControllerToAircraft: "disconnected" },
    { ...readyLink, overall: "degraded", phoneToRemoteController: "connected", remoteControllerToAircraft: "connected" },
    { ...readyLink, overall: "ready", phoneToRemoteController: "connected", remoteControllerToAircraft: "disconnected" }
  ])("拒绝每一种与上游链路快照不变量矛盾的组合", (link) => {
    expect(DeviceGuidance.evaluate({ link })).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "link", reason: "invalid-value" } } });
  });

  it("隔离恶意 getter 并返回深度冻结结果", () => {
    const hostile = new Proxy({}, { get() { throw new Error("secret"); } });
    expect(DeviceGuidance.evaluate({ link: hostile })).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "link", reason: "unreadable" } } });
    const hostileInput = new Proxy({}, { get() { throw new Error("input secret"); } });
    expect(DeviceGuidance.evaluate(hostileInput)).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "input", reason: "unreadable" } } });
    const result = DeviceGuidance.evaluate({ link: readyLink });
    if (!result.ok) throw new Error("expected guidance");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(DeviceGuidance)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(DeviceGuidance, "evaluate")).toEqual({ value: DeviceGuidance.evaluate, enumerable: true, writable: false, configurable: false });
  });
});
