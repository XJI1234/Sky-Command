import { describe, expect, it } from "vitest";
import { CapabilityGate } from "../src/modules/device-console/capability-gate/index.js";

const base = { relayConnected: true, sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, capabilities: { liveVideo: true, waypointMission: true, waypointMissionSupport: "supported" as const, virtualStick: false } };

describe("设备操作能力门禁契约", () => {
  it("在完整链路上允许直接飞行安全指令", () => {
    expect(CapabilityGate.evaluate({ operation: "direct-flight", ...base })).toEqual({ ok: true, value: { operation: "direct-flight", enabled: true, reason: null } });
  });

  it.each(["live-stream", "waypoint-mission", "transmission-settings", "camera-settings"] as const)("在完整链路和所需能力具备时允许 %s", (operation) => {
    expect(CapabilityGate.evaluate({ operation, ...base })).toEqual({ ok: true, value: { operation, enabled: true, reason: null } });
  });

  it("仅在遥控器已连接且飞控明确断开时允许配对", () => {
    expect(CapabilityGate.evaluate({ operation: "pairing", ...base, flightControllerConnected: false })).toEqual({ ok: true, value: { operation: "pairing", enabled: true, reason: null } });
    expect(CapabilityGate.evaluate({ operation: "pairing", ...base })).toEqual({ ok: true, value: { operation: "pairing", enabled: false, reason: "PAIRING_NOT_NEEDED" } });
  });

  it("配对只在遥控器已明确连接且飞控已明确断开时允许", () => {
    expect(CapabilityGate.evaluate({ operation: "pairing", ...base, flightControllerConnected: undefined })).toEqual({ ok: true, value: { operation: "pairing", enabled: false, reason: "FLIGHT_CONTROLLER_CONNECTION_UNKNOWN" } });
    expect(CapabilityGate.evaluate({ operation: "pairing", ...base, remoteControllerConnected: false, flightControllerConnected: false })).toEqual({ ok: true, value: { operation: "pairing", enabled: false, reason: "REMOTE_CONTROLLER_OFFLINE" } });
  });

  it("不把飞机操作的遥控器断开误判为飞机断开", () => {
    expect(CapabilityGate.evaluate({ operation: "direct-flight", ...base, remoteControllerConnected: false })).toEqual({
      ok: true,
      value: { operation: "direct-flight", enabled: false, reason: "REMOTE_CONTROLLER_OFFLINE" }
    });
  });

  it.each([
    [{ operation: "live-stream", ...base, relayConnected: false }, "RELAY_OFFLINE"],
    [{ operation: "live-stream", ...base, sdkRegistered: false }, "SDK_NOT_READY"],
    [{ operation: "waypoint-mission", ...base, capabilities: { ...base.capabilities, waypointMission: false } }, "WAYPOINT_UNSUPPORTED"],
    [{ operation: "waypoint-mission", ...base, capabilities: { ...base.capabilities, waypointMissionSupport: "unsupported" } }, "WAYPOINT_UNSUPPORTED"]
  ])("针对不可提交条件返回精确原因", (input, reason) => {
    expect(CapabilityGate.evaluate(input)).toEqual({ ok: true, value: { operation: input.operation, enabled: false, reason } });
  });

  it("图传只依赖实时图传能力，不依赖飞控连接", () => {
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, remoteControllerConnected: false, flightControllerConnected: false, aircraftConnected: false })).toEqual({
      ok: true,
      value: { operation: "live-stream", enabled: true, reason: null },
    });
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, capabilities: null })).toEqual({
      ok: true,
      value: { operation: "live-stream", enabled: false, reason: "CAPABILITY_UNKNOWN" },
    });
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, capabilities: {} })).toEqual({
      ok: true,
      value: { operation: "live-stream", enabled: false, reason: "CAPABILITY_UNKNOWN" },
    });
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, capabilities: { ...base.capabilities, liveVideo: false } })).toEqual({
      ok: true,
      value: { operation: "live-stream", enabled: false, reason: "LIVE_VIDEO_UNAVAILABLE" },
    });
  });

  it("航线能力字段缺失不会被擅自当作支持", () => {
    expect(CapabilityGate.evaluate({ operation: "waypoint-mission", ...base, capabilities: { waypointMission: true } })).toEqual({ ok: true, value: { operation: "waypoint-mission", enabled: false, reason: "CAPABILITY_UNKNOWN" } });
  });

  it.each([
    [null, "input"],
    [{ operation: "unknown", ...base }, "operation"],
    [{ operation: "live-stream", ...base, sdkRegistered: "yes" }, "sdkRegistered"],
    [{ operation: "waypoint-mission", ...base, capabilities: { liveVideo: "yes" } }, "capabilities.liveVideo"]
  ])("拒绝无效门禁输入", (input, field) => {
    expect(CapabilityGate.evaluate(input)).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field, reason: "invalid-value" } } });
  });

  it("冻结决策并隔离 getter", () => {
    const decision = CapabilityGate.evaluate({ operation: "live-stream", ...base });
    expect(Object.isFrozen(decision)).toBe(true);
    const hostile = new Proxy({}, { get() { throw new Error("secret"); } });
    expect(CapabilityGate.evaluate(hostile)).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "input", reason: "unreadable" } } });
  });

  it("拒绝航线所需的非对象、未知支持枚举和不可读取能力对象", () => {
    expect(CapabilityGate.evaluate({ operation: "waypoint-mission", ...base, capabilities: true })).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "capabilities.liveVideo", reason: "invalid-value" } } });
    expect(CapabilityGate.evaluate({ operation: "waypoint-mission", ...base, capabilities: { waypointMissionSupport: "pending" } })).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "capabilities.liveVideo", reason: "invalid-value" } } });
    const hostileCapabilities = new Proxy({}, { get() { throw new Error("secret"); } });
    expect(CapabilityGate.evaluate({ operation: "waypoint-mission", ...base, capabilities: hostileCapabilities })).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "capabilities.liveVideo", reason: "unreadable" } } });
  });

  it("独立校验每个能力字段和每一段飞行连接事实", () => {
    expect(CapabilityGate.evaluate(1)).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "input", reason: "invalid-value" } } });
    expect(CapabilityGate.evaluate({ operation: ["live-stream"], ...base })).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "operation", reason: "invalid-value" } } });
    expect(CapabilityGate.evaluate({ operation: "waypoint-mission", ...base, capabilities: { waypointMission: "yes" } })).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "capabilities.liveVideo", reason: "invalid-value" } } });
    expect(CapabilityGate.evaluate({ operation: "waypoint-mission", ...base, capabilities: { virtualStick: "yes" } })).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "capabilities.liveVideo", reason: "invalid-value" } } });
    expect(CapabilityGate.evaluate({ operation: "pairing", ...base, flightControllerConnected: true, aircraftConnected: false })).toEqual({ ok: true, value: { operation: "pairing", enabled: false, reason: "PAIRING_NOT_NEEDED" } });
    expect(CapabilityGate.evaluate({ operation: "pairing", ...base, flightControllerConnected: false, aircraftConnected: true })).toEqual({ ok: true, value: { operation: "pairing", enabled: true, reason: null } });
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, flightControllerConnected: false })).toEqual({ ok: true, value: { operation: "live-stream", enabled: true, reason: null } });
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, aircraftConnected: false })).toEqual({ ok: true, value: { operation: "live-stream", enabled: true, reason: null } });
    expect(CapabilityGate.evaluate({ operation: "transmission-settings", ...base, flightControllerConnected: false })).toEqual({ ok: true, value: { operation: "transmission-settings", enabled: false, reason: "FLIGHT_CONTROLLER_OFFLINE" } });
    expect(CapabilityGate.evaluate({ operation: "waypoint-mission", ...base, capabilities: null })).toEqual({ ok: true, value: { operation: "waypoint-mission", enabled: false, reason: "CAPABILITY_UNKNOWN" } });
    expect(CapabilityGate.evaluate({ operation: "waypoint-mission", ...base, capabilities: { waypointMissionSupport: "supported" } })).toEqual({ ok: true, value: { operation: "waypoint-mission", enabled: false, reason: "CAPABILITY_UNKNOWN" } });
    expect(CapabilityGate.evaluate({ operation: "transmission-settings", ...base, capabilities: null })).toEqual({ ok: true, value: { operation: "transmission-settings", enabled: true, reason: null } });
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, remoteControllerConnected: false, capabilities: { ...base.capabilities, liveVideo: false } })).toEqual({ ok: true, value: { operation: "live-stream", enabled: false, reason: "LIVE_VIDEO_UNAVAILABLE" } });
  });

  it.each([
    ["remoteControllerConnected", "remoteControllerConnected"],
    ["flightControllerConnected", "flightControllerConnected"],
  ] as const)("拒绝非布尔的 %s 飞行链路事实", (field, expectedField) => {
    expect(CapabilityGate.evaluate({
      operation: "direct-flight",
      ...base,
      [field]: "connected",
    })).toEqual({
      ok: false,
      error: { code: "INVALID_INPUT", details: { field: expectedField, reason: "invalid-value" } },
    });
  });

  it("忽略保留的 ProductKey 兼容字段，不以其阻断控制或图传", () => {
    const rawProduct = { aircraftConnected: false, connected: false };
    expect(CapabilityGate.evaluate({ operation: "direct-flight", ...base, ...rawProduct })).toEqual({
      ok: true,
      value: { operation: "direct-flight", enabled: true, reason: null },
    });
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, ...rawProduct })).toEqual({
      ok: true,
      value: { operation: "live-stream", enabled: true, reason: null },
    });
  });
});
