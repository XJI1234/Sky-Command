import { describe, expect, it } from "vitest";
import { AssignmentRegistry } from "../src/production/operation-workflow/assignment-registry/index.js";
import { WorkflowSnapshot } from "../src/production/operation-workflow/workflow-snapshot/index.js";
import { WorkflowSubscriptions } from "../src/production/operation-workflow/workflow-subscriptions/index.js";

describe("飞行作业工作流内部模块", () => {
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
    const snapshot = WorkflowSnapshot.create({ devices: [{ deviceId: "b", telemetry: { payload: {}, capabilities: {} }, assignment: { routeId: null, routeName: null }, mission: { phase: "idle" }, stream: { phase: "idle" }, settings: {}, pendingFlightAction: null }, { deviceId: "a", telemetry: { payload: { sdkRegistered: true, remoteControllerConnected: false, flightControllerConnected: true, connected: true, batteryPercent: 12, isFlying: false }, capabilities: { waypointMission: true, waypointMissionSupport: "supported", liveVideo: true } }, assignment: { routeId: "r", routeName: "r.kmz" }, mission: { phase: "uploaded" }, stream: { phase: "streaming" }, settings: {}, pendingFlightAction: null }], routes: [], selectedRouteId: "r", selectedVideoDeviceId: "a", revision: 2, media: { streams: [{ deviceId: "a", phase: "ready", playbackUrl: "http://127.0.0.1:18080/hls/stream-1/index.m3u8", diagnostic: "secret" }] }, disposed: false });
    expect(snapshot).toMatchObject({ phase: "ready", devices: [{ deviceId: "a", connection: { sdk: "ready", remoteController: "disconnected", flightState: "grounded", pairingState: "unknown", pose: null } }, { deviceId: "b", connection: { sdk: "unknown", aircraft: "unknown", pairingState: "unknown", pose: null } }] });
    expect(snapshot.media).toEqual({ streams: [{ deviceId: "a", phase: "ready", playbackUrl: "http://127.0.0.1:18080/hls/stream-1/index.m3u8" }] });
    expect(JSON.stringify(snapshot)).not.toContain("secret");
    expect(Object.isFrozen(snapshot)).toBe(true);
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
