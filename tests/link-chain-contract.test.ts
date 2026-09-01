import { describe, expect, it } from "vitest";
import { LinkChain } from "../src/modules/device-console/link-chain/index.js";

describe("设备链路状态契约", () => {
  it("三段物理链路已连接时不受对频状态影响", () => {
    expect(LinkChain.evaluate({
      deviceId: "phone-1",
      relayConnected: true,
      telemetry: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true, pairingState: "IDLE" },
    })).toEqual({
      ok: true,
      value: { deviceId: "phone-1", overall: "ready", computerToPhone: "connected", phoneToRemoteController: "connected", remoteControllerToAircraft: "connected" },
    });
    expect(LinkChain.evaluate({
      deviceId: "phone-1",
      relayConnected: true,
      telemetry: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true, pairingState: "PAIRED" },
    })).toMatchObject({ ok: true, value: { overall: "ready" } });
  });

  it("SDK 已就绪但遥控器连接尚未观察时保留未知状态", () => {
    expect(LinkChain.evaluate({
      deviceId: "phone-1",
      relayConnected: true,
      telemetry: { sdkRegistered: true, flightControllerConnected: true, connected: true },
    })).toEqual({
      ok: true,
      value: { deviceId: "phone-1", overall: "degraded", computerToPhone: "connected", phoneToRemoteController: "unknown", remoteControllerToAircraft: "unknown" },
    });
  });

  it.each([
    [{ deviceId: "phone-1", relayConnected: false, telemetry: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true } }, { overall: "offline", computerToPhone: "disconnected", phoneToRemoteController: "unknown", remoteControllerToAircraft: "unknown" }],
    [{ deviceId: "phone-1", relayConnected: true, telemetry: null }, { overall: "degraded", computerToPhone: "connected", phoneToRemoteController: "unknown", remoteControllerToAircraft: "unknown" }],
    [{ deviceId: "phone-1", relayConnected: true, telemetry: { sdkRegistered: false } }, { overall: "degraded", computerToPhone: "connected", phoneToRemoteController: "unknown", remoteControllerToAircraft: "unknown" }],
    [{ deviceId: "phone-1", relayConnected: true, telemetry: { sdkRegistered: true, remoteControllerConnected: false, flightControllerConnected: true, connected: true } }, { overall: "degraded", computerToPhone: "connected", phoneToRemoteController: "disconnected", remoteControllerToAircraft: "unknown" }],
    [{ deviceId: "phone-1", relayConnected: true, telemetry: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: false } }, { overall: "degraded", computerToPhone: "connected", phoneToRemoteController: "connected", remoteControllerToAircraft: "disconnected" }]
  ])("保留各段链路事实而不把缺失误作断开", (input, expected) => {
    expect(LinkChain.evaluate(input)).toEqual({ ok: true, value: { deviceId: "phone-1", ...expected } });
  });

  it.each([
    [null, "input", "invalid-container"],
    [{ deviceId: " ", relayConnected: true, telemetry: null }, "deviceId", "invalid-id"],
    [{ deviceId: "phone-1", relayConnected: "true", telemetry: null }, "relayConnected", "invalid-type"],
    [{ deviceId: "phone-1", relayConnected: true, telemetry: { sdkRegistered: "yes" } }, "telemetry.sdkRegistered", "invalid-type"]
  ])("稳定拒绝无效输入", (input, field, reason) => {
    expect(LinkChain.evaluate(input)).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field, reason } } });
  });

  it("冻结结果并隔离恶意 getter", () => {
    const result = LinkChain.evaluate({ deviceId: "phone-1", relayConnected: true, telemetry: null });
    if (!result.ok) throw new Error("expected result");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.value)).toBe(true);
    const hostile = new Proxy({}, { get() { throw new Error("secret"); } });
    expect(LinkChain.evaluate(hostile)).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "input", reason: "unreadable" } } });
  });

  it("隔离遥测对象的 getter 异常而不泄露实现错误", () => {
    const hostileTelemetry = new Proxy({}, { get() { throw new Error("secret"); } });
    expect(LinkChain.evaluate({ deviceId: "phone-1", relayConnected: true, telemetry: hostileTelemetry })).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "input", reason: "unreadable" } } });
  });

  it("拒绝非对象遥测，并将缺失 SDK 字段保留为未知而不是断开", () => {
    expect(LinkChain.evaluate(1)).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "input", reason: "invalid-container" } } });
    expect(LinkChain.evaluate({ deviceId: {}, relayConnected: true, telemetry: null })).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "deviceId", reason: "invalid-id" } } });
    expect(LinkChain.evaluate({ deviceId: "phone-1", relayConnected: true, telemetry: true })).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "telemetry", reason: "invalid-container" } } });
    expect(LinkChain.evaluate({ deviceId: "phone-1", relayConnected: true, telemetry: {} })).toEqual({ ok: true, value: { deviceId: "phone-1", overall: "degraded", computerToPhone: "connected", phoneToRemoteController: "unknown", remoteControllerToAircraft: "unknown" } });
  });

  it("严格校验设备标识上限，并要求飞控连接事实参与就绪判定", () => {
    expect(LinkChain.evaluate({ deviceId: "x".repeat(128), relayConnected: true, telemetry: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true } })).toMatchObject({ ok: true });
    expect(LinkChain.evaluate({ deviceId: "x".repeat(129), relayConnected: true, telemetry: null })).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "deviceId", reason: "invalid-id" } } });
    expect(LinkChain.evaluate({ deviceId: "phone-1", relayConnected: true, telemetry: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: false, connected: true } })).toEqual({ ok: true, value: { deviceId: "phone-1", overall: "degraded", computerToPhone: "connected", phoneToRemoteController: "connected", remoteControllerToAircraft: "disconnected" } });
  });

  it("飞控存在但飞机明确断开时保留飞行器段的明确断开事实", () => {
    expect(LinkChain.evaluate({
      deviceId: "phone-1",
      relayConnected: true,
      telemetry: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: false }
    })).toEqual({
      ok: true,
      value: {
        deviceId: "phone-1",
        overall: "degraded",
        computerToPhone: "connected",
        phoneToRemoteController: "connected",
        remoteControllerToAircraft: "disconnected"
      }
    });
  });

  it("飞控明确断开时不从同一帧的飞机字段虚构已连接结论", () => {
    expect(LinkChain.evaluate({
      deviceId: "phone-1",
      relayConnected: true,
      telemetry: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: false, connected: true }
    })).toMatchObject({
      ok: true,
      value: { overall: "degraded", phoneToRemoteController: "connected", remoteControllerToAircraft: "disconnected" }
    });
  });

  it("遥控器在线但两项飞行器事实均未知时保留未知", () => {
    expect(LinkChain.evaluate({
      deviceId: "phone-1",
      relayConnected: true,
      telemetry: { sdkRegistered: true, remoteControllerConnected: true },
    })).toMatchObject({
      ok: true,
      value: { phoneToRemoteController: "connected", remoteControllerToAircraft: "unknown" },
    });
  });
});
