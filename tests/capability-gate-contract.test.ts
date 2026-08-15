import { describe, expect, it } from "vitest";
import { CapabilityGate } from "../src/modules/device-console/capability-gate/index.js";

const base = { relayConnected: true, sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, aircraftConnected: true, capabilities: { liveVideo: true, waypointMission: true, waypointMissionSupport: "supported" as const, virtualStick: false } };

describe("设备操作能力门禁契约", () => {
  it("在完整链路上允许直接飞行安全指令", () => {
    expect(CapabilityGate.evaluate({ operation: "direct-flight", ...base })).toEqual({ ok: true, value: { operation: "direct-flight", enabled: true, reason: null } });
  });

  it.each(["live-stream", "waypoint-mission", "transmission-settings", "camera-settings"] as const)("在完整链路和所需能力具备时允许 %s", (operation) => {
    expect(CapabilityGate.evaluate({ operation, ...base })).toEqual({ ok: true, value: { operation, enabled: true, reason: null } });
  });

  it("仅在遥控器已连接但飞机两段均未连接时允许配对", () => {
    expect(CapabilityGate.evaluate({ operation: "pairing", ...base, flightControllerConnected: false, aircraftConnected: false })).toEqual({ ok: true, value: { operation: "pairing", enabled: true, reason: null } });
    expect(CapabilityGate.evaluate({ operation: "pairing", ...base })).toEqual({ ok: true, value: { operation: "pairing", enabled: false, reason: "PAIRING_NOT_NEEDED" } });
  });

  it.each([
    [{ operation: "live-stream", ...base, relayConnected: false }, "RELAY_OFFLINE"],
    [{ operation: "live-stream", ...base, sdkRegistered: false }, "SDK_NOT_READY"],
    [{ operation: "live-stream", ...base, remoteControllerConnected: false }, "REMOTE_CONTROLLER_OFFLINE"],
    [{ operation: "live-stream", ...base, aircraftConnected: false }, "AIRCRAFT_NOT_CONNECTED"],
    [{ operation: "live-stream", ...base, capabilities: null }, "CAPABILITY_UNKNOWN"],
    [{ operation: "live-stream", ...base, capabilities: { ...base.capabilities, liveVideo: false } }, "LIVE_VIDEO_UNSUPPORTED"],
    [{ operation: "waypoint-mission", ...base, capabilities: { ...base.capabilities, waypointMission: false } }, "WAYPOINT_UNSUPPORTED"],
    [{ operation: "waypoint-mission", ...base, capabilities: { ...base.capabilities, waypointMissionSupport: "unsupported" } }, "WAYPOINT_UNSUPPORTED"]
  ])("针对不可提交条件返回精确原因", (input, reason) => {
    expect(CapabilityGate.evaluate(input)).toEqual({ ok: true, value: { operation: input.operation, enabled: false, reason } });
  });

  it("能力字段缺失不会被擅自当作支持", () => {
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, capabilities: {} })).toEqual({ ok: true, value: { operation: "live-stream", enabled: false, reason: "CAPABILITY_UNKNOWN" } });
    expect(CapabilityGate.evaluate({ operation: "waypoint-mission", ...base, capabilities: { waypointMission: true } })).toEqual({ ok: true, value: { operation: "waypoint-mission", enabled: false, reason: "CAPABILITY_UNKNOWN" } });
  });

  it.each([
    [null, "input"],
    [{ operation: "unknown", ...base }, "operation"],
    [{ operation: "live-stream", ...base, sdkRegistered: "yes" }, "sdkRegistered"],
    [{ operation: "live-stream", ...base, capabilities: { liveVideo: "yes" } }, "capabilities.liveVideo"]
  ])("拒绝无效门禁输入", (input, field) => {
    expect(CapabilityGate.evaluate(input)).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field, reason: "invalid-value" } } });
  });

  it("冻结决策并隔离 getter", () => {
    const decision = CapabilityGate.evaluate({ operation: "live-stream", ...base });
    expect(Object.isFrozen(decision)).toBe(true);
    const hostile = new Proxy({}, { get() { throw new Error("secret"); } });
    expect(CapabilityGate.evaluate(hostile)).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "input", reason: "unreadable" } } });
  });

  it("拒绝非对象、未知支持枚举和不可读取的能力对象", () => {
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, capabilities: true })).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "capabilities.liveVideo", reason: "invalid-value" } } });
    expect(CapabilityGate.evaluate({ operation: "waypoint-mission", ...base, capabilities: { waypointMissionSupport: "pending" } })).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "capabilities.liveVideo", reason: "invalid-value" } } });
    const hostileCapabilities = new Proxy({}, { get() { throw new Error("secret"); } });
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, capabilities: hostileCapabilities })).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "capabilities.liveVideo", reason: "unreadable" } } });
  });

  it("独立校验每个能力字段和每一段飞行连接事实", () => {
    expect(CapabilityGate.evaluate(1)).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "input", reason: "invalid-value" } } });
    expect(CapabilityGate.evaluate({ operation: ["live-stream"], ...base })).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "operation", reason: "invalid-value" } } });
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, capabilities: { waypointMission: "yes" } })).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "capabilities.liveVideo", reason: "invalid-value" } } });
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, capabilities: { virtualStick: "yes" } })).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "capabilities.liveVideo", reason: "invalid-value" } } });
    expect(CapabilityGate.evaluate({ operation: "pairing", ...base, flightControllerConnected: true, aircraftConnected: false })).toEqual({ ok: true, value: { operation: "pairing", enabled: false, reason: "PAIRING_NOT_NEEDED" } });
    expect(CapabilityGate.evaluate({ operation: "pairing", ...base, flightControllerConnected: false, aircraftConnected: true })).toEqual({ ok: true, value: { operation: "pairing", enabled: false, reason: "PAIRING_NOT_NEEDED" } });
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, flightControllerConnected: false })).toEqual({ ok: true, value: { operation: "live-stream", enabled: false, reason: "AIRCRAFT_NOT_CONNECTED" } });
    expect(CapabilityGate.evaluate({ operation: "waypoint-mission", ...base, capabilities: null })).toEqual({ ok: true, value: { operation: "waypoint-mission", enabled: false, reason: "CAPABILITY_UNKNOWN" } });
    expect(CapabilityGate.evaluate({ operation: "waypoint-mission", ...base, capabilities: { waypointMissionSupport: "supported" } })).toEqual({ ok: true, value: { operation: "waypoint-mission", enabled: false, reason: "CAPABILITY_UNKNOWN" } });
    expect(CapabilityGate.evaluate({ operation: "transmission-settings", ...base, capabilities: null })).toEqual({ ok: true, value: { operation: "transmission-settings", enabled: true, reason: null } });
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, capabilities: { ...base.capabilities, liveVideo: false } })).toEqual({ ok: true, value: { operation: "live-stream", enabled: false, reason: "LIVE_VIDEO_UNSUPPORTED" } });
  });
});
