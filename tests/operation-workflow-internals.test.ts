import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AssignmentRegistry } from "../src/production/operation-workflow/assignment-registry/index.js";
import { WorkflowSnapshot } from "../src/production/operation-workflow/workflow-snapshot/index.js";
import { WorkflowSubscriptions } from "../src/production/operation-workflow/workflow-subscriptions/index.js";

const source = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

describe("飞行作业工作流内部模块", () => {
  it("为已知生产依赖声明最小 Port 契约", () => {
    const ports = resolve(process.cwd(), "src/production/operation-workflow/ports.ts");

    expect(existsSync(ports)).toBe(true);
    expect(source("src/production/operation-workflow/ports.ts")).toContain("OperationWorkflowDependencies");
  });

  it("仅通过 Port 的明确方法调用内部依赖", () => {
    const workflow = source("src/production/operation-workflow/index.ts");
    const actions = source("src/production/operation-workflow/workflow-actions/index.ts");
    const subscriptions = source("src/production/operation-workflow/workflow-subscriptions/index.ts");
    const desktopApplication = source("src/production/desktop-application/index.ts");

    expect(workflow).not.toMatch(/readonly (?:relayOperations|routeLibrary|missionControl|liveStreamControl|mediaPipeline|flightControl|deviceSettings): RecordValue/);
    expect(workflow).not.toContain("const invoke =");
    expect(workflow).not.toMatch(/read\(dependencies\.[a-zA-Z]+, "/);
    expect(actions).not.toContain("type RecordValue");
    expect(actions).not.toContain("const invoke =");
    expect(actions).not.toContain("const invokeSync =");
    expect(actions).not.toContain("method: string");
    expect(subscriptions).toContain("WorkflowSubscriptionPort");
    expect(desktopApplication).not.toMatch(/OperationWorkflow\.create\(\{[\s\S]*?\}\s+as never\)/);
  });

  it("隔离、排序并清理设备航线分配", () => {
    const registry = AssignmentRegistry.create();
    expect(registry.assign("device-b", "route-2")).toBe(true);
    expect(registry.assign("device-a", "route-1")).toBe(true);
    expect(registry.snapshot()).toEqual([{ deviceId: "device-a", routeId: "route-1" }, { deviceId: "device-b", routeId: "route-2" }]);
    expect(registry.routesInUse("route-1")).toEqual(["device-a"]);
    expect(registry.clear("device-a")).toBe(true);
    expect(registry.get("device-a")).toBeNull();
    expect(registry.removeDevice("device-b")).toBe(true);
    expect(registry.snapshot()).toEqual([]);
    expect(registry.assign(" ", "route")).toBe(false);
    expect(registry.assign("device", " ")).toBe(false);
    expect(registry.get("missing")).toBeNull();
    expect(registry.get(null as never)).toBeNull();
    expect(registry.clear("missing")).toBe(false);
    expect(registry.clear(" ")).toBe(false);
    expect(registry.routesInUse(" ")).toEqual([]);
  });

  it("将未知设备事实投影为安全快照，并只保留本机播放地址", () => {
    const snapshot = WorkflowSnapshot.create({ devices: [{ deviceId: "b", telemetry: { payload: {}, capabilities: {} }, assignment: { routeId: null, routeName: null }, mission: { phase: "idle" }, stream: { phase: "idle" }, settings: {}, pendingFlightAction: null }, { deviceId: "a", telemetry: { payload: { sdkRegistered: true, remoteControllerConnected: false, flightControllerConnected: true, connected: true, batteryPercent: 12, isFlying: false }, capabilities: { waypointMission: true, waypointMissionSupport: "supported", liveVideo: true } }, assignment: { routeId: "r", routeName: "r.kmz" }, mission: { phase: "uploaded" }, stream: { phase: "streaming" }, settings: {}, pendingFlightAction: null }], routes: [], selectedRouteId: "r", selectedVideoDeviceId: "a", revision: 2, media: { streams: [{ deviceId: "a", phase: "ready", playbackUrl: "http://127.0.0.1:18080/live/stream-1.flv", diagnostic: "secret" }] }, disposed: false });
    expect(snapshot).toMatchObject({ phase: "ready", devices: [{ deviceId: "a", connection: { sdk: "ready", remoteController: "disconnected", flightState: "grounded", pairingState: "unknown", pose: null } }, { deviceId: "b", connection: { sdk: "unknown", aircraft: "unknown", pairingState: "unknown", pose: null } }] });
    expect(snapshot.media).toEqual({ streams: [{ deviceId: "a", phase: "ready", playbackUrl: "http://127.0.0.1:18080/live/stream-1.flv" }] });
    expect(JSON.stringify(snapshot)).not.toContain("secret");
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("投影 MSDK 的已停止与注册失败状态，而不把它们归并为未知", () => {
    const device = (sdkAvailability: string) => ({
      deviceId: `relay-${sdkAvailability.toLowerCase()}`,
      telemetry: { payload: { sdkAvailability }, capabilities: {} },
      assignment: null, mission: null, stream: null, settings: null, pendingFlightAction: null,
    });
    const snapshot = WorkflowSnapshot.create({
      devices: [device("STOPPED"), device("FAILED")],
      routes: [], selectedRouteId: null, selectedVideoDeviceId: null, revision: 0, media: { streams: [] }, disposed: false,
    });
    expect(snapshot.devices).toMatchObject([
      { connection: { msdk: "failed", sdk: "unknown" } },
      { connection: { msdk: "stopped", sdk: "unknown" } },
    ]);
  });

  it("在没有媒体流、读取异常和已释放时仍投影安全快照", () => {
    const unreadable = Object.defineProperty({}, "streams", { get: () => { throw new Error("unreadable"); } });
    const snapshot = WorkflowSnapshot.create({
      devices: [{ deviceId: "relay-a", telemetry: null, assignment: null, mission: null, stream: null, settings: null, pendingFlightAction: null }],
      routes: [], selectedRouteId: null, selectedVideoDeviceId: null, revision: 0, media: unreadable, disposed: true,
    });
    expect(snapshot).toMatchObject({ phase: "disposed", devices: [{ deviceId: "relay-a", video: { phase: "unavailable", selected: false } }] });
  });

  it("区分显式不支持与未知能力", () => {
    const snapshot = WorkflowSnapshot.create({
      devices: [
        { deviceId: "one", telemetry: { payload: {}, capabilities: { waypointMission: true, waypointMissionSupport: "unsupported", liveVideo: false } }, assignment: null, mission: null, stream: null, settings: null, pendingFlightAction: null },
        { deviceId: "two", telemetry: { payload: {}, capabilities: { waypointMission: false } }, assignment: null, mission: null, stream: null, settings: null, pendingFlightAction: null },
      ],
      routes: [], selectedRouteId: null, selectedVideoDeviceId: null, revision: 0, media: { streams: [] }, disposed: false,
    });
    expect(snapshot.devices).toMatchObject([
      { deviceId: "one", capabilities: { waypointMission: "unsupported", liveVideo: "unsupported" } },
      { deviceId: "two", capabilities: { waypointMission: "unsupported", liveVideo: "unknown" } },
    ]);
  });

  it("把经校验的飞机位姿和配对状态放进设备连接快照", () => {
    const snapshot = WorkflowSnapshot.create({
      devices: [{
        deviceId: "relay-a",
        telemetry: {
          payload: {
            pairingState: "PAIRED",
            latitude: 31.2,
            longitude: -122.4,
            altitudeMeters: 250.5,
          },
          capabilities: {},
        },
        assignment: null, mission: null, stream: null, settings: null, pendingFlightAction: null,
      }],
      routes: [], selectedRouteId: null, selectedVideoDeviceId: null, revision: 0, media: { streams: [] }, disposed: false,
    });
    expect(snapshot.devices[0]).toMatchObject({
      connection: {
        pairingState: "PAIRED",
        pose: { latitude: 31.2, longitude: -122.4, altitudeMeters: 250.5 },
      },
    });
  });

  it("在坐标残缺或配对枚举未知时不把残缺坐标写成 0，pairingState 为 unknown", () => {
    const snapshot = WorkflowSnapshot.create({
      devices: [{
        deviceId: "relay-a",
        telemetry: { payload: { pairingState: "maybe", latitude: 31.2, altitudeMeters: 12 }, capabilities: {} },
        assignment: null, mission: null, stream: null, settings: null, pendingFlightAction: null,
      }],
      routes: [], selectedRouteId: null, selectedVideoDeviceId: null, revision: 0, media: { streams: [] }, disposed: false,
    });
    expect(snapshot.devices[0]).toMatchObject({
      connection: { pairingState: "unknown", pose: { latitude: null, longitude: null, altitudeMeters: 12 } },
    });
  });

  it("丢弃越界或非有限坐标，允许无高度的合法坐标，并保留全部已知配对枚举", () => {
    const device = (payload: Record<string, unknown>) => ({
      deviceId: "relay-a",
      telemetry: { payload, capabilities: {} },
      assignment: null, mission: null, stream: null, settings: null, pendingFlightAction: null,
    });
    const create = (payload: Record<string, unknown>) => WorkflowSnapshot.create({
      devices: [device(payload)],
      routes: [], selectedRouteId: null, selectedVideoDeviceId: null, revision: 0, media: { streams: [] }, disposed: false,
    }).devices[0]?.connection;

    expect(create({ latitude: 91, longitude: 0, altitudeMeters: 10 })).toMatchObject({
      pose: { latitude: null, longitude: null, altitudeMeters: 10 },
    });
    expect(create({ latitude: -91, longitude: 0, altitudeMeters: 10 })).toMatchObject({
      pose: { latitude: null, longitude: null, altitudeMeters: 10 },
    });
    expect(create({ latitude: 0, longitude: 181, altitudeMeters: Number.NaN })).toMatchObject({ pose: null });
    expect(create({ latitude: 0, longitude: -181 })).toMatchObject({ pose: null });
    expect(create({ longitude: 121.5, altitudeMeters: 12 })).toMatchObject({
      pose: { latitude: null, longitude: null, altitudeMeters: 12 },
    });
    expect(create({ altitudeMeters: Number.POSITIVE_INFINITY })).toMatchObject({ pose: null });
    expect(create({ latitude: -90, longitude: -180 })).toMatchObject({
      pose: { latitude: -90, longitude: -180, altitudeMeters: null },
    });
    expect(create({ latitude: 90, longitude: 180 })).toMatchObject({
      pose: { latitude: 90, longitude: 180, altitudeMeters: null },
    });
    expect(create({ latitude: 31.2, longitude: 121.5 })).toMatchObject({
      pose: { latitude: 31.2, longitude: 121.5, altitudeMeters: null },
    });
    expect(create({ pairingState: "FAILED" })?.pairingState).toBe("FAILED");
    expect(create({ pairingState: "STOPPING" })?.pairingState).toBe("STOPPING");
    expect(create({ pairingState: "IDLE" })?.pairingState).toBe("IDLE");
    expect(create({ pairingState: "PAIRING" })?.pairingState).toBe("PAIRING");
    expect(create({ pairingState: "UNKNOWN" })?.pairingState).toBe("UNKNOWN");
  });

  it("投影已确认的设备、飞行和当前图传事实", () => {
    const snapshot = WorkflowSnapshot.create({
      devices: [{
        deviceId: "relay-a",
        telemetry: {
          payload: {
            flightControllerConnected: true,
            aircraftModel: "Matrice 4T",
            remoteControllerModel: "DJI RC Plus",
            batteryPercent: 87,
            isFlying: false,
            motorsOn: false,
            flightMode: "N",
            remainingFlightTimeSeconds: 1085,
            altitudeMeters: 12.3,
            latitude: 30.27415,
            longitude: 120.15515,
            liveStreaming: true,
            liveResolution: "1920x1080",
            liveFps: 29.97,
            liveVideoBitrateKbps: 1802,
            liveRttMillis: 42,
          },
          capabilities: {},
        },
        assignment: null, mission: null, stream: null, settings: null, pendingFlightAction: null,
      }],
      routes: [], selectedRouteId: null, selectedVideoDeviceId: null, revision: 0, media: { streams: [] }, disposed: false,
    });

    expect(snapshot.devices[0]?.connection).toMatchObject({
      aircraftModel: "Matrice 4T",
      remoteControllerModel: "DJI RC Plus",
      batteryPercent: 87,
      flightState: "grounded",
      motorsOn: false,
      flightMode: "N",
      remainingFlightTimeSeconds: 1085,
      pose: { latitude: 30.27415, longitude: 120.15515, altitudeMeters: 12.3 },
      live: { streaming: true, resolution: "1920x1080", fps: 29.97, videoBitrateKbps: 1802, rttMillis: 42 },
    });
  });

  it("在飞控断开时清空动态飞行事实，但保留当前图传观测", () => {
    const snapshot = WorkflowSnapshot.create({
      devices: [{
        deviceId: "relay-a",
        telemetry: {
          payload: {
            flightControllerConnected: false,
            batteryPercent: 87,
            isFlying: true,
            motorsOn: true,
            flightMode: "N",
            remainingFlightTimeSeconds: 1085,
            altitudeMeters: 12.3,
            latitude: 30.27415,
            longitude: 120.15515,
            liveStreaming: true,
            liveResolution: "1920x1080",
            liveFps: 30,
            liveVideoBitrateKbps: 1802,
            liveRttMillis: 42,
          },
          capabilities: {},
        },
        assignment: null, mission: null, stream: null, settings: null, pendingFlightAction: null,
      }],
      routes: [], selectedRouteId: null, selectedVideoDeviceId: null, revision: 0, media: { streams: [] }, disposed: false,
    });

    expect(snapshot.devices[0]?.connection).toMatchObject({
      flightController: "disconnected",
      batteryPercent: null,
      flightState: "unknown",
      motorsOn: null,
      flightMode: null,
      remainingFlightTimeSeconds: null,
      pose: null,
      live: { streaming: true, resolution: "1920x1080", fps: 30, videoBitrateKbps: 1802, rttMillis: 42 },
    });
  });

  it("丢弃畸形动态事实，并区分未运行与未知的图传观测", () => {
    const device = (payload: Record<string, unknown>) => ({
      deviceId: "relay-a",
      telemetry: { payload, capabilities: {} },
      assignment: null, mission: null, stream: null, settings: null, pendingFlightAction: null,
    });
    const create = (payload: Record<string, unknown>) => WorkflowSnapshot.create({
      devices: [device(payload)],
      routes: [], selectedRouteId: null, selectedVideoDeviceId: null, revision: 0,
      media: { streams: [{ deviceId: 1, phase: "ready" }] }, disposed: false,
    }).devices[0]?.connection;

    expect(create({
      flightControllerConnected: true,
      aircraftModel: "M".repeat(129),
      remoteControllerModel: "RC\u0000 Plus",
      batteryPercent: 87.5,
      motorsOn: "true",
      flightMode: " ",
      remainingFlightTimeSeconds: 86_401,
      liveStreaming: false,
    })).toMatchObject({
      aircraftModel: null,
      remoteControllerModel: null,
      batteryPercent: null,
      motorsOn: null,
      flightMode: null,
      remainingFlightTimeSeconds: null,
      live: { streaming: false, resolution: null, fps: null, videoBitrateKbps: null, rttMillis: null },
    });

    expect(create({
      liveStreaming: true,
      liveResolution: "\u0000",
      liveFps: 241,
      liveVideoBitrateKbps: -1,
      liveRttMillis: 1.5,
    })?.live).toEqual({ streaming: true, resolution: null, fps: null, videoBitrateKbps: null, rttMillis: null });
    expect(create({})?.live).toEqual({ streaming: null, resolution: null, fps: null, videoBitrateKbps: null, rttMillis: null });

    const snapshot = WorkflowSnapshot.create({
      devices: [device({})], routes: [], selectedRouteId: null, selectedVideoDeviceId: null, revision: 0,
      media: { streams: [{ deviceId: 1, phase: "ready" }, { deviceId: "relay-a", phase: "ready", playbackUrl: null }] }, disposed: false,
    });
    expect(snapshot.media.streams).toEqual([{ deviceId: "relay-a", phase: "ready", playbackUrl: null }]);
  });

  it("隔离订阅异常并在释放后忽略迟到事件", () => {
    let fire!: () => void;
    let stopped = 0;
    let calls = 0;
    const subscriptions = WorkflowSubscriptions.create([{ subscribe: (listener) => { fire = listener; return () => { stopped += 1; }; } }, { subscribe: () => { throw new Error("unavailable"); } }], () => { calls += 1; });
    fire();
    expect(calls).toBe(1);
    subscriptions.dispose();
    subscriptions.dispose();
    fire();
    expect(calls).toBe(1);
    expect(stopped).toBe(1);
  });

  it("缺失订阅和退订异常不会阻碍其他资源释放", () => {
    let activeListener!: () => void;
    let released = 0;
    const subscriptions = WorkflowSubscriptions.create([
      {},
      { subscribe: () => () => { throw new Error("unsubscribe"); } },
      { subscribe: (listener) => { activeListener = listener; return () => { released += 1; }; } },
    ], () => { released += 10; });
    activeListener();
    subscriptions.dispose();
    activeListener();
    expect(released).toBe(11);
  });
});
