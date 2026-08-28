import { describe, expect, it } from "vitest";
import { OperatorConsole } from "../src/production/operator-console/index.js";

const device = (overrides: Record<string, unknown> = {}) => ({
  deviceId: "phone-1",
  connection: {
    relay: "online",
    sdk: "ready",
    remoteController: "connected",
    flightController: "connected",
    aircraft: "connected",
    batteryPercent: 90,
    flightState: "grounded",
    pairingState: "PAIRED",
    pose: { latitude: 30.2, longitude: 120.2, altitudeMeters: 48 },
  },
  capabilities: { waypointMission: "supported", liveVideo: "supported" },
  assignment: { routeId: "route-1", routeName: "survey" },
  mission: { phase: "starting", routeId: "route-1" },
  stream: { phase: "idle" },
  video: { phase: "unavailable", selected: false },
  pendingFlightAction: null,
  ...overrides,
});

const snapshot = (devices: readonly unknown[], extra: Record<string, unknown> = {}) => ({
  phase: "running",
  workflow: {
    devices,
    selectedRouteId: "route-1",
    selectedVideoDeviceId: null,
    routes: [{ routeId: "route-1", displayName: "survey" }],
    ...extra,
  },
});

describe("操作台投影", () => {
  it("多机时不自动改选任务机或图传机", () => {
    const view = OperatorConsole.project({
      snapshot: snapshot([device(), device({ deviceId: "phone-2", connection: { ...device().connection, pose: { latitude: 30.3, longitude: 120.3, altitudeMeters: 12 } } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-2" },
    });

    expect(view.missionDeviceId).toBe("phone-1");
    expect(view.streamDeviceId).toBe("phone-2");
    expect(view.markers).toEqual([
      { deviceId: "phone-1", latitude: 30.2, longitude: 120.2, altitudeMeters: 48, role: "mission" },
      { deviceId: "phone-2", latitude: 30.3, longitude: 120.3, altitudeMeters: 12, role: "stream" },
    ]);
  });

  it("只有一台在线设备时自动选为任务机和待开图传机", () => {
    const view = OperatorConsole.project({
      snapshot: snapshot([device()]),
      selection: { missionDeviceId: null, streamDeviceId: null },
    });

    expect(view.missionDeviceId).toBe("phone-1");
    expect(view.streamDeviceId).toBe("phone-1");
  });

  it("已消失的选中设备清空，绝不改选到另一台", () => {
    const view = OperatorConsole.project({
      snapshot: snapshot([device({ deviceId: "phone-2" })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
    });

    expect(view.missionDeviceId).toBeNull();
    expect(view.streamDeviceId).toBeNull();
  });

  it("没有坐标的飞机不画点，任务机待确认动作必须带上", () => {
    const view = OperatorConsole.project({
      snapshot: snapshot([
        device({
          connection: { ...device().connection, pose: null },
          pendingFlightAction: { deviceId: "phone-1", action: "takeoff", confirmationId: "confirm-1", expiresAtMs: 9_000 },
        }),
      ]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
    });

    expect(view.markers).toEqual([]);
    expect(view.confirmation).toEqual({ deviceId: "phone-1", action: "takeoff", confirmationId: "confirm-1", expiresAtMs: 9_000 });
    expect(view.mission?.phase).toBe("starting");
  });

  it("图传已选中的设备在地图上标为 stream，与任务机重合时标 both", () => {
    const view = OperatorConsole.project({
      snapshot: snapshot([device({ video: { phase: "ready", selected: true } })], { selectedVideoDeviceId: "phone-1" }),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
    });

    expect(view.markers[0]?.role).toBe("both");
    expect(view.playingVideoDeviceId).toBe("phone-1");
  });

  it("畸形快照得到空视图，不抛异常", () => {
    expect(OperatorConsole.project({ snapshot: null, selection: { missionDeviceId: "x", streamDeviceId: "y" } })).toMatchObject({
      devices: [],
      missionDeviceId: null,
      streamDeviceId: null,
      markers: [],
      confirmation: null,
    });
  });
});

describe("操作台工作区", () => {
  const kmz = { routeId: "route-1", displayName: "survey.kmz", format: "kmz", classification: "upload-candidate" };
  const kml = { routeId: "route-kml", displayName: "track.kml", format: "kml", classification: "preview-only" };

  it("默认落在设备工作区，并给出 Relay 连接提示", () => {
    const view = OperatorConsole.project({
      snapshot: snapshot([device()]),
      selection: { missionDeviceId: null, streamDeviceId: null },
      relayHint: "ws://192.168.1.10:8080/relay",
    });
    expect(view.workspace).toBe("devices");
    expect(view.relayHint).toBe("ws://192.168.1.10:8080/relay");
    expect(OperatorConsole.evaluate("mission-start", view)).toEqual({
      ok: false,
      reason: "请到飞行页执行任务",
    });
  });

  it("航线页把 KML 标成仅预览，KMZ 校验通过才可执行", () => {
    const view = OperatorConsole.project({
      snapshot: snapshot([device()], { routes: [kmz, kml], selectedRouteId: "route-kml" }),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "routes",
    });
    expect(view.routes).toEqual([
      { routeId: "route-1", displayName: "survey.kmz", format: "kmz", classification: "upload-candidate", executable: true, previewable: true, blockedReason: null },
      { routeId: "route-kml", displayName: "track.kml", format: "kml", classification: "preview-only", executable: false, previewable: true, blockedReason: "KML 只能预览，不能提交给飞机" },
    ]);
    expect(view.selectedRoute?.executable).toBe(false);
    expect(OperatorConsole.evaluate("mission-start", view)).toEqual({
      ok: false,
      reason: "航线页不执行飞行或图传，请到飞行页操作",
    });
    expect(OperatorConsole.evaluate("import-route", view)).toEqual({ ok: true });
  });

  it("删除后若当前选择为空或已不存在，投影到剩余航线，不得当成没有航线", () => {
    const remaining = { routeId: "route-2", displayName: "canal.kmz", format: "kmz", classification: "upload-candidate" };
    const missingSelection = OperatorConsole.project({
      snapshot: snapshot([device()], { routes: [remaining], selectedRouteId: null }),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "routes",
    });
    expect(missingSelection.routes).toHaveLength(1);
    expect(missingSelection.selectedRoute).toMatchObject({ routeId: "route-2", displayName: "canal.kmz" });

    const danglingSelection = OperatorConsole.project({
      snapshot: snapshot([device()], { routes: [remaining], selectedRouteId: "route-1" }),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "routes",
    });
    expect(danglingSelection.selectedRoute).toMatchObject({ routeId: "route-2" });

    const emptied = OperatorConsole.project({
      snapshot: snapshot([device()], { routes: [], selectedRouteId: null }),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "routes",
    });
    expect(emptied.routes).toEqual([]);
    expect(emptied.selectedRoute).toBeNull();
  });

  it("飞行页在未上传、电量不足或能力未知时给出具体原因，不得写成正在执行", () => {
    const notUploaded = OperatorConsole.project({
      snapshot: snapshot([device({ mission: { phase: "staged", routeId: "route-1" } })], { routes: [kmz], selectedRouteId: "route-1" }),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(notUploaded.missionLabel).toBe("已传输到手机（飞机尚未收到）");
    expect(OperatorConsole.evaluate("mission-upload", notUploaded)).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("mission-start", notUploaded)).toEqual({
      ok: false,
      reason: "请先将当前航线上传到所选飞机",
    });

    const lowBattery = OperatorConsole.project({
      snapshot: snapshot([device({
        connection: { ...device().connection, batteryPercent: 12 },
        mission: { phase: "uploaded", routeId: "route-1" },
      })], { routes: [kmz], selectedRouteId: "route-1" }),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(OperatorConsole.evaluate("mission-start", lowBattery)).toEqual({
      ok: false,
      reason: "电量低于 20%，禁止启动或继续任务",
    });

    const starting = OperatorConsole.project({
      snapshot: snapshot([device({ mission: { phase: "starting", routeId: "route-1" } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(starting.missionLabel).toBe("启动中（等待航线阶段回报）");
    expect(starting.missionLabel).not.toContain("正在执行");
    expect(OperatorConsole.evaluate("mission-upload", starting)).toEqual({
      ok: false,
      reason: "请先将航线传输到手机",
    });

    const noAircraft = OperatorConsole.project({
      snapshot: snapshot([device({
        connection: { ...device().connection, aircraft: "disconnected" },
      })], { routes: [kmz], selectedRouteId: "route-1" }),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(OperatorConsole.evaluate("mission-stage", noAircraft)).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("mission-upload", noAircraft)).toEqual({
      ok: false,
      reason: "飞机尚未连接",
    });
  });

  it("暂停恢复停止只允许调度器承认的阶段，启动还要看飞控和是否在飞", () => {
    const flight = (overrides: Record<string, unknown> = {}) => OperatorConsole.project({
      snapshot: snapshot([device({ mission: { phase: "uploaded", routeId: "route-1" }, ...overrides })], { routes: [kmz], selectedRouteId: "route-1" }),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });

    const uploaded = flight();
    expect(OperatorConsole.evaluate("mission-pause", uploaded)).toEqual({ ok: false, reason: "当前阶段不能暂停" });
    expect(OperatorConsole.evaluate("mission-resume", uploaded)).toEqual({ ok: false, reason: "当前阶段不能恢复" });
    expect(OperatorConsole.evaluate("mission-stop", uploaded)).toEqual({ ok: false, reason: "当前阶段不能停止航线" });
    expect(OperatorConsole.evaluate("mission-start", uploaded)).toEqual({ ok: true });

    const running = flight({ mission: { phase: "running", routeId: "route-1" } });
    expect(OperatorConsole.evaluate("mission-pause", running)).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("mission-stop", running)).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("mission-resume", running)).toEqual({ ok: false, reason: "当前阶段不能恢复" });

    const paused = flight({ mission: { phase: "paused", routeId: "route-1" } });
    expect(OperatorConsole.evaluate("mission-resume", paused)).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("mission-stop", paused)).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("mission-pause", paused)).toEqual({ ok: false, reason: "当前阶段不能暂停" });

    const starting = flight({ mission: { phase: "starting", routeId: "route-1" } });
    expect(OperatorConsole.evaluate("mission-stop", starting)).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("mission-pause", starting)).toEqual({ ok: false, reason: "当前阶段不能暂停" });

    const flying = flight({ connection: { ...device().connection, flightState: "flying" } });
    expect(OperatorConsole.evaluate("mission-start", flying)).toEqual({
      ok: false,
      reason: "飞机已在空中，禁止启动航线",
    });

    const unknownFlight = flight({ connection: { ...device().connection, flightState: "unknown" } });
    expect(OperatorConsole.evaluate("mission-start", unknownFlight)).toEqual({
      ok: false,
      reason: "尚未确认飞机是否在地面，禁止启动航线",
    });

    const unpaired = flight({ connection: { ...device().connection, pairingState: "IDLE" } });
    expect(OperatorConsole.evaluate("mission-start", unpaired)).toEqual({
      ok: false,
      reason: "飞机尚未完成对频，请先在手机上完成对频",
    });

    const noFc = flight({ connection: { ...device().connection, flightController: "disconnected" } });
    expect(OperatorConsole.evaluate("mission-start", noFc)).toEqual({
      ok: false,
      reason: "飞机飞控未连接，请确认飞机已开机",
    });
    expect(OperatorConsole.evaluate("stream-start", noFc)).toEqual({ ok: true });

    const noAircraft = flight({ connection: { ...device().connection, aircraft: "disconnected", flightController: "disconnected" } });
    expect(OperatorConsole.evaluate("stream-start", noAircraft)).toEqual({
      ok: false,
      reason: "飞机未连接，无法启动图传",
    });
    expect(OperatorConsole.evaluate("mission-start", noAircraft)).toEqual({
      ok: false,
      reason: "飞机飞控未连接，请确认飞机已开机",
    });
    const aircraftOnlyGone = flight({ connection: { ...device().connection, aircraft: "disconnected", flightController: "connected" } });
    expect(OperatorConsole.evaluate("mission-start", aircraftOnlyGone)).toEqual({
      ok: false,
      reason: "飞机尚未连接",
    });
    expect(OperatorConsole.evaluate("stream-start", aircraftOnlyGone)).toEqual({
      ok: false,
      reason: "飞机未连接，无法启动图传",
    });
  });

  it("只有画面 ready 才算可播放，手机接受推流不得写成实时图传", () => {
    const waiting = OperatorConsole.project({
      snapshot: snapshot([device({ stream: { phase: "starting" }, video: { phase: "awaiting-playback", selected: true } })], { selectedVideoDeviceId: "phone-1" }),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(waiting.playbackReady).toBe(false);
    expect(waiting.streamLabel).toBe("正在准备画面");
    expect(waiting.streamCanStart).toBe(false);
    expect(waiting.streamCanStop).toBe(true);

    const commandOnly = OperatorConsole.project({
      snapshot: snapshot([device({ stream: { phase: "streaming" }, video: { phase: "unavailable", selected: false } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(commandOnly.playbackReady).toBe(false);
    expect(commandOnly.streamLabel).toBe("手机已接命令，电脑还没收到画面");
    expect(commandOnly.streamCanStop).toBe(true);

    const ready = OperatorConsole.project({
      snapshot: snapshot([device({ stream: { phase: "streaming" }, video: { phase: "ready", selected: true } })], { selectedVideoDeviceId: "phone-1" }),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(ready.playbackReady).toBe(true);
    expect(ready.streamLabel).toBe("图传播放中");
    expect(ready.streamCanStart).toBe(false);
    expect(ready.streamCanStop).toBe(true);
  });

  it("空闲图传必须提前标明能否启动，而不是笼统写空闲", () => {
    const ready = OperatorConsole.project({
      snapshot: snapshot([device()]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(ready.streamLabel).toBe("图传可启动");
    expect(ready.streamCanStart).toBe(true);
    expect(ready.streamCanStop).toBe(false);

    const noRc = OperatorConsole.project({
      snapshot: snapshot([device({ connection: { ...device().connection, remoteController: "disconnected" } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(noRc.streamLabel).toBe("图传未就绪：遥控器未连接");
    expect(noRc.streamCanStart).toBe(false);

    const noAircraft = OperatorConsole.project({
      snapshot: snapshot([device({ connection: { ...device().connection, aircraft: "disconnected" } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(noAircraft.streamLabel).toBe("图传未就绪：飞机未连接");
    expect(noAircraft.streamCanStart).toBe(false);
  });

  it("封存低延迟图传后，生产图传不受归档状态影响", () => {
    const view = OperatorConsole.project({
      snapshot: snapshot([device({
        whipStream: { phase: "streaming" },
        video: { phase: "unavailable", selected: false },
      })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(view.streamLabel).toBe("图传可启动");
    expect(OperatorConsole.evaluate("webrtc-stream-start", view)).toEqual({
      ok: false,
      reason: "未知操作",
    });
    expect(OperatorConsole.evaluate("webrtc-stream-stop", view)).toEqual({
      ok: false,
      reason: "未知操作",
    });
    expect(OperatorConsole.evaluate("stream-start", view)).toEqual({ ok: true });

    const hlsView = OperatorConsole.project({
      snapshot: snapshot([device({ stream: { phase: "streaming" } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(OperatorConsole.evaluate("webrtc-stream-start", hlsView)).toEqual({ ok: false, reason: "未知操作" });
    expect(OperatorConsole.evaluate("stream-start", hlsView)).toEqual({ ok: true });
  });

  it("对频由手机端完成，桌面只说明事实，不假装已经发出命令", () => {
    const view = OperatorConsole.project({
      snapshot: snapshot([device()]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "devices",
    });
    expect(OperatorConsole.evaluate("pairing-start", view)).toEqual({
      ok: false,
      reason: "请到手机上开始或停止对频。",
    });
    expect(OperatorConsole.evaluate("pairing-stop", view)).toEqual({
      ok: false,
      reason: "请到手机上开始或停止对频。",
    });
  });

  it("起飞按钮必须与真实放行一致，电量或飞行状态未确认时不能点", () => {
    const flight = (overrides: Record<string, unknown> = {}) => OperatorConsole.project({
      snapshot: snapshot([device({ connection: { ...device().connection, ...overrides } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(OperatorConsole.evaluate("flight-takeoff", flight())).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("flight-takeoff", flight({ batteryPercent: null }))).toEqual({
      ok: false,
      reason: "尚未取得所选飞机的电池遥测",
    });
    expect(OperatorConsole.evaluate("flight-takeoff", flight({ flightState: "unknown" }))).toEqual({
      ok: false,
      reason: "尚未确认飞机是否在地面，不能起飞",
    });
    expect(OperatorConsole.evaluate("flight-takeoff", flight({ flightState: "flying" }))).toEqual({
      ok: false,
      reason: "飞机已在空中，不能起飞",
    });
    expect(OperatorConsole.evaluate("flight-land", flight({ flightState: "flying" }))).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("flight-land", flight({ flightState: "unknown" }))).toEqual({
      ok: false,
      reason: "尚未确认飞机是否在空中",
    });
    expect(OperatorConsole.evaluate("flight-land", flight({ flightState: "grounded" }))).toEqual({
      ok: false,
      reason: "飞机已在地面，无需降落",
    });
    expect(OperatorConsole.evaluate("flight-return-home", flight({ flightState: "grounded" }))).toEqual({
      ok: false,
      reason: "飞机已在地面，不能返航",
    });
  });
});
