import { describe, expect, it } from "vitest";
import { CapabilityGate } from "../src/modules/device-console/capability-gate/index.js";

const base = { relayConnected: true, sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, airLink: "CONNECTED" as const, camera: "CONNECTED" as const, capabilities: { liveVideo: true, waypointMission: true, waypointMissionSupport: "supported" as const, virtualStick: false } };

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

  it("直接飞行只判断 MSDK 可达，不把遥控器显示状态当作本地硬拦截", () => {
    expect(CapabilityGate.evaluate({ operation: "direct-flight", ...base, remoteControllerConnected: false })).toEqual({
      ok: true,
      value: { operation: "direct-flight", enabled: true, reason: null }
    });
  });

  it.each([
    [{ operation: "live-stream", ...base, relayConnected: false }, "RELAY_OFFLINE"],
    [{ operation: "live-stream", ...base, sdkRegistered: false }, "SDK_NOT_READY"],
  ])("针对不可提交条件返回精确原因", (input, reason) => {
    expect(CapabilityGate.evaluate(input)).toEqual({ ok: true, value: { operation: input.operation, enabled: false, reason } });
  });

  it("图传只依赖图传源 Key，不把飞控、遥控器或兼容能力投影当作门禁", () => {
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, remoteControllerConnected: false, flightControllerConnected: false, aircraftConnected: false })).toEqual({
      ok: true,
      value: { operation: "live-stream", enabled: true, reason: null },
    });
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, capabilities: null })).toEqual({
      ok: true,
      value: { operation: "live-stream", enabled: true, reason: null },
    });
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, capabilities: {} })).toEqual({
      ok: true,
      value: { operation: "live-stream", enabled: true, reason: null },
    });
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, capabilities: { ...base.capabilities, liveVideo: false } })).toEqual({
      ok: true,
      value: { operation: "live-stream", enabled: true, reason: null },
    });
  });

  it.each([
    [{ operation: "live-stream", ...base, airLink: "DISCONNECTED" }, "AIRLINK_OFFLINE"],
    [{ operation: "live-stream", ...base, airLink: "UNKNOWN" }, "AIRLINK_CONNECTION_UNKNOWN"],
    [{ operation: "live-stream", ...base, camera: "DISCONNECTED" }, "CAMERA_OFFLINE"],
    [{ operation: "live-stream", ...base, camera: "UNKNOWN" }, "CAMERA_CONNECTION_UNKNOWN"],
    [{ operation: "live-stream", relayConnected: true, sdkAvailability: "READY" }, "AIRLINK_CONNECTION_UNKNOWN"],
  ])("图传源没有明确连接时，在调用 MSDK 前以精确原因拒绝", (input, reason) => {
    expect(CapabilityGate.evaluate(input)).toEqual({ ok: true, value: { operation: "live-stream", enabled: false, reason } });
  });

  it.each(["transmission-settings", "camera-settings"] as const)("%s 只要求手机中继和 MSDK 可达，不以遥控器或飞控遥测提前拒绝", (operation) => {
    expect(CapabilityGate.evaluate({
      operation,
      ...base,
      sdkAvailability: "READY",
      remoteController: "DISCONNECTED",
      flightController: "UNKNOWN",
      remoteControllerConnected: false,
      flightControllerConnected: false,
    })).toEqual({ ok: true, value: { operation, enabled: true, reason: null } });
  });

  it.each(["transmission-settings", "camera-settings"] as const)("%s 不读取无关的遥控器、飞控和能力字段", (operation) => {
    const input = Object.defineProperties({ operation, relayConnected: true, sdkAvailability: "READY" }, {
      remoteController: { get: () => { throw new Error("unrelated remote-controller observation"); } },
      flightController: { get: () => { throw new Error("unrelated flight-controller observation"); } },
      capabilities: { get: () => { throw new Error("unrelated capability observation"); } },
    });

    expect(CapabilityGate.evaluate(input)).toEqual({
      ok: true,
      value: { operation, enabled: true, reason: null },
    });
  });

  it.each(["direct-flight", "waypoint-mission"] as const)("%s 只确认 Relay 与 MSDK 可达，不以设备遥测或能力取代 DJI 裁决", (operation) => {
    const input = Object.defineProperties({ operation, relayConnected: true, sdkAvailability: "READY" }, {
      remoteController: { get: () => { throw new Error("unrelated remote-controller observation"); } },
      flightController: { get: () => { throw new Error("unrelated flight-controller observation"); } },
      capabilities: { get: () => { throw new Error("unrelated capability observation"); } },
    });

    expect(CapabilityGate.evaluate(input)).toEqual({
      ok: true,
      value: { operation, enabled: true, reason: null },
    });
  });

  it("图传门禁读取原始源 Key，但不读取兼容能力投影", () => {
    const input = Object.defineProperties({ operation: "live-stream", relayConnected: true, sdkAvailability: "READY", airLink: "CONNECTED", camera: "CONNECTED" }, {
      capabilities: { get: () => { throw new Error("compatibility capability is not a start gate"); } },
    });

    expect(CapabilityGate.evaluate(input)).toEqual({
      ok: true,
      value: { operation: "live-stream", enabled: true, reason: null },
    });
  });

  it.each([
    [null, "input"],
    [{ operation: "unknown", ...base }, "operation"],
    [{ operation: "live-stream", ...base, sdkRegistered: "yes" }, "sdkRegistered"]
  ])("拒绝无效门禁输入", (input, field) => {
    expect(CapabilityGate.evaluate(input)).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field, reason: "invalid-value" } } });
  });

  it("冻结决策并隔离 getter", () => {
    const decision = CapabilityGate.evaluate({ operation: "live-stream", ...base });
    expect(Object.isFrozen(decision)).toBe(true);
    const hostile = new Proxy({}, { get() { throw new Error("secret"); } });
    expect(CapabilityGate.evaluate(hostile)).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "input", reason: "unreadable" } } });
  });

  it("图传门禁忽略兼容能力投影，但校验原始源 Key", () => {
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, capabilities: true })).toEqual({ ok: true, value: { operation: "live-stream", enabled: true, reason: null } });
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, capabilities: { liveVideo: "pending" } })).toEqual({ ok: true, value: { operation: "live-stream", enabled: true, reason: null } });
    const hostileCapabilities = new Proxy({}, { get() { throw new Error("secret"); } });
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, capabilities: hostileCapabilities })).toEqual({ ok: true, value: { operation: "live-stream", enabled: true, reason: null } });
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, airLink: "not-a-link" })).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "airLink", reason: "invalid-value" } } });
    const hostileAirLink = Object.defineProperty({ operation: "live-stream", ...base }, "airLink", { get: () => { throw new Error("source unavailable"); } });
    expect(CapabilityGate.evaluate(hostileAirLink)).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "airLink", reason: "unreadable" } } });
  });

  it("独立校验每个能力字段和每一段飞行连接事实", () => {
    expect(CapabilityGate.evaluate(1)).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "input", reason: "invalid-value" } } });
    expect(CapabilityGate.evaluate({ operation: ["live-stream"], ...base })).toEqual({ ok: false, error: { code: "INVALID_INPUT", details: { field: "operation", reason: "invalid-value" } } });
    expect(CapabilityGate.evaluate({ operation: "waypoint-mission", ...base, capabilities: { waypointMission: "yes" } })).toEqual({ ok: true, value: { operation: "waypoint-mission", enabled: true, reason: null } });
    expect(CapabilityGate.evaluate({ operation: "waypoint-mission", ...base, capabilities: { waypointMission: true, waypointMissionSupport: "supported", virtualStick: "yes" } })).toEqual({ ok: true, value: { operation: "waypoint-mission", enabled: true, reason: null } });
    expect(CapabilityGate.evaluate({ operation: "pairing", ...base, flightControllerConnected: true, aircraftConnected: false })).toEqual({ ok: true, value: { operation: "pairing", enabled: false, reason: "PAIRING_NOT_NEEDED" } });
    expect(CapabilityGate.evaluate({ operation: "pairing", ...base, flightControllerConnected: false, aircraftConnected: true })).toEqual({ ok: true, value: { operation: "pairing", enabled: true, reason: null } });
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, flightControllerConnected: false })).toEqual({ ok: true, value: { operation: "live-stream", enabled: true, reason: null } });
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, aircraftConnected: false })).toEqual({ ok: true, value: { operation: "live-stream", enabled: true, reason: null } });
    expect(CapabilityGate.evaluate({ operation: "transmission-settings", ...base, flightControllerConnected: false })).toEqual({ ok: true, value: { operation: "transmission-settings", enabled: true, reason: null } });
    expect(CapabilityGate.evaluate({ operation: "waypoint-mission", ...base, capabilities: null })).toEqual({ ok: true, value: { operation: "waypoint-mission", enabled: true, reason: null } });
    expect(CapabilityGate.evaluate({ operation: "waypoint-mission", ...base, capabilities: { waypointMissionSupport: "supported" } })).toEqual({ ok: true, value: { operation: "waypoint-mission", enabled: true, reason: null } });
    expect(CapabilityGate.evaluate({ operation: "transmission-settings", ...base, capabilities: null })).toEqual({ ok: true, value: { operation: "transmission-settings", enabled: true, reason: null } });
    expect(CapabilityGate.evaluate({ operation: "live-stream", ...base, remoteControllerConnected: false, capabilities: { ...base.capabilities, liveVideo: false } })).toEqual({ ok: true, value: { operation: "live-stream", enabled: true, reason: null } });
  });

  it("配对仍拒绝其依赖的非布尔连接事实", () => {
    expect(CapabilityGate.evaluate({ operation: "pairing", ...base, remoteControllerConnected: "connected", flightControllerConnected: false })).toEqual({
      ok: false,
      error: { code: "INVALID_INPUT", details: { field: "remoteControllerConnected", reason: "invalid-value" } },
    });
    expect(CapabilityGate.evaluate({ operation: "pairing", ...base, remoteControllerConnected: true, flightControllerConnected: "connected" })).toEqual({
      ok: false,
      error: { code: "INVALID_INPUT", details: { field: "flightControllerConnected", reason: "invalid-value" } },
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

  it("原始 MSDK 状态优先于兼容布尔值", () => {
    expect(CapabilityGate.evaluate({ operation: "direct-flight", ...base, sdkAvailability: "STARTING", remoteController: "CONNECTED", flightController: "CONNECTED" })).toEqual({ ok: true, value: { operation: "direct-flight", enabled: false, reason: "SDK_NOT_READY" } });
  });

  it("原始未知状态不会被兼容布尔值伪装成可用", () => {
    expect(CapabilityGate.evaluate({ operation: "direct-flight", ...base, sdkAvailability: "UNKNOWN", remoteController: "UNKNOWN", flightController: "UNKNOWN" })).toEqual({ ok: true, value: { operation: "direct-flight", enabled: false, reason: "SDK_NOT_READY" } });
  });

  it("拒绝原始 MSDK 生命周期和链路枚举中的非法值", () => {
    expect(CapabilityGate.evaluate({ operation: "direct-flight", ...base, sdkAvailability: "BROKEN" })).toMatchObject({ ok: false, error: { details: { field: "sdkAvailability" } } });
    expect(CapabilityGate.evaluate({ operation: "pairing", ...base, remoteController: "BROKEN", flightControllerConnected: false })).toMatchObject({ ok: false, error: { details: { field: "remoteController" } } });
    expect(CapabilityGate.evaluate({ operation: "pairing", ...base, remoteController: "CONNECTED", flightController: "BROKEN" })).toMatchObject({ ok: false, error: { details: { field: "flightController" } } });
  });
});
