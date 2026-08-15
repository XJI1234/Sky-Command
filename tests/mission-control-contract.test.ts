import { describe, expect, it } from "vitest";
import { MissionControl } from "../src/modules/mission-control/index.js";

describe("飞行任务控制模块契约", () => {
  it("通过唯一根接口将航线暂存委托给指定手机的独立任务轨道", async () => {
    const control = MissionControl.create({
      routeSource: { getMissionPayload: () => ({ ok: true as const, value: { routeId: "route-1", fileName: "survey.kmz", sizeBytes: 3, sha256: "a".repeat(64), bytes: new Uint8Array([1, 2, 3]) } }) },
      relay: {
        sendMission: async (_deviceId: string, payload: { missionId: string }) => ({ deviceId: "phone-1", missionId: payload.missionId, status: "succeeded" as const, detail: "accepted" }),
        sendCommand: async () => ({ deviceId: "phone-1", commandId: "command-1", status: "succeeded" as const, detail: "ok" }),
        latestTelemetry: () => null,
        subscribe: () => () => undefined
      }
    }, { createMissionId: () => "mission-1" });

    await expect(control.stage("phone-1", "route-1")).resolves.toMatchObject({ ok: true, state: { phase: "staged", routeId: "route-1" } });
    expect(control.get("phone-1")).toMatchObject({ missionId: "mission-1", phase: "staged" });
  });

  it("只在已观察到在线设备后，才将其消失协调为任务断线", async () => {
    let receiveRelaySnapshot!: (snapshot: unknown) => void;
    const commands: unknown[] = [];
    const control = MissionControl.create({
      routeSource: { getMissionPayload: () => ({ ok: true as const, value: { routeId: "route-1", fileName: "survey.kmz", sizeBytes: 3, sha256: "a".repeat(64), bytes: new Uint8Array([1, 2, 3]) } }) },
      relay: {
        sendMission: async (_deviceId: string, payload: { missionId: string }) => ({ deviceId: "phone-1", missionId: payload.missionId, status: "succeeded" as const, detail: "accepted" }),
        sendCommand: async (_deviceId: string, command: unknown) => { commands.push(command); return { deviceId: "phone-1", commandId: "command-1", status: "succeeded" as const, detail: "ok" }; },
        latestTelemetry: () => null,
        subscribe: (listener) => { receiveRelaySnapshot = listener; return () => undefined; }
      }
    }, { createMissionId: () => "mission-1" });

    await control.stage("phone-1", "route-1");
    receiveRelaySnapshot({ devices: [{ deviceId: "phone-1" }] });
    expect(control.get("phone-1").phase).toBe("staged");
    receiveRelaySnapshot({ devices: [] });

    expect(control.get("phone-1")).toMatchObject({ phase: "disconnected", missionId: "mission-1" });
    expect(commands).toEqual([]);
  });

  it("只将从多设备快照中消失的独立任务轨道标记为断线", async () => {
    let receiveRelaySnapshot!: (snapshot: unknown) => void;
    const control = MissionControl.create({
      routeSource: { getMissionPayload: () => ({ ok: true as const, value: { routeId: "route-1", fileName: "survey.kmz", sizeBytes: 3, sha256: "a".repeat(64), bytes: new Uint8Array([1, 2, 3]) } }) },
      relay: {
        sendMission: async (_deviceId, payload) => ({ deviceId: "phone-1", missionId: payload.missionId, status: "succeeded" as const, detail: "accepted" }),
        sendCommand: async () => ({ deviceId: "phone-1", commandId: "command-1", status: "succeeded" as const, detail: "ok" }),
        latestTelemetry: () => null,
        subscribe: (listener) => { receiveRelaySnapshot = listener; return () => undefined; }
      }
    }, { createMissionId: (deviceId) => `mission-${deviceId}` });

    await control.stage("phone-1", "route-1");
    await control.stage("phone-2", "route-1");
    receiveRelaySnapshot({ devices: [{ deviceId: "phone-1" }, { deviceId: "phone-2" }] });
    receiveRelaySnapshot({ devices: [{ deviceId: "phone-2" }] });

    expect(control.get("phone-1").phase).toBe("disconnected");
    expect(control.get("phone-2").phase).toBe("staged");
  });

  it("设备重连时保持任务为已断线，既不伪造阶段恢复也不发送航线命令", async () => {
    let receiveRelaySnapshot!: (snapshot: unknown) => void;
    const commands: unknown[] = [];
    const control = MissionControl.create({
      routeSource: { getMissionPayload: () => ({ ok: true as const, value: { routeId: "route-1", fileName: "survey.kmz", sizeBytes: 3, sha256: "a".repeat(64), bytes: new Uint8Array([1, 2, 3]) } }) },
      relay: {
        sendMission: async (_deviceId, payload) => ({ deviceId: "phone-1", missionId: payload.missionId, status: "succeeded" as const, detail: "accepted" }),
        sendCommand: async (_deviceId, command) => { commands.push(command); return { deviceId: "phone-1", commandId: "command-1", status: "succeeded" as const, detail: "ok" }; },
        latestTelemetry: () => null,
        subscribe: (listener) => { receiveRelaySnapshot = listener; return () => undefined; }
      }
    }, { createMissionId: () => "mission-1" });

    await control.stage("phone-1", "route-1");
    receiveRelaySnapshot({ devices: [{ deviceId: "phone-1" }] });
    receiveRelaySnapshot({ devices: [] });
    receiveRelaySnapshot({ devices: [{ deviceId: "phone-1" }] });

    expect(control.get("phone-1")).toMatchObject({ phase: "disconnected", missionId: "mission-1", routeId: "route-1" });
    expect(commands).toEqual([]);
  });

  it("隔离订阅和退订依赖的异常", () => {
    const dependency = { routeSource: { getMissionPayload: () => ({ ok: false as const, error: { code: "ROUTE_NOT_FOUND" } }) }, relay: { sendMission: async () => ({ deviceId: "phone-1", missionId: "mission-1", status: "succeeded" as const, detail: "ok" }), sendCommand: async () => ({ deviceId: "phone-1", commandId: "command", status: "succeeded" as const, detail: "ok" }), latestTelemetry: () => null } };
    const failedSubscribe = MissionControl.create({ ...dependency, relay: { ...dependency.relay, subscribe: () => { throw new Error("subscribe unavailable"); } } }, { createMissionId: () => "mission-1" });
    const failedUnsubscribe = MissionControl.create({ ...dependency, relay: { ...dependency.relay, subscribe: () => () => { throw new Error("unsubscribe unavailable"); } } }, { createMissionId: () => "mission-1" });

    expect(() => failedSubscribe.dispose()).not.toThrow();
    expect(() => failedUnsubscribe.dispose()).not.toThrow();

    let unsubscribeCalls = 0;
    const countedUnsubscribe = MissionControl.create({ ...dependency, relay: { ...dependency.relay, subscribe: () => () => { unsubscribeCalls += 1; } } }, { createMissionId: () => "mission-1" });
    countedUnsubscribe.dispose();
    countedUnsubscribe.dispose();
    expect(unsubscribeCalls).toBe(1);
  });

  it("仅在手机上报实际进入航线后把已提交的启动变为执行中", async () => {
    let receiveRelaySnapshot!: (snapshot: unknown) => void;
    const control = MissionControl.create({
      routeSource: { getMissionPayload: () => ({ ok: true as const, value: { routeId: "route-1", fileName: "survey.kmz", sizeBytes: 3, sha256: "a".repeat(64), bytes: new Uint8Array([1, 2, 3]) } }) },
      relay: {
        sendMission: async (_deviceId, payload) => ({ deviceId: "phone-1", missionId: payload.missionId, status: "succeeded" as const, detail: "accepted" }),
        sendCommand: async () => ({ deviceId: "phone-1", commandId: "command-1", status: "succeeded" as const, detail: "accepted" }),
        latestTelemetry: () => ({ deviceId: "phone-1", payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true, isFlying: false, motorsOn: false, batteryPercent: 90 }, capabilities: { waypointMission: true, waypointMissionSupport: "supported" as const } }),
        subscribe: (listener) => { receiveRelaySnapshot = listener; return () => undefined; }
      }
    }, { createMissionId: () => "mission-1" });

    await control.stage("phone-1", "route-1");
    await control.upload("phone-1");
    await control.start("phone-1");
    expect(control.get("phone-1")).toMatchObject({ phase: "starting" });
    expect(control.get("phone-1").phase).toBe("starting");

    receiveRelaySnapshot({ devices: [{ deviceId: "phone-1" }], missionPhases: [{ deviceId: "phone-1", missionRevision: 1, deviceGeneration: 0, sequence: 1, phase: "START_POINT_REACHED", fileName: "survey.kmz" }] });
    expect(control.get("phone-1")).toMatchObject({ phase: "starting" });

    receiveRelaySnapshot({ devices: [{ deviceId: "phone-1" }], missionPhases: [{ deviceId: "phone-1", missionRevision: 1, deviceGeneration: 0, sequence: 2, phase: "ROUTE_EXECUTION_STARTED", fileName: "survey.kmz" }] });
    expect(control.get("phone-1")).toMatchObject({ phase: "running" });
  });

  it("只接受与当前任务匹配的 Android 终态遥测，并保留启动与执行的区别", async () => {
    let receiveRelaySnapshot!: (snapshot: unknown) => void;
    const control = MissionControl.create({
      routeSource: { getMissionPayload: () => ({ ok: true as const, value: { routeId: "route-1", fileName: "survey.kmz", sizeBytes: 3, sha256: "a".repeat(64), bytes: new Uint8Array([1, 2, 3]) } }) },
      relay: {
        sendMission: async (_deviceId, payload) => ({ deviceId: "phone-1", missionId: payload.missionId, status: "succeeded" as const, detail: "accepted" }),
        sendCommand: async () => ({ deviceId: "phone-1", commandId: "command-1", status: "succeeded" as const, detail: "accepted" }),
        latestTelemetry: () => ({ deviceId: "phone-1", payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true, isFlying: false, motorsOn: false, batteryPercent: 90 }, capabilities: { waypointMission: true, waypointMissionSupport: "supported" as const } }),
        subscribe: (listener) => { receiveRelaySnapshot = listener; return () => undefined; }
      }
    }, { createMissionId: () => "mission-1" });

    await control.stage("phone-1", "route-1");
    await control.upload("phone-1");
    await control.start("phone-1");
    receiveRelaySnapshot({
      devices: [{ deviceId: "phone-1" }],
      missionPhases: [],
      telemetry: [{
        deviceId: "phone-1",
        payload: { kind: "object", fields: { missionExecution: { kind: "string", value: "FINISHED" }, missionFileName: { kind: "string", value: "survey.kmz" } } },
      }],
    });
    expect(control.get("phone-1")).toMatchObject({ phase: "completed" });

    const failed = MissionControl.create({
      routeSource: { getMissionPayload: () => ({ ok: true as const, value: { routeId: "route-1", fileName: "survey.kmz", sizeBytes: 3, sha256: "a".repeat(64), bytes: new Uint8Array([1, 2, 3]) } }) },
      relay: {
        sendMission: async (_deviceId, payload) => ({ deviceId: "phone-1", missionId: payload.missionId, status: "succeeded" as const, detail: "accepted" }),
        sendCommand: async () => ({ deviceId: "phone-1", commandId: "command-1", status: "succeeded" as const, detail: "accepted" }),
        latestTelemetry: () => ({ deviceId: "phone-1", payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true, isFlying: false, motorsOn: false, batteryPercent: 90 }, capabilities: { waypointMission: true, waypointMissionSupport: "supported" as const } }),
        subscribe: (listener) => { receiveRelaySnapshot = listener; return () => undefined; }
      }
    }, { createMissionId: () => "mission-1" });
    await failed.stage("phone-1", "route-1");
    await failed.upload("phone-1");
    await failed.start("phone-1");
    receiveRelaySnapshot({ devices: [{ deviceId: "phone-1" }], missionPhases: [], telemetry: [{ deviceId: "phone-1", payload: { kind: "object", fields: { missionExecution: { kind: "string", value: "FAILED" }, missionFileName: { kind: "string", value: "other.kmz" } } } }] });
    expect(failed.get("phone-1").phase).toBe("starting");
  });

  it("忽略无效快照，并在释放后隔离迟到的中继事件", async () => {
    let receiveRelaySnapshot!: (snapshot: unknown) => void;
    const control = MissionControl.create({
      routeSource: { getMissionPayload: () => ({ ok: true as const, value: { routeId: "route-1", fileName: "survey.kmz", sizeBytes: 3, sha256: "a".repeat(64), bytes: new Uint8Array([1, 2, 3]) } }) },
      relay: {
        sendMission: async (_deviceId: string, payload: { missionId: string }) => ({ deviceId: "phone-1", missionId: payload.missionId, status: "succeeded" as const, detail: "accepted" }),
        sendCommand: async () => ({ deviceId: "phone-1", commandId: "command-1", status: "succeeded" as const, detail: "ok" }), latestTelemetry: () => null,
        subscribe: (listener) => { receiveRelaySnapshot = listener; return () => undefined; }
      }
    }, { createMissionId: () => "mission-1" });
    await control.stage("phone-1", "route-1");
    receiveRelaySnapshot({ devices: [{ deviceId: "phone-1" }] });
    receiveRelaySnapshot(null);
    receiveRelaySnapshot(7);
    receiveRelaySnapshot({ devices: [{ unexpected: "field" }] });
    expect(control.get("phone-1").phase).toBe("staged");
    control.dispose();
    control.dispose();
    receiveRelaySnapshot({ devices: [] });
    expect(control.get("phone-1").phase).toBe("staged");
  });

  it("完整委托上传、启动前检查、暂停恢复停止、目录和清理操作", async () => {
    const control = MissionControl.create({ routeSource: { getMissionPayload: () => ({ ok: true as const, value: { routeId: "route-1", fileName: "survey.kmz", sizeBytes: 3, sha256: "a".repeat(64), bytes: new Uint8Array([1, 2, 3]) } }) }, relay: { sendMission: async (_id, payload) => ({ deviceId: "phone-1", missionId: payload.missionId, status: "succeeded" as const, detail: "ok" }), sendCommand: async () => ({ deviceId: "phone-1", commandId: "command", status: "succeeded" as const, detail: "ok" }), latestTelemetry: () => ({ deviceId: "phone-1", payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true, isFlying: false, motorsOn: false, batteryPercent: 80 }, capabilities: { waypointMission: true, waypointMissionSupport: "supported" } }), subscribe: () => () => undefined } }, { createMissionId: () => "mission-1" });
    await control.stage("phone-1", "route-1");
    expect((await control.upload("phone-1")).ok).toBe(true);
    expect((await control.start("phone-1")).ok).toBe(true);
    expect((await control.pause("phone-1")).ok).toBe(false);
    expect((await control.resume("phone-1")).ok).toBe(false);
    expect((await control.stop("phone-1")).ok).toBe(true);
    expect(control.list()).toHaveLength(1);
    expect(control.forget("phone-1")).toBe(true);
  });
});
