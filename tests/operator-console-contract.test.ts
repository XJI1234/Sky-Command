import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OperatorConsole } from "../src/production/operator-console/index.js";

const renderer = () => readFileSync(new URL("../src/production/operator-console/renderer/main.ts", import.meta.url), "utf8");
const page = () => readFileSync(new URL("../src/production/operator-console/renderer/index.html", import.meta.url), "utf8");

const device = (overrides: Record<string, unknown> = {}) => ({
  deviceId: "phone-1",
  connection: {
    relay: "online",
    sdk: "ready",
    remoteController: "connected",
    flightController: "connected",
    aircraft: "connected",
    airLink: "connected",
    camera: "connected",
    battery: "connected",
    batteryPercent: 90,
    flightState: "grounded",
    motorsOn: false,
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
  it("设备页以独立标签显示精确 MSDK 生命周期", () => {
    const source = renderer();
    expect(source).toContain('case "ready": return { label: "MSDK 已就绪", ok: true }');
    expect(source).toContain('case "starting": return { label: "MSDK 正在初始化", ok: false }');
    expect(source).toContain('case "failed": return { label: "MSDK 初始化失败", ok: false }');
    expect(source).toContain('case "stopped": return { label: "MSDK 已停止", ok: false }');
    expect(source).toContain('MSDK 状态未知');
  });

  it("设备页只呈现可操作的飞控连接，不呈现保留诊断字段", () => {
    const source = renderer();
    expect(source).toContain('connectionLabel(connection, "flightController", "飞控已连接", "飞控未连接", "飞控状态未知")');
    expect(source).not.toContain('connectionLabel(connection, "aircraft"');
    expect(source).not.toContain("ProductKey.KeyConnection");
  });

  it("设备详情把基础连接、飞控、图传和电池按 MSDK 组件分区呈现", () => {
    const source = renderer();
    expect(source).toContain('class="connection-status-list"');
    expect(source).toContain('statusRow("电脑到手机中继 [桌面 Relay Session]", "中继在线", true)');
    expect(source).toContain('statusRow("MSDK 生命周期 [SDKManager]", msdk.label, msdk.ok)');
    expect(source).toContain('statusRow("遥控器连接 [RemoteControllerKey.KeyConnection]", connectionLabel(connection, "remoteController", "遥控器已连接", "遥控器未连接", "遥控器状态未知"), connected(connection, "remoteController"))');
    expect(source).toContain('statusRow("对频状态 [RemoteControllerKey.KeyPairingStatus]", pairing.label, pairing.ok)');
    expect(source).not.toContain("ProductKey.KeyConnection");
    expect(source).toContain("const flightControllerStatusRows = (connection: unknown): string => {");
    expect(source).toContain("const flightAssistantStatusRows = (connection: unknown): string => {");
    expect(source).toContain("const videoTransportStatusRows = (connection: unknown): string => {");
    expect(source).toContain("const batteryStatusRows = (connection: unknown): string => {");
    expect(source).toContain("const deviceInformationRows = (connection: unknown): string => {");
    expect(source).toContain('<h3 class="device-status-heading">飞控状态 [FlightControllerKey]</h3>');
    expect(source).toContain('<h3 class="device-status-heading">飞行辅助状态 [FlightAssistantKey]</h3>');
    expect(source).toContain('<h3 class="device-status-heading">图传状态 [AirLinkKey / CameraKey]</h3>');
    expect(source).toContain('<h3 class="device-status-heading">电池状态 [BatteryKey]</h3>');
    expect(source).toContain('<h3 class="device-status-heading">设备信息</h3>');
    expect(source).toContain("flightControllerStatusRows(connection)");
    expect(source).toContain("flightAssistantStatusRows(connection)");
    expect(source).toContain("videoTransportStatusRows(connection)");
    expect(source).toContain("batteryStatusRows(connection)");
    expect(source).toContain("deviceInformationRows(connection)");
  });

  it("每个 MSDK Key 只在自己的组件分区呈现，运行状态仍单独呈现", () => {
    const source = renderer();
    expect(source).not.toContain("deviceFactRows(connection)");
    expect(source).toContain('statusRow("机型 [ProductKey.KeyProductType]"');
    expect(source).toContain('statusRow("遥控器型号 [RemoteControllerKey.KeyRemoteControllerType]"');
    expect(source).toContain('statusRow("飞控连接 [FlightControllerKey.KeyConnection]"');
    expect(source).toContain('statusRow("飞行状态 [FlightControllerKey.KeyIsFlying]"');
    expect(source).toContain('statusRow("电机 [FlightControllerKey.KeyAreMotorsOn]"');
    expect(source).toContain('statusRow("AirLink 连接 [AirLinkKey.KeyConnection]"');
    expect(source).toContain('statusRow("主相机连接 [CameraKey.KeyConnection, LEFT_OR_MAIN]"');
    expect(source).toContain('statusRow("主电池连接 [BatteryKey.KeyConnection, LEFT_OR_MAIN]"');
    expect(source).toContain('statusRow("电量 [BatteryKey.KeyChargeRemainingInPercent, LEFT_OR_MAIN]"');
    expect(source).toContain('statusRow("低电量返航状态 [FlightControllerKey.KeyLowBatteryRTHInfo]"');
    expect(source).toContain('statusRow("低电量返航预估 [FlightControllerKey.KeyLowBatteryRTHInfo]"');
    expect(source).toContain('statusRow("飞行模式 [FlightControllerKey.KeyFCFlightMode]"');
    expect(source).toContain('statusRow("GPS 信号 [FlightControllerKey.KeyGPSSignalLevel]"');
    expect(source).toContain('statusRow("GPS 卫星数 [FlightControllerKey.KeyGPSSatelliteCount]"');
    expect(source).toContain('statusRow("视觉传感器 [FlightControllerKey.KeyIsVisionSensorUsed]"');
    expect(source).toContain('statusRow("降落确认 [FlightControllerKey.KeyIsLandingConfirmationNeeded]"');
    expect(source).toContain('statusRow("起飞失败原因 [FlightControllerKey.KeyTakeoffFailureError]"');
    expect(source).toContain('statusRow("电机启动失败原因 [FlightControllerKey.KeyMotorStartFailureError]"');
    expect(source).toContain('statusRow("视觉系统警告 [FlightAssistantKey.KeyVisionSystemWarning]"');
    expect(source).toContain('statusRow("视觉定位 [FlightAssistantKey.KeyVisionPositioningEnabled]"');
    expect(source).toContain('statusRow("降落保护状态 [FlightAssistantKey.KeyLandingProtectionState]"');
    expect(source).toContain('statusRow("相对起飞点高度 [FlightControllerKey.KeyAltitude]"');
    expect(source).toContain('statusRow("位置 [FlightControllerKey.KeyAircraftLocation]"');
    expect(source).toContain('statusRow("MSDK 图传观测 [手机 MSDK 图传运行观测]"');
    expect(source).toContain('statusRow("图传丢包 [LiveStreamStatus.packetLoss]"');
    expect(source).toContain('statusRow("图传缓存长度 [LiveStreamStatus.packetCacheLen]"');
    expect(source).toContain('statusRow("状态更新时间 [桌面接收时间]"');
    expect(source).toContain("runtimeStatusRows(inspected, view.streamDeviceId)");
    expect(source).toContain('statusRow("状态更新时间 [桌面接收时间]", telemetryTimeLabel(connection), telemetryTimeKnown(connection) && !flightFactsUnconfirmed(connection))');
    expect(source).toContain('statusRow("任务 [手机任务运行状态]", missionRuntimeLabel(read(device, "mission")), false)');
    expect(source).toContain('statusRow("手机推流 [手机图传运行状态]", streamRuntimeLabel(device), false)');
    expect(source).toContain('statusRow("桌面播放 [桌面播放器运行状态]", playbackRuntimeLabel(device, streamDeviceId), false)');
    expect(source).toContain('if (value === "UNKNOWN") return "未知（MSDK 返回 UNKNOWN）";');
    expect(source).toContain('code === "LANDING_IN_PROGRESS"');
    expect(source).toContain('await bridge().invoke("stream-select", { deviceId: view.streamDeviceId })');
  });

  it("飞控状态未知时把保留的动态事实明确标为上次更新且当前未确认", () => {
    const source = renderer();
    expect(source).toContain('read(connection, "flightController") === "unknown"');
    expect(source).toContain("飞控状态当前未确认");
    expect(source).toContain("上次更新于");
  });

  it("图传源失效优先于旧播放器的 ready 记录显示，并且不允许重复停止", () => {
    const view = OperatorConsole.project({
      snapshot: snapshot([device({
        stream: { phase: "failed", failureCode: "SOURCE_UNAVAILABLE" },
        video: { phase: "ready", selected: true },
      })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(view.streamLabel).toBe("图传源已断开，请恢复后手动启动图传");
    expect(view.playbackReady).toBe(false);
    expect(view.streamSourceUnavailable).toBe(true);
    expect(view.streamCanStop).toBe(false);
    expect(OperatorConsole.evaluate("stream-stop", view)).toEqual({
      ok: false,
      reason: "图传源已断开，手机已自动停止图传",
    });
  });

  it("普通图传失败仍保留一次人工停止机会", () => {
    const view = OperatorConsole.project({
      snapshot: snapshot([device({
        stream: { phase: "failed", failureCode: "RELAY_REJECTED" },
        video: { phase: "unavailable", selected: false },
      })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });

    expect(view.streamSourceUnavailable).toBe(false);
    expect(view.streamCanStop).toBe(true);
    expect(OperatorConsole.evaluate("stream-stop", view)).toEqual({ ok: true });
  });

  it("设备页将对频限定为新增设备的维护操作", () => {
    const source = renderer();
    expect(source).toContain("对频仅用于新增飞机或更换遥控器");
    expect(source).toContain("只有新增飞机或更换遥控器时，才在手机上开始对频");
    expect(source).not.toContain("遥控器连上后，请在手机上开始对频，再等飞机连上");
  });

  it("连接显示处于保持期时，操作台必须按控制事实禁用新操作", () => {
    const view = OperatorConsole.project({
      snapshot: snapshot([device({
        control: {
          sdk: "ready",
          remoteController: "disconnected",
          flightController: "disconnected",
          aircraft: "disconnected",
        },
        mission: { phase: "uploaded", routeId: "route-1" },
      })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });

    expect(view.streamCanStart).toBe(true);
    expect(view.missionActions.start).toEqual({ enabled: false, reason: "遥控器未连接" });
    expect(OperatorConsole.evaluate("stream-start", view)).toEqual({ ok: true });
  });

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
    expect(notUploaded.missionLabel).toBe("航线已准备到手机（飞机尚未收到）。下一步：上传至飞机");
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
    expect(starting.missionLabel).toBe("启动已受理，等待飞机实际进入航线");
    expect(starting.missionLabel).not.toContain("正在执行");
    expect(OperatorConsole.evaluate("mission-upload", starting)).toEqual({
      ok: false,
      reason: "请先将航线传输到手机",
    });

    const noAircraft = OperatorConsole.project({
      snapshot: snapshot([device({
        connection: { ...device().connection, aircraft: "disconnected" },
        mission: { phase: "idle" },
      })], { routes: [kmz], selectedRouteId: "route-1" }),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(OperatorConsole.evaluate("mission-stage", noAircraft)).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("mission-upload", noAircraft)).toEqual({
      ok: false,
      reason: "请先将航线传输到手机",
    });

    const sdkStarting = OperatorConsole.project({
      snapshot: snapshot([device({
        control: { sdk: "not-ready", remoteController: "connected", flightController: "connected", aircraft: "connected" },
        mission: { phase: "staged", routeId: "route-1" },
      })], { routes: [kmz], selectedRouteId: "route-1" }),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(OperatorConsole.evaluate("mission-upload", sdkStarting)).toEqual({
      ok: false,
      reason: "手机尚未就绪",
    });

    const capabilityUnknown = OperatorConsole.project({
      snapshot: snapshot([device({
        capabilities: { waypointMission: "unknown", liveVideo: "supported" },
        mission: { phase: "staged", routeId: "route-1" },
      })], { routes: [kmz], selectedRouteId: "route-1" }),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(OperatorConsole.evaluate("mission-upload", capabilityUnknown)).toEqual({
      ok: false,
      reason: "所选机型未上报航线能力",
    });
  });

  it("上传航线不依赖保留的 ProductKey 诊断状态", () => {
    const view = OperatorConsole.project({
      snapshot: snapshot([device({
        control: { ...device().connection, aircraft: "unknown" },
        mission: { phase: "staged", routeId: "route-1" },
      })], { routes: [kmz], selectedRouteId: "route-1" }),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });

    expect(view.missionActions.upload).toEqual({ enabled: true, reason: null });
    expect(OperatorConsole.evaluate("mission-upload", view)).toEqual({ ok: true });
  });

  it("飞行页始终投影已准备任务的航线，并给出阶段允许的下一步", () => {
    const second = { routeId: "route-2", displayName: "canal.kmz", format: "kmz", classification: "upload-candidate" };
    const staged = OperatorConsole.project({
      snapshot: snapshot([device({ mission: { phase: "staged", routeId: "route-1" } })], { routes: [kmz, second], selectedRouteId: "route-2" }),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });

    expect(staged).toMatchObject({
      missionRoute: { routeId: "route-1", displayName: "survey.kmz" },
      missionActions: {
        stage: { enabled: false },
        upload: { enabled: true, reason: null },
        start: { enabled: false, reason: "请先将当前航线上传到所选飞机" },
      },
    });

    const uploaded = OperatorConsole.project({
      snapshot: snapshot([device({ mission: { phase: "uploaded", routeId: "route-1" } })], { routes: [kmz, second], selectedRouteId: "route-2" }),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(uploaded).toMatchObject({
      missionRoute: { routeId: "route-1", displayName: "survey.kmz" },
      missionLabel: "航线已上传至飞机。下一步：执行航线",
      missionActions: { start: { enabled: true, reason: null } },
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

    const pausing = flight({ mission: { phase: "pausing", routeId: "route-1" } });
    expect(OperatorConsole.evaluate("mission-stop", pausing)).toEqual({ ok: true });

    const resuming = flight({ mission: { phase: "resuming", routeId: "route-1" } });
    expect(OperatorConsole.evaluate("mission-stop", resuming)).toEqual({ ok: true });

    const controlInterrupted = flight({
      control: { sdk: "ready", remoteController: "connected", flightController: "disconnected", aircraft: "disconnected" },
      mission: { phase: "running", routeId: "route-1" },
    });
    expect(OperatorConsole.evaluate("mission-pause", controlInterrupted)).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("mission-stop", controlInterrupted)).toEqual({ ok: true });

    const reconnected = flight({ mission: { phase: "disconnected", routeId: "route-1" } });
    expect(OperatorConsole.evaluate("mission-stop", reconnected)).toEqual({ ok: true });

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
    expect(OperatorConsole.evaluate("mission-start", unpaired)).toEqual({ ok: true });

    const noFc = flight({ connection: { ...device().connection, flightController: "disconnected" } });
    expect(OperatorConsole.evaluate("mission-start", noFc)).toEqual({
      ok: false,
      reason: "飞机飞控未连接，请确认飞机已开机",
    });
    expect(OperatorConsole.evaluate("stream-start", noFc)).toEqual({ ok: true });

    const noAircraft = flight({ connection: { ...device().connection, aircraft: "disconnected", flightController: "disconnected" } });
    expect(OperatorConsole.evaluate("stream-start", noAircraft)).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("mission-start", noAircraft)).toEqual({
      ok: false,
      reason: "飞机飞控未连接，请确认飞机已开机",
    });
    const aircraftOnlyGone = flight({ connection: { ...device().connection, aircraft: "disconnected", flightController: "connected" } });
    expect(OperatorConsole.evaluate("mission-start", aircraftOnlyGone)).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("stream-start", aircraftOnlyGone)).toEqual({ ok: true });
  });

  it("执行航线前必须确认电机尚未启动", () => {
    const flight = (motorsOn: boolean | null) => OperatorConsole.project({
      snapshot: snapshot([device({
        connection: { ...device().connection, motorsOn },
        mission: { phase: "uploaded", routeId: "route-1" },
      })], { routes: [kmz], selectedRouteId: "route-1" }),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });

    expect(OperatorConsole.evaluate("mission-start", flight(true))).toEqual({
      ok: false,
      reason: "电机已启动，禁止启动航线",
    });
    expect(OperatorConsole.evaluate("mission-start", flight(null))).toEqual({
      ok: false,
      reason: "尚未确认电机是否关闭，禁止启动航线",
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

  it("停止图传时不能被遗留播放器画面掩盖，并允许登记停止后重启", () => {
    const stopping = OperatorConsole.project({
      snapshot: snapshot([device({ stream: { phase: "stopping" }, video: { phase: "ready", selected: true } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });

    expect(stopping.streamLabel).toBe("正在停止图传");
    expect(stopping.streamCanStart).toBe(true);
    expect(stopping.streamCanStop).toBe(true);
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
    expect(noRc.streamLabel).toBe("图传可启动");
    expect(noRc.streamCanStart).toBe(true);

    const noSdk = OperatorConsole.project({
      snapshot: snapshot([device({ control: { ...device().connection, sdk: "not-ready" } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(noSdk.streamCanStart).toBe(false);
    expect(OperatorConsole.evaluate("stream-start", noSdk)).toEqual({ ok: false, reason: "手机尚未就绪，无法启动图传" });

    const unknownCapability = OperatorConsole.project({
      snapshot: snapshot([device({ capabilities: { waypointMission: "supported", liveVideo: "unknown" } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(unknownCapability.streamLabel).toBe("图传未就绪：图传状态未知");
    expect(unknownCapability.streamCanStart).toBe(false);
    expect(OperatorConsole.evaluate("stream-start", unknownCapability)).toEqual({ ok: false, reason: "手机端尚未确认当前图传链路状态，请刷新设备状态后重试" });

    const unavailableCapability = OperatorConsole.project({
      snapshot: snapshot([device({ capabilities: { waypointMission: "supported", liveVideo: "unsupported" } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(unavailableCapability.streamLabel).toBe("图传未就绪：图传链路未就绪");
    expect(unavailableCapability.streamCanStart).toBe(false);
    expect(OperatorConsole.evaluate("stream-start", unavailableCapability)).toEqual({ ok: false, reason: "手机端尚未确认 DJI 产品、AirLink 和主相机均已连接，无法启动图传" });

    const noAircraft = OperatorConsole.project({
      snapshot: snapshot([device({ connection: { ...device().connection, aircraft: "disconnected" } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(noAircraft.streamLabel).toBe("图传可启动");
    expect(noAircraft.streamCanStart).toBe(true);
    expect(OperatorConsole.evaluate("stream-start", noAircraft)).toEqual({ ok: true });
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
    expect(OperatorConsole.evaluate("flight-takeoff", flight({ batteryPercent: 19 }))).toEqual({
      ok: false,
      reason: "电量低于 20%，不能起飞",
    });
    expect(OperatorConsole.evaluate("flight-takeoff", flight({ flightState: "unknown" }))).toEqual({
      ok: false,
      reason: "尚未确认飞机是否在地面，不能起飞",
    });
    expect(OperatorConsole.evaluate("flight-takeoff", flight({ flightState: "flying" }))).toEqual({
      ok: false,
      reason: "飞机已在空中，不能起飞",
    });
    expect(OperatorConsole.evaluate("flight-takeoff", flight({ motorsOn: true }))).toEqual({
      ok: false,
      reason: "电机已启动，不能起飞",
    });
    expect(OperatorConsole.evaluate("flight-takeoff", flight({ motorsOn: null }))).toEqual({
      ok: false,
      reason: "尚未确认电机是否关闭，不能起飞",
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

  it("降落命令已被 DJI 接受后，在落地确认前禁止重复下发", () => {
    const view = OperatorConsole.project({
      snapshot: snapshot([device({
        connection: { ...device().connection, flightState: "flying", flightMode: "AUTO_LANDING" },
        landing: { phase: "awaiting-msdk" },
      })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(OperatorConsole.evaluate("flight-land", view)).toEqual({
      ok: false,
      reason: "降落命令已发送，等待 MSDK 确认落地",
    });
  });

  it("停止自动起飞和自动降落只接受对应的原始 MSDK 飞行模式", () => {
    const flight = (flightMode: string) => OperatorConsole.project({
      snapshot: snapshot([device({ connection: { ...device().connection, flightMode } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(OperatorConsole.evaluate("flight-stop-takeoff", flight("AUTO_TAKE_OFF"))).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("flight-stop-auto-landing", flight("AUTO_LANDING"))).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("flight-stop-auto-landing", flight("CONFIRM_LANDING"))).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("flight-stop-takeoff", flight("GPS_NORMAL"))).toMatchObject({ ok: false });
    expect(OperatorConsole.evaluate("flight-stop-auto-landing", flight("GPS_NORMAL"))).toMatchObject({ ok: false });
  });

  it("只在飞控明确要求继续降落时允许发送确认降落", () => {
    const allowed = OperatorConsole.project({
      snapshot: snapshot([device({ connection: { ...device().connection, flightState: "flying", landingConfirmationNeeded: true } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" }, workspace: "flight",
    });
    const blocked = OperatorConsole.project({
      snapshot: snapshot([device({ connection: { ...device().connection, flightState: "flying", landingConfirmationNeeded: false } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" }, workspace: "flight",
    });
    expect(OperatorConsole.evaluate("flight-confirm-landing", allowed)).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("flight-confirm-landing", blocked)).toEqual({ ok: false, reason: "MSDK 未要求确认继续降落" });
  });
});

describe("航线操作台渲染契约", () => {
  it("图传源已断开时，渲染器清理旧播放器且不允许其绕过停止门禁", () => {
    const source = renderer();
    expect(source).toContain("if (view.streamSourceUnavailable) detachVideo();");
    expect(source).toContain("const canStop = !view.streamSourceUnavailable && !streamStopping && (view.streamCanStop || attachedUrl !== null);");
  });

  it("设备页提供只读状态刷新，不把读取成功写成飞机或图传已就绪", () => {
    const source = renderer();
    expect(page()).toContain('id="device-refresh"');
    expect(source).toContain('bridge().invoke("device-refresh", { deviceId })');
    expect(source).toContain("已读取当前手机状态，请查看各项状态");
  });

  it("由任务投影禁用不合法按钮，并在执行前重新确认已上传任务身份", () => {
    const source = renderer();
    expect(source).toContain("view.missionActions[action]");
    expect(source).toContain("pendingMissionStart");
    expect(source).toContain("confirmMissionStart");
    expect(source).toContain("intent.missionId");
    expect(page()).toContain('id="mission-confirm"');
    expect(page()).toContain('id="mission-confirm-yes"');
    expect(page()).toContain('id="mission-confirm-no"');
  });

  it("将航线操作呈现为准备、上传、执行三个不可混淆的阶段", () => {
    const source = page();
    expect(source).toContain('class="mission-flow"');
    expect(source).toContain('data-mission-step="prepare"');
    expect(source).toContain('data-mission-step="upload"');
    expect(source).toContain('data-mission-step="execute"');
    expect(source).toContain('仅传输到手机并校验文件');
    expect(source).toContain('手机将已校验文件交给飞机');
    expect(source).toContain('执行前会再次要求确认');
    expect(source).toContain("flight-safety-controls");
    expect(source).not.toContain('>传输到手机<');
    expect(source).not.toContain('>开始<');
  });
});
