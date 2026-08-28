import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OperationWorkflow } from "../src/production/operation-workflow/index.js";
import { OperatorConsole } from "../src/production/operator-console/index.js";
import { RouteLibrary } from "../src/modules/route-library/index.js";

const readyHardware = { lanAddressAvailable: true, legacyMediaAvailable: true, sessionStableAfterMs: 0 };

const workflowWith = (overrides: Record<string, unknown> = {}) => OperationWorkflow.create({
  relayOperations: { devices: () => [{ deviceId: "relay-a" }], telemetry: () => ({ payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true }, capabilities: {} }), subscribe: () => () => undefined },
  routeLibrary: { list: () => [{ routeId: "route-a", classification: "upload-candidate" }], importFile: async () => ({ status: "cancelled" }), getPreview: () => ({ ok: true }), remove: () => ({ ok: true }), select: () => ({ ok: true }), getMissionPayload: () => ({ ok: false }), getSelected: () => null, clear: () => undefined },
  missionControl: { stage: async () => ({ ok: true }), upload: async () => ({ ok: true }), start: async () => ({ ok: true }), pause: async () => ({ ok: true }), resume: async () => ({ ok: true }), stop: async () => ({ ok: true }), get: (deviceId: string) => ({ deviceId, phase: "idle" }), list: () => [], forget: () => true, subscribe: () => () => undefined, dispose: () => undefined },
  liveStreamControl: { start: async () => ({ ok: true }), stop: async () => ({ ok: true }), get: () => ({ phase: "idle" }), list: () => [], recordDisconnected: () => undefined, forget: () => false, subscribe: () => () => undefined },
  mediaPipeline: { snapshot: () => ({ streams: [] }), evaluate: () => ({ ok: true }), selectPlayer: () => ({ ok: true }), clearPlayer: () => ({ ok: true }) },
  flightControl: { request: () => ({ ok: true, confirmation: { confirmationId: "confirm-a" } }), confirm: async () => ({ ok: true }), cancel: () => ({ ok: true }), get: () => null, subscribe: () => () => undefined, dispose: () => undefined },
  deviceSettings: { snapshot: () => ({}), readTransmission: async () => ({ ok: true }), writeTransmission: async () => ({ ok: true }), readCamera: async () => ({ ok: true }), writeCamera: async () => ({ ok: true }) },
  hardwareReadiness: readyHardware,
  now: () => 1,
  ...overrides,
} as never);

describe("飞行作业工作流模块契约", () => {
  it("内部模块契约反映已实施的公开接口", () => {
    const contract = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
    const workflow = contract("src/production/operation-workflow/CONTRACT.md");
    const registry = contract("src/production/operation-workflow/assignment-registry/CONTRACT.md");
    const actions = contract("src/production/operation-workflow/workflow-actions/CONTRACT.md");
    const subscriptions = contract("src/production/operation-workflow/workflow-subscriptions/CONTRACT.md");

    for (const value of [workflow, registry, actions, subscriptions]) {
      expect(value).not.toContain("待实施");
    }
    expect(workflow).not.toContain("实现前必须");
    expect(registry).toContain("instance.assign(deviceId, routeId) -> boolean");
    expect(registry).toContain("instance.clear(deviceId) -> boolean");
    expect(subscriptions).toContain("WorkflowSubscriptions.create(sources, onChange) -> instance");
    expect(subscriptions).toContain("instance.dispose() -> void");
    expect(subscriptions).not.toContain("instance.subscribe(listener)");
  });

  it("只允许给在线设备分配合格航线，并通过任务控制暂存该分配", async () => {
    const staged: unknown[] = [];
    const workflow = OperationWorkflow.create({
      relayOperations: {
        devices: () => [{ deviceId: "relay-a" }],
        telemetry: () => null,
        subscribe: () => () => undefined
      },
      routeLibrary: {
        list: () => [{ routeId: "route-ok", displayName: "survey.kmz", classification: "upload-candidate" }],
        select: () => ({ ok: true, value: {} }),
        get: () => ({ ok: true, value: {} }),
        importFile: async () => ({ status: "cancelled" as const }),
        getPreview: () => ({ ok: false, error: { code: "ROUTE_NOT_FOUND" } }),
        remove: () => ({ ok: true, value: null }),
        getMissionPayload: () => ({ ok: false, error: { code: "ROUTE_NOT_FOUND" } }),
        getSelected: () => null,
        clear: () => undefined
      },
      missionControl: {
        stage: async (deviceId: string, routeId: string) => { staged.push({ deviceId, routeId }); return { ok: true as const, operation: "stage" as const, state: { deviceId, routeId, missionId: "mission-1", phase: "staged", failureCode: null, lastResult: null } }; },
        upload: async () => ({ ok: false as const, operation: "upload" as const, code: "ILLEGAL_PHASE" as const, state: null }),
        start: async () => ({ ok: false as const, operation: "start" as const, code: "ILLEGAL_PHASE" as const, state: null }),
        pause: async () => ({ ok: false as const, operation: "pause" as const, code: "ILLEGAL_PHASE" as const, state: null }),
        resume: async () => ({ ok: false as const, operation: "resume" as const, code: "ILLEGAL_PHASE" as const, state: null }),
        stop: async () => ({ ok: false as const, operation: "stop" as const, code: "ILLEGAL_PHASE" as const, state: null }),
        get: (deviceId: string) => ({ deviceId, routeId: null, missionId: null, phase: "idle" as const, failureCode: null, lastResult: null }),
        list: () => [], forget: () => false, subscribe: () => () => undefined, dispose: () => undefined
      },
      liveStreamControl: { start: async () => ({ ok: false, code: "unused" }), stop: async () => ({ ok: false, code: "unused" }), get: () => ({ phase: "idle" }), list: () => [], recordDisconnected: () => null, forget: () => false, subscribe: () => () => undefined },
      mediaPipeline: { snapshot: () => ({ phase: "idle", streams: [], player: {} }), evaluate: () => ({ ok: true, value: {} }), selectPlayer: () => ({ ok: true, value: {} }), clearPlayer: () => ({ ok: true, value: {} }) },
      flightControl: { request: () => ({ ok: false, code: "unused" }), confirm: async () => ({ ok: false, code: "unused" }), cancel: () => ({ ok: false, code: "unused" }), get: () => null, subscribe: () => () => undefined, dispose: () => undefined },
      deviceSettings: { snapshot: () => ({}), readTransmission: async () => ({}), writeTransmission: async () => ({}), readCamera: async () => ({}), writeCamera: async () => ({}) },
      now: () => 1
    });

    expect(workflow.assignRoute("relay-a", "route-ok")).toMatchObject({ ok: true });
    await expect(workflow.stage("relay-a")).resolves.toMatchObject({ ok: true });
    expect(staged).toEqual([{ deviceId: "relay-a", routeId: "route-ok" }]);
    expect(workflow.assignRoute("offline", "route-ok")).toMatchObject({ ok: false, code: "DEVICE_OFFLINE" });
  });

  it("只投影在线设备，并在设备断连时清除分配和取消尚未确认的飞控动作", async () => {
    let relayListener!: () => void;
    const cancelled: unknown[] = [];
    let online = true;
    const workflow = OperationWorkflow.create({
      relayOperations: {
        devices: () => online ? [{ deviceId: "relay-a" }] : [],
        telemetry: () => ({ payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true, batteryPercent: 80, isFlying: false }, capabilities: { waypointMission: true, waypointMissionSupport: "supported", liveVideo: true } }),
        subscribe: (listener: () => void) => { relayListener = listener; return () => undefined; }
      },
      routeLibrary: { list: () => [{ routeId: "route-ok", displayName: "survey.kmz", classification: "upload-candidate" }], select: () => ({ ok: true, value: {} }), get: () => ({ ok: true, value: {} }), importFile: async () => ({ status: "cancelled" as const }), getPreview: () => ({ ok: false, error: { code: "ROUTE_NOT_FOUND" } }), remove: () => ({ ok: true, value: null }), getMissionPayload: () => ({ ok: false, error: { code: "ROUTE_NOT_FOUND" } }), getSelected: () => null, clear: () => undefined },
      missionControl: { stage: async () => ({ ok: false }), upload: async () => ({ ok: false }), start: async () => ({ ok: false }), pause: async () => ({ ok: false }), resume: async () => ({ ok: false }), stop: async () => ({ ok: false }), get: (deviceId: string) => ({ deviceId, routeId: null, missionId: null, phase: "idle", failureCode: null, lastResult: null }), list: () => [], forget: () => false, subscribe: () => () => undefined, dispose: () => undefined },
      liveStreamControl: { start: async () => ({ ok: false }), stop: async () => ({ ok: false }), get: () => ({ phase: "idle" }), list: () => [], recordDisconnected: () => null, forget: () => false, subscribe: () => () => undefined },
      mediaPipeline: { snapshot: () => ({ phase: "running", streams: [], player: {} }), evaluate: () => ({ ok: true, value: {} }), selectPlayer: () => ({ ok: true, value: {} }), clearPlayer: () => ({ ok: true, value: {} }) },
      flightControl: { request: () => ({ ok: true, code: "CONFIRMATION_REQUIRED", confirmation: { deviceId: "relay-a", action: "takeoff", confirmationId: "confirm-1" } }), confirm: async () => ({ ok: false }), cancel: (deviceId: string, confirmationId: string) => { cancelled.push({ deviceId, confirmationId }); return { ok: true, code: "CANCELLED" }; }, get: () => null, subscribe: () => () => undefined, dispose: () => undefined },
      deviceSettings: { snapshot: () => ({}), readTransmission: async () => ({}), writeTransmission: async () => ({}), readCamera: async () => ({}), writeCamera: async () => ({}) }, hardwareReadiness: readyHardware, now: () => 1
    });

    expect(workflow.assignRoute("relay-a", "route-ok")).toMatchObject({ ok: true });
    expect(workflow.requestFlightAction("relay-a", "takeoff")).toMatchObject({ ok: true });
    expect(workflow.snapshot()).toMatchObject({ devices: [{ deviceId: "relay-a", assignment: { routeId: "route-ok" }, connection: { sdk: "ready", aircraft: "connected" } }] });
    online = false;
    relayListener();
    expect(cancelled).toEqual([{ deviceId: "relay-a", confirmationId: "confirm-1" }]);
    expect(workflow.snapshot().devices).toEqual([]);
    await expect(workflow.stage("relay-a")).resolves.toMatchObject({ ok: false, code: "DEVICE_OFFLINE" });
  });

  it("只通过航线库选择航线，且不替换已经分配给设备的航线", () => {
    const selected: string[] = [];
    const workflow = OperationWorkflow.create({
      relayOperations: { devices: () => [{ deviceId: "relay-a" }], telemetry: () => ({ payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true }, capabilities: {} }), subscribe: () => () => undefined },
      routeLibrary: { list: () => [{ routeId: "route-a", displayName: "a.kmz", classification: "upload-candidate" }, { routeId: "route-b", displayName: "b.kmz", classification: "upload-candidate" }], select: (routeId: string) => { selected.push(routeId); return { ok: true, value: { routeId } }; }, get: () => ({ ok: true, value: {} }), importFile: async () => ({ status: "cancelled" as const }), getPreview: () => ({ ok: false, error: { code: "ROUTE_NOT_FOUND" } }), remove: () => ({ ok: true, value: null }), getMissionPayload: () => ({ ok: false, error: { code: "ROUTE_NOT_FOUND" } }), getSelected: () => null, clear: () => undefined },
      missionControl: { stage: async () => ({ ok: false }), upload: async () => ({ ok: false }), start: async () => ({ ok: false }), pause: async () => ({ ok: false }), resume: async () => ({ ok: false }), stop: async () => ({ ok: false }), get: (deviceId: string) => ({ deviceId, phase: "idle" }), list: () => [], forget: () => false, subscribe: () => () => undefined, dispose: () => undefined }, liveStreamControl: { start: async () => ({ ok: false }), stop: async () => ({ ok: false }), get: () => ({ phase: "idle" }), list: () => [], recordDisconnected: () => null, forget: () => false, subscribe: () => () => undefined }, mediaPipeline: { snapshot: () => ({ streams: [] }), evaluate: () => ({ ok: true }), selectPlayer: () => ({ ok: true }), clearPlayer: () => ({ ok: true }) }, flightControl: { request: () => ({ ok: false }), confirm: async () => ({ ok: false }), cancel: () => ({ ok: false }), get: () => null, subscribe: () => () => undefined, dispose: () => undefined }, deviceSettings: { snapshot: () => ({}), readTransmission: async () => ({}), writeTransmission: async () => ({}), readCamera: async () => ({}), writeCamera: async () => ({}) }, now: () => 1
    });
    workflow.assignRoute("relay-a", "route-a");
    expect(workflow.selectRoute("route-b")).toMatchObject({ ok: true });
    expect(selected).toEqual(["route-b"]);
    expect(workflow.snapshot()).toMatchObject({ selectedRouteId: "route-b", devices: [{ assignment: { routeId: "route-a" } }] });
  });

  it("将图传、媒体、设置和飞控确认精确委托给既有模块", async () => {
    const calls: string[] = [];
    const workflow = OperationWorkflow.create({
      relayOperations: { devices: () => [{ deviceId: "relay-a" }], telemetry: () => ({ payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true }, capabilities: {} }), subscribe: () => () => undefined },
      routeLibrary: { list: () => [], select: () => ({ ok: false }), get: () => ({ ok: false }), importFile: async () => ({ status: "cancelled" as const }), getPreview: () => ({ ok: false }), remove: () => ({ ok: false }), getMissionPayload: () => ({ ok: false }), getSelected: () => null, clear: () => undefined },
      missionControl: { stage: async () => ({ ok: false }), upload: async (id: string) => { calls.push(`upload:${id}`); return { ok: true }; }, start: async () => ({ ok: false }), pause: async () => ({ ok: false }), resume: async () => ({ ok: false }), stop: async () => ({ ok: false }), get: (deviceId: string) => ({ deviceId, phase: "idle" }), list: () => [], forget: () => false, subscribe: () => () => undefined, dispose: () => undefined },
      liveStreamControl: { start: async (id: string) => { calls.push(`stream-start:${id}`); return { ok: true }; }, stop: async (id: string) => { calls.push(`stream-stop:${id}`); return { ok: true }; }, get: () => ({ phase: "idle" }), list: () => [], recordDisconnected: () => null, forget: () => false, subscribe: () => () => undefined },
      mediaPipeline: { snapshot: () => ({ streams: [] }), evaluate: (now: number) => { calls.push(`media:${now}`); return { ok: true }; }, selectPlayer: (id: string) => { calls.push(`player:${id}`); return { ok: true }; }, clearPlayer: () => ({ ok: true }) },
      flightControl: { request: () => ({ ok: true, confirmation: { confirmationId: "confirm-1" } }), confirm: async (id: string, confirmation: string) => { calls.push(`confirm:${id}:${confirmation}`); return { ok: true }; }, cancel: () => ({ ok: true }), get: () => null, subscribe: () => () => undefined, dispose: () => undefined },
      deviceSettings: { snapshot: () => ({}), readTransmission: async (id: string) => { calls.push(`read-transmission:${id}`); return { ok: true }; }, writeTransmission: async (id: string, patch: unknown) => { calls.push(`write-transmission:${id}:${JSON.stringify(patch)}`); return { ok: true }; }, readCamera: async (id: string) => { calls.push(`read-camera:${id}`); return { ok: true }; }, writeCamera: async (id: string, patch: unknown) => { calls.push(`write-camera:${id}:${JSON.stringify(patch)}`); return { ok: true }; } }, hardwareReadiness: readyHardware, now: () => 7
    });
    await workflow.upload("relay-a");
    await workflow.startStream("relay-a");
    await workflow.stopStream("relay-a");
    workflow.refreshMedia();
    await workflow.readTransmissionSettings("relay-a");
    await workflow.writeTransmissionSettings("relay-a", { bandwidth: "BANDWIDTH_20MHZ" });
    await workflow.readCameraSettings("relay-a");
    await workflow.writeCameraSettings("relay-a", { focusMode: "AUTO" });
    workflow.requestFlightAction("relay-a", "takeoff");
    await workflow.confirmFlightAction("relay-a", "confirm-1");
    expect(calls).toEqual(["upload:relay-a", "stream-start:relay-a", "stream-stop:relay-a", "media:7", "read-transmission:relay-a", "write-transmission:relay-a:{\"bandwidth\":\"BANDWIDTH_20MHZ\"}", "read-camera:relay-a", "write-camera:relay-a:{\"focusMode\":\"AUTO\"}", "confirm:relay-a:confirm-1"]);
  });

  it("旧图传媒体不可用时在电脑端阻止向手机在线服务发送启动命令", async () => {
    let starts = 0;
    const workflow = workflowWith({
      liveStreamControl: {
        start: async () => { starts += 1; return { ok: true }; },
        stop: async () => ({ ok: true }),
        get: () => ({ phase: "idle" }),
        list: () => [],
        recordDisconnected: () => undefined,
        forget: () => false,
        subscribe: () => () => undefined,
      },
      hardwareReadiness: { lanAddressAvailable: true, legacyMediaAvailable: false, sessionStableAfterMs: 0 },
    });

    await expect(workflow.startStream("relay-a")).resolves.toMatchObject({
      ok: false,
      code: "HARDWARE_NOT_READY",
      value: { blockers: [{ code: "LEGACY_MEDIA_UNAVAILABLE" }] },
    });
    expect(starts).toBe(0);
  });

  it("工作流快照保留本机播放地址，供 video.playback 读取", () => {
    const workflow = workflowWith({
      mediaPipeline: {
        snapshot: () => ({
          streams: [{ deviceId: "relay-a", phase: "ready", playbackUrl: "http://127.0.0.1:18080/live/stream-1.flv", diagnostic: "private" }],
        }),
        evaluate: () => ({ ok: true }),
        selectPlayer: () => ({ ok: true }),
        clearPlayer: () => ({ ok: true }),
      },
    });
    const snapshot = workflow.snapshot() as { media?: { streams?: readonly unknown[] } };
    expect(snapshot.media).toEqual({
      streams: [{ deviceId: "relay-a", phase: "ready", playbackUrl: "http://127.0.0.1:18080/live/stream-1.flv" }],
    });
    expect(Object.isFrozen(snapshot.media)).toBe(true);
  });

  it("飞机链路已齐时不等待会话稳定计时即可启动图传", async () => {
    const started: string[] = [];
    const workflow = workflowWith({
      hardwareReadiness: { lanAddressAvailable: true, legacyMediaAvailable: true, sessionStableAfterMs: 15_000 },
      now: () => 1,
      liveStreamControl: {
        start: async (id: string) => { started.push(id); return { ok: true }; },
        stop: async () => ({ ok: true }),
        get: () => ({ phase: "idle" }),
        list: () => [],
        recordDisconnected: () => undefined,
        forget: () => false,
        subscribe: () => () => undefined,
      },
    });
    await expect(workflow.startStream("relay-a")).resolves.toMatchObject({ ok: true });
    expect(started).toEqual(["relay-a"]);
  });

  it("会话未满稳定窗口且飞机事实未齐时拒绝图传", async () => {
    let starts = 0;
    const workflow = workflowWith({
      hardwareReadiness: { lanAddressAvailable: true, legacyMediaAvailable: true, sessionStableAfterMs: 15_000 },
      now: () => 1,
      relayOperations: {
        devices: () => [{ deviceId: "relay-a" }],
        telemetry: () => ({ payload: {}, capabilities: {} }),
        subscribe: () => () => undefined,
      },
      liveStreamControl: {
        start: async () => { starts += 1; return { ok: true }; },
        stop: async () => ({ ok: true }),
        get: () => ({ phase: "idle" }),
        list: () => [],
        recordDisconnected: () => undefined,
        forget: () => false,
        subscribe: () => () => undefined,
      },
    });
    await expect(workflow.startStream("relay-a")).resolves.toMatchObject({ ok: false, code: "HARDWARE_NOT_READY" });
    expect(starts).toBe(0);
  });

  it("飞控链路未就绪时在电脑端阻止向手机发送直接飞行动作", () => {
    let requests = 0;
    const workflow = workflowWith({
      relayOperations: {
        devices: () => [{ deviceId: "relay-a" }],
        telemetry: () => ({ payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: false, connected: false } }),
        subscribe: () => () => undefined,
      },
      flightControl: {
        request: () => { requests += 1; return { ok: true, confirmation: { confirmationId: "confirm-a" } }; },
        confirm: async () => ({ ok: true }),
        cancel: () => ({ ok: true }),
        get: () => null,
        subscribe: () => () => undefined,
        dispose: () => undefined,
      },
    });

    expect(workflow.requestFlightAction("relay-a", "takeoff")).toMatchObject({
      ok: false,
      code: "HARDWARE_NOT_READY",
      value: { blockers: [{ code: "FLIGHT_CONTROLLER_DISCONNECTED" }, { code: "AIRCRAFT_DISCONNECTED" }] },
    });
    expect(requests).toBe(0);
  });

  it("导入预览和删除航线时保留航线库语义，并阻止删除已分配航线", async () => {
    const calls: string[] = [];
    const workflow = OperationWorkflow.create({
      relayOperations: { devices: () => [{ deviceId: "relay-a" }], telemetry: () => null, subscribe: () => () => undefined },
      routeLibrary: { list: () => [{ routeId: "route-a", displayName: "a.kmz", classification: "upload-candidate" }], importFile: async (input: { fileName: string }) => { calls.push(`import:${input.fileName}`); return { status: "imported", duplicate: false, route: { routeId: "route-a" } }; }, getPreview: (id: string) => { calls.push(`preview:${id}`); return { ok: true, value: { routeId: id } }; }, remove: (id: string) => { calls.push(`remove:${id}`); return { ok: true, value: null }; }, select: () => ({ ok: false }), get: () => ({ ok: false }), getMissionPayload: () => ({ ok: false }), getSelected: () => null, clear: () => undefined },
      missionControl: { stage: async () => ({ ok: false }), upload: async () => ({ ok: false }), start: async () => ({ ok: false }), pause: async () => ({ ok: false }), resume: async () => ({ ok: false }), stop: async () => ({ ok: false }), get: (deviceId: string) => ({ deviceId, phase: "idle" }), list: () => [], forget: () => true, subscribe: () => () => undefined, dispose: () => undefined }, liveStreamControl: { start: async () => ({ ok: false }), stop: async () => ({ ok: false }), get: () => ({ phase: "idle" }), list: () => [], recordDisconnected: () => null, forget: () => false, subscribe: () => () => undefined }, mediaPipeline: { snapshot: () => ({ streams: [] }), evaluate: () => ({ ok: true }), selectPlayer: () => ({ ok: true }), clearPlayer: () => ({ ok: true }) }, flightControl: { request: () => ({ ok: false }), confirm: async () => ({ ok: false }), cancel: () => ({ ok: false }), get: () => null, subscribe: () => () => undefined, dispose: () => undefined }, deviceSettings: { snapshot: () => ({}), readTransmission: async () => ({}), writeTransmission: async () => ({}), readCamera: async () => ({}), writeCamera: async () => ({}) }, now: () => 1
    });
    await expect(workflow.importRoute({ fileName: "a.kmz", bytes: new Uint8Array() })).resolves.toMatchObject({ ok: true });
    expect(workflow.getRoutePreview("route-a")).toMatchObject({ ok: true });
    workflow.assignRoute("relay-a", "route-a");
    expect(workflow.removeRoute("route-a")).toMatchObject({ ok: false, code: "ROUTE_ASSIGNED" });
    expect(workflow.clearAssignment("relay-a")).toMatchObject({ ok: true });
    expect(workflow.removeRoute("route-a")).toMatchObject({ ok: true });
    expect(calls).toEqual(["import:a.kmz", "preview:route-a", "remove:route-a"]);
  });

  it("在未知链路、活动任务、未就绪画面、故障时钟和释放后安全拒绝动作", async () => {
    const workflow = OperationWorkflow.create({
      relayOperations: { devices: () => [{ deviceId: "relay-a" }], telemetry: () => null, subscribe: () => () => undefined },
      routeLibrary: { list: () => [{ routeId: "route-a", classification: "upload-candidate" }], importFile: async () => { throw new Error("io"); }, getPreview: () => { throw new Error("map"); }, remove: () => ({ ok: true }), select: () => ({ ok: false }), get: () => ({ ok: false }), getMissionPayload: () => ({ ok: false }), getSelected: () => null, clear: () => undefined },
      missionControl: { stage: async () => { throw new Error("relay"); }, upload: async () => ({ ok: false }), start: async () => ({ ok: false }), pause: async () => ({ ok: false }), resume: async () => ({ ok: false }), stop: async () => ({ ok: false }), get: (deviceId: string) => ({ deviceId, phase: "running" }), list: () => [], forget: () => false, subscribe: () => () => undefined, dispose: () => undefined }, liveStreamControl: { start: async () => { throw new Error("stream"); }, stop: async () => ({ ok: false }), get: () => ({ phase: "idle" }), list: () => [], recordDisconnected: () => null, forget: () => false, subscribe: () => () => undefined }, mediaPipeline: { snapshot: () => ({ streams: [] }), evaluate: () => ({ ok: true }), selectPlayer: () => ({ ok: true }), clearPlayer: () => ({ ok: true }) }, flightControl: { request: () => { throw new Error("flight"); }, confirm: async () => ({ ok: false }), cancel: () => ({ ok: false }), get: () => null, subscribe: () => () => undefined, dispose: () => undefined }, deviceSettings: { snapshot: () => ({}), readTransmission: async () => ({ ok: true }), writeTransmission: async () => ({ ok: true }), readCamera: async () => ({ ok: true }), writeCamera: async () => ({ ok: true }) }, now: () => Number.NaN
    });
    expect(workflow.assignRoute("relay-a", "route-a")).toMatchObject({ ok: false, code: "TASK_ACTIVE" });
    await expect(workflow.stage("relay-a")).resolves.toMatchObject({ ok: false, code: "ROUTE_NOT_ASSIGNED" });
    expect(workflow.clearAssignment("relay-a")).toMatchObject({ ok: false, code: "TASK_ACTIVE" });
    expect(workflow.selectVideo("relay-a")).toMatchObject({ ok: false, code: "VIDEO_NOT_READY" });
    expect(workflow.refreshMedia()).toMatchObject({ ok: false, code: "CLOCK_FAILURE" });
    await expect(workflow.readCameraSettings("relay-a")).resolves.toMatchObject({ ok: false, code: "CAPABILITY_BLOCKED" });
    await expect(workflow.startStream("relay-a")).resolves.toMatchObject({ ok: false, code: "HARDWARE_NOT_READY" });
    expect(workflow.requestFlightAction("relay-a", "takeoff")).toMatchObject({ ok: false, code: "HARDWARE_NOT_READY" });
    workflow.dispose();
    expect(workflow.selectRoute("route-a")).toMatchObject({ ok: false, code: "DISPOSED" });
    await expect(workflow.importRoute({})).resolves.toMatchObject({ ok: false, code: "DISPOSED" });
  });

  it("隔离多设备图传与任务操作，并在取消确认后不允许复用", async () => {
    const calls: string[] = [];
    const workflow = OperationWorkflow.create({
      relayOperations: { devices: () => [{ deviceId: "a" }, { deviceId: "b" }], telemetry: () => ({ payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true }, capabilities: {} }), subscribe: () => () => undefined }, routeLibrary: { list: () => [{ routeId: "r", classification: "upload-candidate" }], importFile: async () => ({ status: "cancelled" }), getPreview: () => ({ ok: false }), remove: () => ({ ok: false }), select: () => ({ ok: false }), get: () => ({ ok: false }), getMissionPayload: () => ({ ok: false }), getSelected: () => null, clear: () => undefined }, missionControl: { stage: async (id: string) => { calls.push(`stage:${id}`); return { ok: true }; }, upload: async () => ({ ok: false }), start: async () => ({ ok: false }), pause: async () => ({ ok: false }), resume: async () => ({ ok: false }), stop: async () => ({ ok: false }), get: (deviceId: string) => ({ deviceId, phase: "idle" }), list: () => [], forget: () => false, subscribe: () => () => undefined, dispose: () => undefined }, liveStreamControl: { start: async (id: string) => { calls.push(`stream:${id}`); return { ok: true }; }, stop: async () => ({ ok: false }), get: () => ({ phase: "idle" }), list: () => [], recordDisconnected: () => null, forget: () => false, subscribe: () => () => undefined }, mediaPipeline: { snapshot: () => ({ streams: [] }), evaluate: () => ({ ok: true }), selectPlayer: () => ({ ok: true }), clearPlayer: () => ({ ok: true }) }, flightControl: { request: (id: string) => ({ ok: true, confirmation: { confirmationId: `c-${id}` } }), confirm: async () => ({ ok: false }), cancel: (id: string, confirmation: string) => { calls.push(`cancel:${id}:${confirmation}`); return { ok: true }; }, get: () => null, subscribe: () => () => undefined, dispose: () => undefined }, deviceSettings: { snapshot: () => ({}), readTransmission: async () => ({}), writeTransmission: async () => ({}), readCamera: async () => ({}), writeCamera: async () => ({}) }, hardwareReadiness: readyHardware, now: () => 1
    });
    workflow.assignRoute("a", "r"); workflow.assignRoute("b", "r");
    await workflow.stage("a"); await workflow.startStream("b");
    workflow.requestFlightAction("a", "takeoff");
    expect(workflow.cancelFlightAction("a", "c-a")).toMatchObject({ ok: true });
    expect(calls).toEqual(["stage:a", "stream:b", "cancel:a:c-a"]);
  });

  it("委托完整任务控制、可播放视频选择、任务清理与订阅释放", async () => {
    const calls: string[] = [];
    let unsubscribed = 0;
    const workflow = OperationWorkflow.create({
      relayOperations: { devices: () => [{ deviceId: "a" }], telemetry: () => null, subscribe: () => () => { unsubscribed += 1; } }, routeLibrary: { list: () => [{ routeId: "r", classification: "upload-candidate" }], importFile: async () => ({ status: "cancelled" }), getPreview: () => ({ ok: false }), remove: () => ({ ok: false }), select: () => ({ ok: false }), get: () => ({ ok: false }), getMissionPayload: () => ({ ok: false }), getSelected: () => null, clear: () => undefined }, missionControl: { stage: async () => ({ ok: true }), upload: async (id: string) => { calls.push(`upload:${id}`); return { ok: true }; }, start: async (id: string) => { calls.push(`start:${id}`); return { ok: true }; }, pause: async (id: string) => { calls.push(`pause:${id}`); return { ok: true }; }, resume: async (id: string) => { calls.push(`resume:${id}`); return { ok: true }; }, stop: async (id: string) => { calls.push(`stop:${id}`); return { ok: true }; }, get: (deviceId: string) => ({ deviceId, phase: "completed" }), list: () => [], forget: (id: string) => { calls.push(`forget:${id}`); return true; }, subscribe: () => () => { unsubscribed += 1; }, dispose: () => undefined }, liveStreamControl: { start: async () => ({ ok: false }), stop: async () => ({ ok: false }), get: () => ({ phase: "idle" }), list: () => [], recordDisconnected: () => null, forget: () => false, subscribe: () => () => { unsubscribed += 1; } }, mediaPipeline: { snapshot: () => ({ streams: [{ deviceId: "a", phase: "ready" }] }), evaluate: () => ({ ok: true }), selectPlayer: (id: string) => { calls.push(`video:${id}`); return { ok: true }; }, clearPlayer: () => ({ ok: true }) }, flightControl: { request: () => ({ ok: false }), confirm: async () => ({ ok: false }), cancel: () => ({ ok: false }), get: () => null, subscribe: () => () => { unsubscribed += 1; }, dispose: () => undefined }, deviceSettings: { snapshot: () => ({}), readTransmission: async () => ({}), writeTransmission: async () => ({}), readCamera: async () => ({}), writeCamera: async () => ({}) }, now: () => 1
    });
    await workflow.upload("a"); await workflow.start("a"); await workflow.pause("a"); await workflow.resume("a"); await workflow.stop("a");
    expect(workflow.selectVideo("a")).toMatchObject({ ok: true });
    expect(workflow.forgetCompletedTask("a")).toMatchObject({ ok: true });
    workflow.dispose(); workflow.dispose();
    expect(calls).toEqual(["upload:a", "start:a", "pause:a", "resume:a", "stop:a", "video:a", "forget:a"]);
    expect(unsubscribed).toBe(4);
  });

  it("向订阅者发布冻结快照并在退订和释放后隔离回调", () => {
    let relayEvent!: () => void;
    const workflow = OperationWorkflow.create({
      relayOperations: { devices: () => [], telemetry: () => null, subscribe: (listener: () => void) => { relayEvent = listener; return () => undefined; } }, routeLibrary: { list: () => [], importFile: async () => ({ status: "cancelled" }), getPreview: () => ({ ok: false }), remove: () => ({ ok: false }), select: () => ({ ok: false }), get: () => ({ ok: false }), getMissionPayload: () => ({ ok: false }), getSelected: () => null, clear: () => undefined }, missionControl: { stage: async () => ({ ok: false }), upload: async () => ({ ok: false }), start: async () => ({ ok: false }), pause: async () => ({ ok: false }), resume: async () => ({ ok: false }), stop: async () => ({ ok: false }), get: (id: string) => ({ deviceId: id, phase: "idle" }), list: () => [], forget: () => false, subscribe: () => () => undefined, dispose: () => undefined }, liveStreamControl: { start: async () => ({ ok: false }), stop: async () => ({ ok: false }), get: () => ({ phase: "idle" }), list: () => [], recordDisconnected: () => null, forget: () => false, subscribe: () => () => undefined }, mediaPipeline: { snapshot: () => ({ streams: [] }), evaluate: () => ({ ok: true }), selectPlayer: () => ({ ok: true }), clearPlayer: () => ({ ok: true }) }, flightControl: { request: () => ({ ok: false }), confirm: async () => ({ ok: false }), cancel: () => ({ ok: false }), get: () => null, subscribe: () => () => undefined, dispose: () => undefined }, deviceSettings: { snapshot: () => ({}), readTransmission: async () => ({}), writeTransmission: async () => ({}), readCamera: async () => ({}), writeCamera: async () => ({}) }, now: () => 1
    });
    const received: unknown[] = [];
    const unsubscribe = workflow.subscribe((snapshot: unknown) => received.push(snapshot));
    relayEvent();
    expect(received).toHaveLength(1);
    expect(Object.isFrozen(received[0] as object)).toBe(true);
    unsubscribe(); unsubscribe(); relayEvent();
    expect(received).toHaveLength(1);
    workflow.dispose(); relayEvent();
    expect(received).toHaveLength(1);
  });

  it("将缺失或抛出的航线公开接口收敛为稳定错误码", async () => {
    const missing = workflowWith({ routeLibrary: { list: () => [] } });
    await expect(missing.importRoute({})).resolves.toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    expect(missing.getRoutePreview("route-a")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    expect(missing.selectRoute("route-a")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    expect(missing.removeRoute("route-a")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });

    const throwing = workflowWith({ routeLibrary: { list: () => { throw new Error("list"); }, importFile: async () => { throw new Error("import"); }, getPreview: () => { throw new Error("preview"); }, select: () => { throw new Error("select"); }, remove: () => { throw new Error("remove"); } } });
    await expect(throwing.importRoute({})).resolves.toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    expect(throwing.getRoutePreview("route-a")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    expect(throwing.selectRoute("route-a")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    expect(throwing.removeRoute("route-a")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
  });

  it("拒绝每个航线管理入口的非法输入、未知航线和活动任务", () => {
    const active = workflowWith({ missionControl: { get: (deviceId: string) => ({ deviceId, phase: "running" }) } });
    expect(active.getRoutePreview(" ")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(active.selectRoute(" ")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(active.removeRoute(" ")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(active.assignRoute(" ", "route-a")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(active.assignRoute("relay-a", " ")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(active.assignRoute("relay-a", "route-a")).toMatchObject({ ok: false, code: "TASK_ACTIVE" });
    expect(active.clearAssignment(" ")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(active.clearAssignment("relay-a")).toMatchObject({ ok: false, code: "TASK_ACTIVE" });
    expect(active.forgetCompletedTask(" ")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(active.forgetCompletedTask("relay-a")).toMatchObject({ ok: false, code: "TASK_ACTIVE" });
  });

  it("在媒体、时钟和播放器依赖异常时不泄露异常且可在释放后拒绝", async () => {
    const faulty = workflowWith({ mediaPipeline: { snapshot: () => { throw new Error("media"); }, evaluate: () => { throw new Error("evaluate"); }, selectPlayer: () => { throw new Error("player"); }, clearPlayer: () => { throw new Error("clear"); } }, now: () => { throw new Error("clock"); } });
    expect(faulty.selectVideo("relay-a")).toMatchObject({ ok: false, code: "VIDEO_NOT_READY" });
    expect(faulty.clearVideo()).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    expect(faulty.refreshMedia()).toMatchObject({ ok: false, code: "CLOCK_FAILURE" });
    faulty.dispose();
    await expect(faulty.startStream("relay-a")).resolves.toMatchObject({ ok: false, code: "DISPOSED" });
    await expect(faulty.stopStream("relay-a")).resolves.toMatchObject({ ok: false, code: "DISPOSED" });
    await expect(faulty.readTransmissionSettings("relay-a")).resolves.toMatchObject({ ok: false, code: "DISPOSED" });
    await expect(faulty.writeTransmissionSettings("relay-a", {})).resolves.toMatchObject({ ok: false, code: "DISPOSED" });
    await expect(faulty.readCameraSettings("relay-a")).resolves.toMatchObject({ ok: false, code: "DISPOSED" });
    await expect(faulty.writeCameraSettings("relay-a", {})).resolves.toMatchObject({ ok: false, code: "DISPOSED" });
    expect(faulty.clearVideo()).toMatchObject({ ok: false, code: "DISPOSED" });
    expect(faulty.refreshMedia()).toMatchObject({ ok: false, code: "DISPOSED" });
    expect(faulty.notifyPlaybackReady("relay-a")).toMatchObject({ ok: false, code: "DISPOSED" });
    expect(faulty.requestFlightAction("relay-a", "takeoff")).toMatchObject({ ok: false, code: "DISPOSED" });
    await expect(faulty.confirmFlightAction("relay-a", "confirm-a")).resolves.toMatchObject({ ok: false, code: "DISPOSED" });
    expect(faulty.cancelFlightAction("relay-a", "confirm-a")).toMatchObject({ ok: false, code: "DISPOSED" });
    expect(faulty.forgetCompletedTask("relay-a")).toMatchObject({ ok: false, code: "DISPOSED" });
  });

  it("区分离线设备、不可上传航线、未找到航线和不可清理任务", () => {
    const offline = workflowWith({ relayOperations: { devices: () => [], telemetry: () => null, subscribe: () => () => undefined } });
    expect(offline.assignRoute("relay-a", "route-a")).toMatchObject({ ok: false, code: "DEVICE_OFFLINE" });

    const rejected = workflowWith({
      routeLibrary: { list: () => [{ routeId: "route-a", classification: "preview-only" }], select: () => ({ ok: false }), remove: () => ({ ok: false }), getPreview: () => ({ ok: true }), importFile: async () => ({ status: "cancelled" }) },
      missionControl: { get: (deviceId: string) => ({ deviceId, phase: "completed" }), forget: () => false, subscribe: () => () => undefined },
    });
    expect(rejected.assignRoute("relay-a", "route-a")).toMatchObject({ ok: false, code: "ROUTE_NOT_UPLOADABLE" });
    expect(rejected.selectRoute("route-a")).toMatchObject({ ok: false, code: "ROUTE_NOT_FOUND" });
    expect(rejected.removeRoute("route-a")).toMatchObject({ ok: false, code: "ROUTE_NOT_FOUND" });
    expect(rejected.forgetCompletedTask("relay-a")).toMatchObject({ ok: false, code: "TASK_NOT_FORGETTABLE" });
  });

  it("仅在媒体就绪时选择播放器，并隔离播放器和任务清理异常", () => {
    const calls: string[] = [];
    const usable = workflowWith({ mediaPipeline: { snapshot: () => ({ streams: [{ deviceId: "relay-a", phase: "ready" }] }), selectPlayer: () => { calls.push("select"); return { ok: true }; }, clearPlayer: () => { calls.push("clear"); return { ok: true }; }, evaluate: () => { calls.push("evaluate"); return { ok: true }; } } });
    expect(usable.selectVideo(" ")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(usable.selectVideo("relay-a")).toMatchObject({ ok: true });
    expect(usable.clearVideo()).toMatchObject({ ok: true });
    expect(usable.refreshMedia()).toMatchObject({ ok: true });
    expect(calls).toEqual(["select", "clear", "evaluate"]);

    const missing = workflowWith({ mediaPipeline: { snapshot: () => ({ streams: [{ deviceId: "relay-a", phase: "ready" }] }), evaluate: () => ({ ok: true }) }, missionControl: { get: (deviceId: string) => ({ deviceId, phase: "completed" }), forget: () => { throw new Error("forget"); }, subscribe: () => () => undefined } });
    expect(missing.selectVideo("relay-a")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    expect(missing.clearVideo()).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    expect(missing.forgetCompletedTask("relay-a")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    expect(missing.notifyPlaybackReady("relay-a")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });

    const playlist = workflowWith({ mediaPipeline: { snapshot: () => ({ streams: [] }), evaluate: () => ({ ok: true }), notifyPlaybackReady: (deviceId: string) => { calls.push(`ready:${deviceId}`); return { ok: true }; } } });
    expect(playlist.notifyPlaybackReady("relay-a")).toMatchObject({ ok: true });
    expect(playlist.notifyPlaybackReady(" ")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(calls).toEqual(["select", "clear", "evaluate", "ready:relay-a"]);

    const throwing = workflowWith({ mediaPipeline: { snapshot: () => ({ streams: [] }), notifyPlaybackReady: () => { throw new Error("playlist"); } } });
    expect(throwing.notifyPlaybackReady("relay-a")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
  });

  it("快照隔离每个事实读取的缺失和异常依赖", () => {
    const faulty = OperationWorkflow.create({
      relayOperations: { devices: () => [{ deviceId: "relay-a" }], telemetry: () => { throw new Error("telemetry"); }, subscribe: () => () => undefined },
      routeLibrary: { list: () => { throw new Error("routes"); } },
      missionControl: { get: () => { throw new Error("mission"); }, subscribe: () => () => undefined },
      liveStreamControl: { get: () => { throw new Error("stream"); }, recordDisconnected: () => { throw new Error("disconnect"); }, subscribe: () => () => undefined },
      mediaPipeline: { snapshot: () => { throw new Error("media"); } },
      flightControl: { get: () => { throw new Error("flight"); }, cancel: () => { throw new Error("cancel"); }, subscribe: () => () => undefined },
      deviceSettings: { snapshot: () => { throw new Error("settings"); } },
      now: () => 1,
    } as never);
    expect(faulty.snapshot()).toMatchObject({ devices: [{ deviceId: "relay-a", connection: { sdk: "unknown" } }], routes: [] });
  });

  it("在缺失事实、断线和未就绪视频时保持可恢复的工作流快照", () => {
    let online = true;
    let relayEvent!: () => void;
    const workflow = OperationWorkflow.create({
      relayOperations: { devices: () => online ? [{ deviceId: "relay-a" }] : [], subscribe: (listener: () => void) => { relayEvent = listener; return () => undefined; } },
      routeLibrary: {},
      missionControl: { subscribe: () => () => undefined },
      liveStreamControl: { subscribe: () => () => undefined },
      mediaPipeline: {},
      flightControl: { subscribe: () => () => undefined },
      deviceSettings: {},
      now: () => 1,
    } as never);
    expect(workflow.snapshot()).toMatchObject({ routes: [], devices: [{ deviceId: "relay-a", connection: { sdk: "unknown" }, video: { phase: "unavailable" } }] });
    expect(workflow.selectVideo("relay-a")).toMatchObject({ ok: false, code: "VIDEO_NOT_READY" });
    online = false;
    relayEvent();
    expect(workflow.snapshot().devices).toEqual([]);
  });

  it("拒绝离线视频，并隔离播放器、媒体刷新和任务清理的缺失依赖", () => {
    const offline = workflowWith({ relayOperations: { devices: () => [], telemetry: () => null, subscribe: () => () => undefined } });
    expect(offline.selectVideo("relay-a")).toMatchObject({ ok: false, code: "DEVICE_OFFLINE" });

    const missing = workflowWith({ mediaPipeline: { snapshot: () => ({ streams: [{ deviceId: "other", phase: "ready" }] }) }, missionControl: { get: (deviceId: string) => ({ deviceId, phase: "completed" }), subscribe: () => () => undefined } });
    expect(missing.selectVideo("relay-a")).toMatchObject({ ok: false, code: "VIDEO_NOT_READY" });
    expect(missing.refreshMedia()).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    expect(missing.forgetCompletedTask("relay-a")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });

    const throwing = workflowWith({ mediaPipeline: { snapshot: () => ({ streams: [] }), evaluate: () => { throw new Error("evaluate"); } } });
    expect(throwing.refreshMedia()).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
  });

  it("隔离畸形设备与航线列表、订阅者异常以及释放后的订阅", async () => {
    const throwingDevices = Object.defineProperty({}, "devices", { get: () => { throw new Error("devices getter"); } });
    const malformed = OperationWorkflow.create({
      relayOperations: throwingDevices,
      routeLibrary: { list: () => null },
      missionControl: {}, liveStreamControl: {}, mediaPipeline: {}, flightControl: {}, deviceSettings: {}, now: () => 1,
    } as never);
    expect(malformed.snapshot()).toMatchObject({ devices: [], routes: [] });
    const nonArray = workflowWith({ relayOperations: { devices: () => null, subscribe: () => () => undefined }, routeLibrary: { list: () => null } });
    expect(nonArray.snapshot()).toMatchObject({ devices: [], routes: [] });

    const listenerFault = workflowWith();
    listenerFault.subscribe(() => { throw new Error("listener"); });
    expect(listenerFault.assignRoute("relay-a", "route-a")).toMatchObject({ ok: true });
    listenerFault.dispose();
    const unsubscribe = listenerFault.subscribe(() => { throw new Error("late"); });
    unsubscribe();
    await expect(listenerFault.stage("relay-a")).resolves.toMatchObject({ ok: false, code: "DISPOSED" });
  });

  it("在断线时隔离缺失清理回调并清空已选择视频", () => {
    let online = true;
    let signal!: () => void;
    const workflow = OperationWorkflow.create({
      relayOperations: { devices: () => online ? [{ deviceId: "relay-a" }] : [], telemetry: () => ({ payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true }, capabilities: {} }), subscribe: (listener: () => void) => { signal = listener; return () => undefined; } },
      routeLibrary: { list: () => [{ routeId: "route-a", classification: "upload-candidate" }] },
      missionControl: { get: (deviceId: string) => ({ deviceId, phase: "idle" }), subscribe: () => () => undefined },
      liveStreamControl: { get: () => ({ phase: "idle" }), subscribe: () => () => undefined },
      mediaPipeline: { snapshot: () => ({ streams: [{ deviceId: "relay-a", phase: "ready" }] }), selectPlayer: () => ({ ok: true }) },
      flightControl: { request: () => ({ ok: true, confirmation: { confirmationId: "confirm-a" } }), get: () => null, subscribe: () => () => undefined },
      deviceSettings: { snapshot: () => ({}) }, hardwareReadiness: readyHardware, now: () => 1,
    } as never);
    expect(workflow.assignRoute("relay-a", "route-a")).toMatchObject({ ok: true });
    expect(workflow.requestFlightAction("relay-a", "takeoff")).toMatchObject({ ok: true });
    expect(workflow.selectVideo("relay-a")).toMatchObject({ ok: true });
    online = false;
    signal();
    expect(workflow.snapshot()).toMatchObject({ selectedVideoDeviceId: null, devices: [] });
  });

  it("删除当前选择、不可分配航线和播放器异常都有稳定结果", () => {
    const calls: string[] = [];
    const workflow = workflowWith({
      routeLibrary: { list: () => [{ routeId: "route-a", classification: "upload-candidate" }], select: () => ({ ok: true }), remove: () => ({ ok: true }), getPreview: () => ({ ok: true }), importFile: async () => ({ status: "cancelled" }) },
      mediaPipeline: { snapshot: () => ({ streams: [{ deviceId: "relay-a", phase: "ready" }] }), selectPlayer: () => { calls.push("player"); throw new Error("player"); }, clearPlayer: () => ({ ok: true }), evaluate: () => ({ ok: true }) },
    });
    expect(workflow.selectRoute("route-a")).toMatchObject({ ok: true });
    expect(workflow.removeRoute("route-a")).toMatchObject({ ok: true });
    expect(workflow.snapshot().selectedRouteId).toBeNull();
    expect(workflow.assignRoute("relay-a", "route-missing")).toMatchObject({ ok: false, code: "ROUTE_NOT_UPLOADABLE" });
    expect(workflow.selectVideo("relay-a")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });
    expect(calls).toEqual(["player"]);
  });

  it("删除当前选中航线后只删除这一条，并采用航线库返回的剩余选择", () => {
    const removed: string[] = [];
    const workflow = workflowWith({
      routeLibrary: {
        list: () => [{ routeId: "route-a", classification: "upload-candidate" }, { routeId: "route-b", classification: "upload-candidate" }],
        select: () => ({ ok: true }),
        remove: (routeId: string) => {
          removed.push(routeId);
          return { ok: true, value: routeId === "route-a" ? { routeId: "route-b" } : null };
        },
      },
    });
    expect(workflow.selectRoute("route-a")).toMatchObject({ ok: true });
    expect(workflow.removeRoute("route-a")).toMatchObject({ ok: true });
    expect(removed).toEqual(["route-a"]);
    expect(workflow.snapshot().selectedRouteId).toBe("route-b");
    expect(workflow.removeRoute("route-b")).toMatchObject({ ok: true });
    expect(removed).toEqual(["route-a", "route-b"]);
    expect(workflow.snapshot().selectedRouteId).toBeNull();
  });

  it("真实航线库删除当前航线后只保留其余航线并选中剩余项", async () => {
    const created = RouteLibrary.create({
      idProvider: (() => { let n = 0; return () => `route-${++n}`; })(),
      clock: () => "2026-08-10T00:00:00.000Z",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw created.error;
    const kml = (coords: string) => new TextEncoder().encode(`<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><LineString><coordinates>${coords}</coordinates></LineString></Placemark></Document></kml>`);
    expect(await created.value.importFile({ fileName: "west-lake.kml", bytes: kml("120.16450,30.32350,80 120.16880,30.32350,80") })).toMatchObject({ status: "imported" });
    expect(await created.value.importFile({ fileName: "canal.kml", bytes: kml("120.16500,30.31850,120 120.16850,30.32300,110") })).toMatchObject({ status: "imported" });
    const workflow = workflowWith({ routeLibrary: created.value });
    expect(workflow.selectRoute("route-1")).toMatchObject({ ok: true });
    expect(workflow.removeRoute("route-1")).toMatchObject({ ok: true });
    expect(workflow.snapshot().selectedRouteId).toBe("route-2");
    expect(workflow.snapshot().routes.map((route: { routeId: string }) => route.routeId)).toEqual(["route-2"]);
    const view = OperatorConsole.project({
      snapshot: { workflow: workflow.snapshot() },
      selection: { missionDeviceId: null, streamDeviceId: null },
      workspace: "routes",
    });
    expect(view.routes).toHaveLength(1);
    expect(view.selectedRoute).toMatchObject({ routeId: "route-2", displayName: "canal.kml" });
  });

  it("处理坏设备条目、航线读取异常和释放后的迟到断连", () => {
    let signal!: () => void;
    let online = true;
    const workflow = OperationWorkflow.create({
      relayOperations: { devices: () => online ? [{ deviceId: "relay-a" }, {}, { deviceId: " " }] : [], telemetry: () => null, subscribe: (listener: () => void) => { signal = listener; return () => undefined; } },
      routeLibrary: { list: () => { throw new Error("routes"); }, getPreview: () => ({ ok: true }) },
      missionControl: { get: (deviceId: string) => ({ deviceId, phase: "idle" }), subscribe: () => () => undefined },
      liveStreamControl: { get: () => ({ phase: "idle" }), recordDisconnected: () => { throw new Error("disconnected"); }, subscribe: () => () => undefined },
      mediaPipeline: { snapshot: () => ({ streams: [] }) },
      flightControl: { get: () => null, subscribe: () => () => undefined },
      deviceSettings: { snapshot: () => ({}) }, now: () => 1,
    } as never);
    expect(workflow.snapshot().devices).toHaveLength(1);
    expect(workflow.assignRoute("relay-a", "route-a")).toMatchObject({ ok: false, code: "ROUTE_NOT_UPLOADABLE" });
    online = false;
    signal();
    workflow.dispose();
    signal();
    expect(workflow.getRoutePreview("route-a")).toMatchObject({ ok: false, code: "DISPOSED" });
  });

  it("覆盖剩余的真实防御分支而不把错误依赖误报为成功", () => {
    const throwingDevices = workflowWith({ relayOperations: { devices: () => { throw new Error("devices"); }, subscribe: () => () => undefined } });
    expect(throwingDevices.snapshot().devices).toEqual([]);

    const malformedRoute = workflowWith({ routeLibrary: { list: () => [null], select: () => ({ ok: true }), remove: () => ({ ok: true }) } });
    expect(malformedRoute.assignRoute("relay-a", "route-a")).toMatchObject({ ok: false, code: "ROUTE_NOT_UPLOADABLE" });

    let online = true;
    let signal!: () => void;
    const cancellationFault = OperationWorkflow.create({
      relayOperations: { devices: () => online ? [{ deviceId: "relay-a" }] : [], telemetry: () => ({ payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true } }), subscribe: (listener: () => void) => { signal = listener; return () => undefined; } },
      routeLibrary: { list: () => [{ routeId: "route-a", classification: "upload-candidate" }] }, missionControl: { get: (deviceId: string) => ({ deviceId, phase: "idle" }), subscribe: () => () => undefined },
      liveStreamControl: { get: () => ({ phase: "idle" }), subscribe: () => () => undefined }, mediaPipeline: { snapshot: () => ({ streams: null }) },
      flightControl: { request: () => ({ ok: true, confirmation: { confirmationId: "confirm-a" } }), cancel: () => { throw new Error("cancel"); }, get: () => null, subscribe: () => () => undefined }, deviceSettings: { snapshot: () => ({}) }, hardwareReadiness: readyHardware, now: () => 1,
    } as never);
    expect(cancellationFault.assignRoute("relay-a", "route-a")).toMatchObject({ ok: true });
    expect(cancellationFault.requestFlightAction("relay-a", "takeoff")).toMatchObject({ ok: true });
    expect(cancellationFault.selectVideo("relay-a")).toMatchObject({ ok: false, code: "VIDEO_NOT_READY" });
    online = false;
    signal();
  });

  it("处理分配时航线库抛出、非当前删除和非字符串输入", () => {
    const throwingRoute = workflowWith({ routeLibrary: { list: () => { throw new Error("route"); } } });
    expect(throwingRoute.assignRoute("relay-a", "route-a")).toMatchObject({ ok: false, code: "ROUTE_NOT_UPLOADABLE" });
    expect(throwingRoute.assignRoute(null as never, "route-a")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(throwingRoute.clearAssignment(null as never)).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    const routes = workflowWith({ routeLibrary: { list: () => [], select: () => ({ ok: true }), remove: () => ({ ok: true }) } });
    expect(routes.selectRoute("route-b")).toMatchObject({ ok: true });
    expect(routes.removeRoute("route-a")).toMatchObject({ ok: true });
    expect(routes.snapshot().selectedRouteId).toBe("route-b");
  });

  it("将同设备的未就绪媒体严格拒绝为不可播放", () => {
    const workflow = workflowWith({ mediaPipeline: { snapshot: () => ({ streams: [{ deviceId: "relay-a", phase: "awaiting-playback" }] }), evaluate: () => ({ ok: true }) } });
    expect(workflow.selectVideo("relay-a")).toMatchObject({ ok: false, code: "VIDEO_NOT_READY" });
  });

  it("穷尽同一入口的短路前置条件", () => {
    const nullList = workflowWith({ routeLibrary: { list: () => null } });
    expect(nullList.assignRoute("relay-a", "route-a")).toMatchObject({ ok: false, code: "ROUTE_NOT_UPLOADABLE" });
    expect(nullList.assignRoute("relay-a", null as never)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(nullList.clearAssignment({} as never)).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    const assigned = workflowWith();
    expect(assigned.assignRoute("relay-a", "route-a")).toMatchObject({ ok: true });
    expect(assigned.removeRoute("route-a")).toMatchObject({ ok: false, code: "ROUTE_ASSIGNED" });
    assigned.dispose();
    expect(assigned.removeRoute("route-a")).toMatchObject({ ok: false, code: "DISPOSED" });
    expect(assigned.assignRoute("relay-a", "route-a")).toMatchObject({ ok: false, code: "DISPOSED" });
    expect(assigned.clearAssignment("relay-a")).toMatchObject({ ok: false, code: "DISPOSED" });
    expect(assigned.selectVideo("relay-a")).toMatchObject({ ok: false, code: "DISPOSED" });
  });

  it("同一手机换了会话时必须复位图传车道并作废危险确认，不得继续显示已启动", () => {
    let sessionId = "session-1";
    let signal!: () => void;
    const disconnected: string[] = [];
    const cancelled: Array<{ deviceId: string; confirmationId: string }> = [];
    let pending: { deviceId: string; action: string; confirmationId: string } | null = null;
    const workflow = workflowWith({
      relayOperations: {
        devices: () => [{ deviceId: "relay-a", sessionId }],
        telemetry: () => ({
          payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true, batteryPercent: 80, isFlying: false },
          capabilities: {},
        }),
        subscribe: (listener: () => void) => { signal = listener; return () => undefined; },
      },
      liveStreamControl: {
        start: async () => ({ ok: true }),
        stop: async () => ({ ok: true }),
        get: () => ({ phase: "streaming" }),
        list: () => [],
        recordDisconnected: (id: string) => { disconnected.push(id); return { phase: "disconnected" }; },
        forget: () => false,
        subscribe: () => () => undefined,
      },
      flightControl: {
        request: () => {
          pending = { deviceId: "relay-a", action: "takeoff", confirmationId: "confirm-old" };
          return { ok: true, code: "CONFIRMATION_REQUIRED", confirmation: pending };
        },
        confirm: async () => ({ ok: true }),
        cancel: (deviceId: string, confirmationId: string) => {
          cancelled.push({ deviceId, confirmationId });
          pending = null;
          return { ok: true, code: "CANCELLED" };
        },
        clear: () => { pending = null; },
        get: () => pending,
        subscribe: () => () => undefined,
        dispose: () => undefined,
      },
    });
    expect(workflow.requestFlightAction("relay-a", "takeoff")).toMatchObject({ ok: true });
    expect(workflow.snapshot().devices[0]?.pendingFlightAction).toEqual({
      deviceId: "relay-a",
      action: "takeoff",
      confirmationId: "confirm-old",
    });
    sessionId = "session-2";
    signal();
    expect(disconnected).toEqual(["relay-a"]);
    expect(cancelled).toEqual([{ deviceId: "relay-a", confirmationId: "confirm-old" }]);
    expect(workflow.snapshot().devices[0]?.pendingFlightAction).toBeNull();
  });

  it("转码失败且手机仍在线时必须停止这一路图传，手机已离线则不得补发停止", async () => {
    const stops: string[] = [];
    const online = workflowWith({
      liveStreamControl: {
        start: async () => ({ ok: true }),
        stop: async (id: string) => { stops.push(id); return { ok: true }; },
        get: () => ({ phase: "streaming" }),
        list: () => [],
        recordDisconnected: () => null,
        forget: () => false,
        subscribe: () => () => undefined,
      },
      mediaPipeline: { snapshot: () => ({ streams: [{ deviceId: "relay-a", phase: "failed" }] }), evaluate: () => ({ ok: true }) },
    });
    expect(online.refreshMedia()).toMatchObject({ ok: true });
    await Promise.resolve();
    expect(stops).toEqual(["relay-a"]);

    const offlineStops: string[] = [];
    const offline = workflowWith({
      relayOperations: { devices: () => [], telemetry: () => null, subscribe: () => () => undefined },
      liveStreamControl: {
        start: async () => ({ ok: true }),
        stop: async (id: string) => { offlineStops.push(id); return { ok: true }; },
        get: () => ({ phase: "streaming" }),
        list: () => [],
        recordDisconnected: () => null,
        forget: () => false,
        subscribe: () => () => undefined,
      },
      mediaPipeline: { snapshot: () => ({ streams: [{ deviceId: "relay-a", phase: "failed" }] }), evaluate: () => ({ ok: true }) },
    });
    expect(offline.refreshMedia()).toMatchObject({ ok: true });
    await Promise.resolve();
    expect(offlineStops).toEqual([]);
  });

  it("设备离线时标记生产 RTMP 图传为断连", () => {
    let online = true;
    let signal!: () => void;
    const disconnected: string[] = [];
    const workflow = workflowWith({
      relayOperations: { devices: () => online ? [{ deviceId: "relay-a" }] : [], telemetry: () => null, subscribe: (listener: () => void) => { signal = listener; return () => undefined; } },
      liveStreamControl: {
        start: async () => ({ ok: true }),
        stop: async () => ({ ok: true }),
        get: () => ({ deviceId: "relay-a", phase: "streaming" }),
        list: () => [],
        recordDisconnected: (id: string) => { disconnected.push(id); return { phase: "disconnected" }; },
        forget: () => false,
        subscribe: () => () => undefined,
      },
    });
    expect(workflow.snapshot().devices[0]).toMatchObject({ stream: { phase: "streaming" } });
    online = false;
    signal();
    expect(disconnected).toEqual(["relay-a"]);
  });
});
