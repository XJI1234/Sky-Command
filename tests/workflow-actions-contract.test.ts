import { describe, expect, it } from "vitest";
import { WorkflowActions } from "../src/production/operation-workflow/workflow-actions/index.js";

describe("工作流动作模块契约", () => {
  it("任务暂存只在在线且已分配航线时精确委托任务控制", async () => {
    const calls: unknown[][] = [];
    const actions = WorkflowActions.create({
      online: (deviceId: string) => deviceId === "relay-a",
      assignedRoute: (deviceId: string) => deviceId === "relay-a" ? "route-a" : null,
      missionControl: { stage: async (...args: unknown[]) => { calls.push(args); return { ok: true }; } },
      liveStreamControl: {},
      deviceSettings: {},
      flightControl: {},
      settingsAllowed: () => true,
    });

    await expect(actions.stage("relay-a")).resolves.toEqual({ ok: true, value: { ok: true } });
    await expect(actions.stage("relay-b")).resolves.toEqual({ ok: false, code: "DEVICE_OFFLINE" });
    expect(calls).toEqual([["relay-a", "route-a"]]);
  });

  it("设置操作要求设备在线且通过对应能力门禁，依赖异常不泄露", async () => {
    const calls: unknown[][] = [];
    const actions = WorkflowActions.create({
      online: () => true,
      assignedRoute: () => null,
      missionControl: {},
      liveStreamControl: {},
      deviceSettings: { writeCamera: async (...args: unknown[]) => { calls.push(args); throw new Error("secret"); } },
      flightControl: {},
      settingsAllowed: (_deviceId: string, operation: string) => operation !== "camera-settings",
    });

    await expect(actions.writeCamera("relay-a", { iso: 100 })).resolves.toEqual({ ok: false, code: "CAPABILITY_BLOCKED" });
    expect(calls).toEqual([]);
  });

  it("缺少设置补丁时仍委托原写入方法且不补造实参", async () => {
    const calls: unknown[][] = [];
    const actions = WorkflowActions.create({
      online: () => true,
      assignedRoute: () => null,
      missionControl: {},
      liveStreamControl: {},
      deviceSettings: {
        readTransmission: async (...args: unknown[]) => { calls.push(["readTransmission", ...args]); return { ok: true }; },
        writeTransmission: async (...args: unknown[]) => { calls.push(["writeTransmission", ...args]); return { ok: true }; },
        readCamera: async (...args: unknown[]) => { calls.push(["readCamera", ...args]); return { ok: true }; },
        writeCamera: async (...args: unknown[]) => { calls.push(["writeCamera", ...args]); return { ok: true }; },
      },
      flightControl: {},
      settingsAllowed: () => true,
    });

    await expect(actions.writeTransmission("relay-a", undefined)).resolves.toEqual({ ok: true, value: { ok: true } });
    await expect(actions.writeCamera("relay-a", undefined)).resolves.toEqual({ ok: true, value: { ok: true } });
    expect(calls).toEqual([["writeTransmission", "relay-a"], ["writeCamera", "relay-a"]]);
  });

  it("飞控确认只委托公开确认接口并保留下游拒绝结果", async () => {
    const actions = WorkflowActions.create({
      online: () => true,
      assignedRoute: () => null,
      missionControl: {},
      liveStreamControl: {},
      deviceSettings: {},
      flightControl: { confirm: async (deviceId: string, confirmationId: string) => ({ ok: false, code: `${deviceId}:${confirmationId}` }) },
      settingsAllowed: () => true,
    });

    await expect(actions.confirmFlight("relay-a", "confirm-a")).resolves.toEqual({
      ok: true,
      value: { ok: false, code: "relay-a:confirm-a" },
    });
  });

  it("对非法设备、离线设备和读取在线状态异常稳定拒绝且不调用下游", async () => {
    const calls: string[] = [];
    const actions = WorkflowActions.create({
      online: (deviceId: string) => { if (deviceId === "fault") throw new Error("unreadable"); return false; },
      assignedRoute: () => "route-a",
      missionControl: { upload: async () => { calls.push("upload"); } },
      liveStreamControl: { start: async () => { calls.push("stream"); } },
      deviceSettings: { readCamera: async () => { calls.push("camera"); } },
      flightControl: { request: () => { calls.push("flight"); } },
      settingsAllowed: () => true,
    });

    await expect(actions.mission("upload", "")).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    await expect(actions.startStream("relay-a")).resolves.toEqual({ ok: false, code: "DEVICE_OFFLINE" });
    await expect(actions.readCamera("fault")).resolves.toEqual({ ok: false, code: "DEVICE_OFFLINE" });
    expect(actions.requestFlight("relay-a", "takeoff")).toEqual({ ok: false, code: "DEVICE_OFFLINE" });
    expect(calls).toEqual([]);
  });

  it("将缺失、抛出和空返回的异步依赖统一成稳定结果", async () => {
    const actions = WorkflowActions.create({
      online: () => true,
      assignedRoute: () => { throw new Error("route lookup"); },
      missionControl: { upload: async () => undefined },
      liveStreamControl: { start: async () => { throw new Error("stream"); } },
      deviceSettings: {},
      flightControl: {},
      settingsAllowed: () => true,
    });

    await expect(actions.stage("relay-a")).resolves.toEqual({ ok: false, code: "ROUTE_NOT_ASSIGNED" });
    await expect(actions.mission("upload", "relay-a")).resolves.toEqual({ ok: true });
    await expect(actions.startStream("relay-a")).resolves.toEqual({ ok: false, code: "DEPENDENCY_FAILURE" });
    await expect(actions.stopStream("relay-a")).resolves.toEqual({ ok: false, code: "DEPENDENCY_FAILURE" });
    await expect(actions.readTransmission("relay-a")).resolves.toEqual({ ok: false, code: "DEPENDENCY_FAILURE" });
  });

  it("为两类设置分别覆盖能力拒绝、能力异常、读写以及附带补丁", async () => {
    const calls: unknown[][] = [];
    const actions = WorkflowActions.create({
      online: () => true,
      assignedRoute: () => null,
      missionControl: {},
      liveStreamControl: {},
      deviceSettings: {
        readTransmission: async (...args: unknown[]) => { calls.push(args); return "transmission"; },
        writeTransmission: async (...args: unknown[]) => { calls.push(args); return "transmission-write"; },
        readCamera: async (...args: unknown[]) => { calls.push(args); return "camera"; },
        writeCamera: async (...args: unknown[]) => { calls.push(args); return "camera-write"; },
      },
      flightControl: {},
      settingsAllowed: (_deviceId: string, operation: string) => {
        if (operation === "camera-settings") throw new Error("capability unavailable");
        return true;
      },
    });

    await expect(actions.readTransmission("relay-a")).resolves.toEqual({ ok: true, value: "transmission" });
    await expect(actions.writeTransmission("relay-a", { bandwidth: "20" })).resolves.toEqual({ ok: true, value: "transmission-write" });
    await expect(actions.readCamera("relay-a")).resolves.toEqual({ ok: false, code: "CAPABILITY_BLOCKED" });
    await expect(actions.writeCamera("relay-a", { iso: 100 })).resolves.toEqual({ ok: false, code: "CAPABILITY_BLOCKED" });
    expect(calls).toEqual([["relay-a"], ["relay-a", { bandwidth: "20" }]]);
  });

  it("飞控请求、确认和取消对同步异常、非法确认和成功返回保持隔离", async () => {
    const calls: unknown[][] = [];
    const actions = WorkflowActions.create({
      online: () => true,
      assignedRoute: () => null,
      missionControl: {},
      liveStreamControl: {},
      deviceSettings: {},
      flightControl: {
        request: (...args: unknown[]) => { calls.push(args); throw new Error("request"); },
        confirm: async (...args: unknown[]) => { calls.push(args); throw new Error("confirm"); },
        cancel: (...args: unknown[]) => { calls.push(args); return undefined; },
      },
      settingsAllowed: () => true,
    });

    expect(actions.requestFlight("relay-a", "takeoff")).toEqual({ ok: false, code: "DEPENDENCY_FAILURE" });
    await expect(actions.confirmFlight("relay-a", "")).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    await expect(actions.confirmFlight("relay-a", "confirm-a")).resolves.toEqual({ ok: false, code: "DEPENDENCY_FAILURE" });
    expect(actions.cancelFlight("", "confirm-a")).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(actions.cancelFlight("relay-a", "")).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(actions.cancelFlight("relay-a", "confirm-a")).toEqual({ ok: true });
    expect(calls).toEqual([["relay-a", "takeoff"], ["relay-a", "confirm-a"], ["relay-a", "confirm-a"]]);
  });

  it("隔离畸形依赖读取、未分配航线、缺失同步飞控和确认时断线", async () => {
    let online = true;
    const throwingTarget = Object.defineProperty({}, "upload", { get: () => { throw new Error("getter"); } });
    const actions = WorkflowActions.create({
      online: () => online,
      assignedRoute: () => null,
      missionControl: throwingTarget,
      liveStreamControl: {},
      deviceSettings: {},
      flightControl: {},
      settingsAllowed: () => true,
    });
    const nonObjectActions = WorkflowActions.create({
      online: () => true,
      assignedRoute: () => "route-a",
      missionControl: "invalid" as never,
      liveStreamControl: {},
      deviceSettings: {},
      flightControl: {},
      settingsAllowed: () => true,
    });

    await expect(actions.stage("relay-a")).resolves.toEqual({ ok: false, code: "ROUTE_NOT_ASSIGNED" });
    await expect(actions.mission("upload", "relay-a")).resolves.toEqual({ ok: false, code: "DEPENDENCY_FAILURE" });
    expect(actions.requestFlight("relay-a", "takeoff")).toEqual({ ok: false, code: "DEPENDENCY_FAILURE" });
    await expect(nonObjectActions.mission("upload", "relay-a")).resolves.toEqual({ ok: false, code: "DEPENDENCY_FAILURE" });
    online = false;
    await expect(actions.confirmFlight("relay-a", "confirm-a")).resolves.toEqual({ ok: false, code: "DEVICE_OFFLINE" });
  });
});
