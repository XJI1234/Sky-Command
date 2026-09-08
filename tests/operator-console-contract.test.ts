import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OperatorConsole } from "../src/production/operator-console/index.js";

const renderer = () => readFileSync(new URL("../src/production/operator-console/renderer/main.ts", import.meta.url), "utf8");
const page = () => readFileSync(new URL("../src/production/operator-console/renderer/index.html", import.meta.url), "utf8");
const operatorConsole = () => readFileSync(new URL("../src/production/operator-console/index.ts", import.meta.url), "utf8");

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
  it("图传播放器异常不能中断整轮刷新，并且只在业务选择成功后标记播放器设备", () => {
    const source = renderer();

    expect(source).toContain("const safeRenderInvoke");
    expect(source).toContain("const playbackResult = await safeRenderInvoke");
    expect(source).toContain("const selected = unwrap(await safeRenderInvoke");
    expect(source).toContain("selectedPlaybackDeviceId = view.streamDeviceId");
  });

  it("飞行页状态刷新失败不能跳过图传挂载", () => {
    const source = renderer();
    expect(source).toMatch(/try \{\s*renderFlight\(view\);\s*\} catch/);
    expect(source).toContain("await ensurePlayback(view, signal)");
    expect(source.indexOf("try { renderFlight(view); }")).toBeLessThan(source.indexOf("await ensurePlayback(view, signal)"));
  });

  it("图传必须在 MediaSource/视频元数据就绪后重试播放，不能只在 load 后调用一次 play", () => {
    const source = renderer();

    expect(source).toContain("const scheduleVideoPlay");
    expect(source).toContain("flvjs.Events.MEDIA_INFO");
    expect(source).toContain('["loadedmetadata", "loadeddata", "canplay", "playing"]');
    expect(source).toContain("video.addEventListener(event, onReady)");
    expect(source).toContain("scheduleVideoPlay(video)");
  });

  it("起飞请求保留确认意图并复用已读取快照，刷新失败时仍能展示确认框", () => {
    const source = renderer();

    expect(source).toContain("let pendingFlightConfirmation");
    expect(source).toContain("const renderFlightConfirmationFallback");
    expect(source).toContain("await run(action, invokeName, input, view)");
    expect(source).toContain("renderFlightConfirmationFallback();");
  });

  it("航线执行确认在刷新失败时保留意图，并复用确认前已读取的快照", () => {
    const source = renderer();

    expect(source).toContain("const renderMissionStartConfirmationFallback");
    expect(source).toContain("renderMissionStartConfirmationFallback();");
    expect(source).toContain("pendingMissionStart = intent;");
    expect(source).toContain('await run("mission-start", "mission-start", { deviceId: intent.deviceId }, view);');
  });

  it("飞行页本地确认创建后必须进入右栏当前可视区域且契约禁止自动下发", () => {
    const source = renderer();
    const contract = readFileSync(new URL("../src/production/operator-console/CONTRACT.md", import.meta.url), "utf8");

    expect(source).toContain("const revealFlightConfirmation");
    expect(source).toContain("confirmation.scrollIntoView");
    expect(source).toContain("revealFlightConfirmation(confirm, confirmation.confirmationId)");
    expect(source).toContain("revealFlightConfirmation(missionConfirm,");
    expect(contract).toContain("同一确认只能主动定位一次");
    expect(contract).toContain("不得自动确认、发送 DJI 指令");
  });

  it.each(["flight-land", "flight-confirm-landing", "flight-return-home", "flight-stop-takeoff", "flight-stop-auto-landing"] as const)("收尾动作 %s 不由页面上的遥控器、飞控或飞行状态推断拦截", (action) => {
    const view = OperatorConsole.project({
      snapshot: snapshot([device({
        control: { sdk: "ready", remoteController: "disconnected", flightController: "unknown" },
        connection: { ...device().connection, flightState: "unknown", flightMode: "GPS_NORMAL", landingConfirmationNeeded: false },
      })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });

    expect(OperatorConsole.evaluate(action, view)).toEqual({ ok: true });
  });

  it("收尾动作仍要求所选手机的 MSDK 已就绪", () => {
    const view = OperatorConsole.project({
      snapshot: snapshot([device({ control: { sdk: "not-ready", remoteController: "connected", flightController: "connected" } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });

    expect(OperatorConsole.evaluate("flight-land", view)).toEqual({ ok: false, reason: "手机尚未就绪" });
  });

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
    expect(source).toContain('statusRow("MSDK 运行期错误 [LiveStreamStatusListener.onError]"');
    expect(source).toContain('statusRow("状态更新时间 [桌面接收时间]"');
    expect(source).toContain("runtimeStatusRows(view, inspected, view.streamDeviceId)");
    expect(source).toContain('statusRow("状态更新时间 [桌面接收时间]", telemetryTimeLabel(connection), telemetryTimeKnown(connection) && !flightFactsUnconfirmed(connection))');
    expect(source).toContain('statusRow("任务 [手机任务运行状态]", missionRuntimeLabel(read(device, "mission")), false)');
    expect(source).toContain('statusRow("手机推流 [手机图传运行状态]", streamRuntimeLabel(device), false)');
    expect(source).toContain('statusRow("实际渲染 [HTMLVideoElement]", playbackRuntimeLabel(device, streamDeviceId), false)');
    expect(source).toContain('if (value === "UNKNOWN") return "未知（MSDK 返回 UNKNOWN）";');
    expect(source).not.toContain('code === "LANDING_IN_PROGRESS"');
    expect(source).toContain('safeRenderInvoke("stream-select", { deviceId: view.streamDeviceId }, signal)');
  });

  it("飞控状态未知时把保留的动态事实明确标为上次更新且当前未确认", () => {
    const source = renderer();
    expect(source).toContain('read(connection, "flightController") === "unknown"');
    expect(source).toContain("飞控状态当前未确认");
    expect(source).toContain("上次更新于");
  });

  it("直接飞行在不重复原始 Key 的前提下汇总本次降落的持续结果", () => {
    const source = renderer();
    const html = page();

    expect(html).toContain('id="landing-status"');
    expect(html).toContain("降落过程");
    expect(source).toContain("const landingProgressStatus");
    expect(source).toContain('protection === "NOT_SAFE_TO_LAND"');
    expect(source).toContain("DJI 降落保护报告当前不适合降落，自动降落已暂停");
    expect(source).toContain('mode === "AUTO_LANDING"');
    expect(source).toContain("DJI 正在自动降落，等待持续飞行状态确认");
    expect(source).toContain('mode === "CONFIRM_LANDING"');
    expect(source).toContain("DJI 正在确认继续降落，等待持续飞行状态确认");
    expect(source).toContain('flying === "grounded" && motorsOn === false');
    expect(source).toContain("已确认落地（MSDK 持续状态：未飞行且电机关闭）");
    expect(source).toContain("landingProgressStatus(landingPhase, landingDevice)");
  });

  it("renderFlight 用已定义的 landingDevice 更新降落过程，不引用未声明变量", () => {
    const flight = renderer().slice(renderer().indexOf("function renderFlight"));
    expect(flight).toContain("const landingDevice = devices.find");
    expect(flight).toContain("landingProgressStatus(landingPhase, landingDevice)");
    expect(flight).not.toContain("landingProgressStatus(landingPhase, missionDevice)");
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

  it("图传停止后仍显示手机 MSDK 的最后一次运行期错误回调", () => {
    const view = OperatorConsole.project({
      snapshot: snapshot([device({
        connection: {
          ...device().connection,
          live: {
            streaming: false,
            notice: "DJI live stream runtime error",
            runtimeError: {
              code: "COMMON_SYSTEM_BUSY",
              description: "The live stream manager is busy",
            },
          },
        },
        stream: { phase: "failed" },
        video: { phase: "ready", selected: true },
      })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });

    expect(view.streamLabel).toBe(
      "DJI MSDK 图传运行回调：错误码：COMMON_SYSTEM_BUSY；错误说明：The live stream manager is busy",
    );
    expect(renderer()).toMatch(/const streamHasDjiRuntimeError =\s+view\.streamLabel\.startsWith\("DJI MSDK 图传运行回调："\);/);
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

  it("连接显示处于保持期时，操作台只因 MSDK 不可达而禁用新的航线操作", () => {
    const view = OperatorConsole.project({
      snapshot: snapshot([device({
        control: {
          sdk: "ready",
          remoteController: "disconnected",
          flightController: "disconnected",
          aircraft: "disconnected",
          airLink: "connected",
          camera: "connected",
        },
        mission: { phase: "uploaded", routeId: "route-1" },
      })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });

    expect(view.streamCanStart).toBe(true);
    expect(view.missionActions.start).toEqual({ enabled: true, reason: null });
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

  it("飞行页保留任务阶段和 MSDK 可达性门禁，不用本地设备事实预判 DJI 航线操作", () => {
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
    expect(OperatorConsole.evaluate("mission-start", lowBattery)).toEqual({ ok: true });

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
    expect(OperatorConsole.evaluate("mission-upload", capabilityUnknown)).toEqual({ ok: true });
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

  it("暂停恢复停止只允许调度器承认的阶段，启动保留已上传任务和 MSDK 可达性", () => {
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

    const stopping = flight({ mission: { phase: "stopping", routeId: "route-1" } });
    expect(OperatorConsole.evaluate("mission-stop", stopping)).toEqual({ ok: true });

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
    expect(OperatorConsole.evaluate("mission-start", flying)).toEqual({ ok: true });

    const unknownFlight = flight({ connection: { ...device().connection, flightState: "unknown" } });
    expect(OperatorConsole.evaluate("mission-start", unknownFlight)).toEqual({ ok: true });

    const unpaired = flight({ connection: { ...device().connection, pairingState: "IDLE" } });
    expect(OperatorConsole.evaluate("mission-start", unpaired)).toEqual({ ok: true });

    const noFc = flight({ connection: { ...device().connection, flightController: "disconnected" } });
    expect(OperatorConsole.evaluate("mission-start", noFc)).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("stream-start", noFc)).toEqual({ ok: true });

    const noAircraft = flight({ connection: { ...device().connection, aircraft: "disconnected", flightController: "disconnected" } });
    expect(OperatorConsole.evaluate("stream-start", noAircraft)).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("mission-start", noAircraft)).toEqual({ ok: true });
    const aircraftOnlyGone = flight({ connection: { ...device().connection, aircraft: "disconnected", flightController: "connected" } });
    expect(OperatorConsole.evaluate("mission-start", aircraftOnlyGone)).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("stream-start", aircraftOnlyGone)).toEqual({ ok: true });
  });

  it("暂停恢复停止也只检查命令可达性，不把设备安全事实提前当作 DJI 裁决", () => {
    const flight = (phase: string, sdk: string) => OperatorConsole.project({
      snapshot: snapshot([device({
        control: { sdk, remoteController: "disconnected", flightController: "unknown" },
        mission: { phase, routeId: "route-1" },
        connection: { ...device().connection, flightState: "unknown", motorsOn: null, batteryPercent: null },
      })], { routes: [kmz], selectedRouteId: "route-1" }),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });

    const ready = flight("running", "ready");
    expect(OperatorConsole.evaluate("mission-pause", ready)).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("mission-stop", ready)).toEqual({ ok: true });

    const notReady = flight("running", "starting");
    expect(OperatorConsole.evaluate("mission-pause", notReady)).toEqual({ ok: false, reason: "手机尚未就绪" });
    expect(OperatorConsole.evaluate("mission-stop", notReady)).toEqual({ ok: false, reason: "手机尚未就绪" });

    const paused = flight("paused", "ready");
    expect(OperatorConsole.evaluate("mission-resume", paused)).toEqual({ ok: true });
  });

  it("当前 MSDK 遥测已就绪时不因不完整的 control 投影禁用命令", () => {
    const view = OperatorConsole.project({
      snapshot: snapshot([device({
        connection: { ...device().connection, msdk: "ready" },
        control: { sdk: "not-ready", remoteController: "unknown", flightController: "unknown" },
        mission: { phase: "uploaded", routeId: "route-1" },
        capabilities: { liveVideo: "supported" },
      })], { routes: [kmz], selectedRouteId: "route-1" }),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });

    expect(OperatorConsole.evaluate("mission-start", view)).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("stream-start", view)).toEqual({ ok: true });
  });

  it("执行航线不因本地电机遥测而阻止 DJI 返回实际结果", () => {
    const flight = (motorsOn: boolean | null) => OperatorConsole.project({
      snapshot: snapshot([device({
        connection: { ...device().connection, motorsOn },
        mission: { phase: "uploaded", routeId: "route-1" },
      })], { routes: [kmz], selectedRouteId: "route-1" }),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });

    expect(OperatorConsole.evaluate("mission-start", flight(true))).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("mission-start", flight(null))).toEqual({ ok: true });
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
    expect(ready.streamLabel).toBe("图传可请求启动");
    expect(ready.streamCanStart).toBe(true);
    expect(ready.streamCanStop).toBe(false);

    const noRc = OperatorConsole.project({
      snapshot: snapshot([device({ connection: { ...device().connection, remoteController: "disconnected" } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(noRc.streamLabel).toBe("图传可请求启动");
    expect(noRc.streamCanStart).toBe(true);

    const noSdk = OperatorConsole.project({
      snapshot: snapshot([device({ control: { ...device().connection, sdk: "not-ready" } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(noSdk.streamCanStart).toBe(false);
    expect(OperatorConsole.evaluate("stream-start", noSdk)).toEqual({ ok: false, reason: "手机尚未就绪，无法启动图传" });

    const unknownAirLink = OperatorConsole.project({
      snapshot: snapshot([device({ connection: { ...device().connection, airLink: "unknown" } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(unknownAirLink.streamLabel).toBe("图传未就绪：AirLink 状态未知");
    expect(unknownAirLink.streamCanStart).toBe(false);
    expect(OperatorConsole.evaluate("stream-start", unknownAirLink)).toEqual({ ok: false, reason: "AirLink 状态未知，无法启动图传" });

    const disconnectedCamera = OperatorConsole.project({
      snapshot: snapshot([device({ connection: { ...device().connection, camera: "disconnected" } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(disconnectedCamera.streamLabel).toBe("图传未就绪：主相机未连接");
    expect(disconnectedCamera.streamCanStart).toBe(false);
    expect(OperatorConsole.evaluate("stream-start", disconnectedCamera)).toEqual({ ok: false, reason: "主相机未连接，无法启动图传" });

    const noAircraft = OperatorConsole.project({
      snapshot: snapshot([device({ connection: { ...device().connection, aircraft: "disconnected" } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(noAircraft.streamLabel).toBe("图传可请求启动");
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
    expect(view.streamLabel).toBe("图传可请求启动");
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

  it("起飞按钮只因命令不可达而禁用，本地遥测不替 DJI 提前拒绝", () => {
    const flight = (overrides: Record<string, unknown> = {}) => OperatorConsole.project({
      snapshot: snapshot([device({ connection: { ...device().connection, ...overrides } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(OperatorConsole.evaluate("flight-takeoff", flight())).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("flight-takeoff", flight({ batteryPercent: null }))).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("flight-takeoff", flight({ batteryPercent: 19 }))).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("flight-takeoff", flight({ flightState: "unknown" }))).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("flight-takeoff", flight({ flightState: "flying" }))).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("flight-takeoff", flight({ motorsOn: true }))).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("flight-takeoff", flight({ motorsOn: null }))).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("flight-land", flight({ flightState: "flying" }))).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("flight-land", flight({ flightState: "unknown" }))).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("flight-land", flight({ flightState: "grounded" }))).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("flight-return-home", flight({ flightState: "grounded" }))).toEqual({ ok: true });
  });

  it.each(["awaiting-msdk", "confirmation-required"] as const)("降落状态为 %s 时仍将新的降落请求交给可达的 MSDK", (phase) => {
    const view = OperatorConsole.project({
      snapshot: snapshot([device({
        connection: { ...device().connection, flightState: "flying", flightMode: "AUTO_LANDING" },
        landing: { phase },
      })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(OperatorConsole.evaluate("flight-land", view)).toEqual({ ok: true });
  });

  it("停止自动起飞和自动降落不由页面上的飞行模式推断拦截", () => {
    const flight = (flightMode: string) => OperatorConsole.project({
      snapshot: snapshot([device({ connection: { ...device().connection, flightMode } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(OperatorConsole.evaluate("flight-stop-takeoff", flight("AUTO_TAKE_OFF"))).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("flight-stop-auto-landing", flight("AUTO_LANDING"))).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("flight-stop-auto-landing", flight("CONFIRM_LANDING"))).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("flight-stop-takeoff", flight("GPS_NORMAL"))).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("flight-stop-auto-landing", flight("GPS_NORMAL"))).toEqual({ ok: true });
  });

  it("确认继续降落不由页面上的降落确认事实推断拦截", () => {
    const allowed = OperatorConsole.project({
      snapshot: snapshot([device({ connection: { ...device().connection, flightState: "flying", landingConfirmationNeeded: true } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" }, workspace: "flight",
    });
    const blocked = OperatorConsole.project({
      snapshot: snapshot([device({ connection: { ...device().connection, flightState: "flying", landingConfirmationNeeded: false } })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" }, workspace: "flight",
    });
    expect(OperatorConsole.evaluate("flight-confirm-landing", allowed)).toEqual({ ok: true });
    expect(OperatorConsole.evaluate("flight-confirm-landing", blocked)).toEqual({ ok: true });
  });
});

describe("航线操作台渲染契约", () => {
  it("图传启动提示明确显示 AirLink 和主相机是图传源前置", () => {
    const source = renderer();
    const consoleSource = operatorConsole();
    expect(source).toContain("图传可请求启动：手机中继、MSDK、AirLink 和主相机均已就绪");
    expect(consoleSource).toContain('if (airLink !== "connected")');
    expect(consoleSource).toContain('if (camera !== "connected")');
    expect(source).not.toContain("DJI 产品、AirLink 和主相机均已就绪");
  });

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

  it("设备页单独测量手机连接质量，不把结果混入 MSDK 状态刷新或控制操作", () => {
    const source = renderer();
    expect(page()).toContain('id="device-link-measure"');
    expect(source).toContain('bridge().invoke("device-link-measure", { deviceId })');
    expect(source).toContain("手机连接质量 [WebSocket PING/PONG]");
    expect(source).toContain("当前 ");
    expect(source).toContain("中位 ");
    expect(source).toContain("最大 ");
    expect(source).toContain("抖动 ");
  });

  it("手机连接测量只显示当前连接代次的结果，且渲染异常不会永久锁住测量按钮", () => {
    const source = renderer();
    expect(source).toContain("connectionEpochOf(inspected)");
    expect(source).toContain("probeForConnectionEpoch(inspectedDeviceId, inspectedEpoch)");
    expect(source).toContain("phoneLinkProbes.set(deviceId, Object.freeze({ connectionEpoch, report }))");
    expect(source).toContain("phoneLinkProbeInFlightDeviceId = deviceId;\n  try {\n    await render();");
    expect(source).toContain("phoneLinkProbeInFlightDeviceId = null;\n    try { await render(); }");
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

  it("将飞行工作区按图传、航线和直接飞行拆成保留独立状态的子页", () => {
    const pageSource = page();
    const rendererSource = renderer();
    for (const panel of ["stream", "mission", "direct-flight"]) {
      expect(pageSource).toContain(`data-flight-panel="${panel}"`);
      expect(pageSource).toContain(`data-flight-panel-view="${panel}"`);
    }
    for (const status of [
      "stream-relay", "stream-msdk", "stream-air-link", "stream-camera",
      "mission-relay", "mission-msdk", "mission-phase", "mission-phone-execution",
      "direct-relay", "direct-msdk", "direct-remote-controller", "direct-flight-controller",
      "direct-flight-state", "direct-motors", "direct-battery", "direct-landing-protection",
    ]) expect(pageSource).toContain(`data-flight-status="${status}"`);
    expect(rendererSource).toContain('flightPanel: FlightPanelName');
    expect(rendererSource).toContain('renderFlightPanelStatus');
    expect(rendererSource).toContain('renderFlightPanelVisibility');
  });

  it("飞行页右栏固定显示业务页签并让详情独立滚动", () => {
    const pageSource = page();
    expect(pageSource).toContain('class="flight-panel-tabs-shell"');
    expect(pageSource).toContain('class="flight-panel-content"');
    expect(pageSource).not.toContain('<h2>飞行操作</h2>');
    expect(pageSource).not.toContain('图传、航线和直接飞行分别操作。设备页保留全量状态；此处只显示当前操作有关的事实和回执。');
    expect(pageSource).toMatch(/\.flight-controls\s*\{\s*display:\s*grid;/);
    expect(pageSource).toMatch(/\.flight-panel-content\s*\{\s*min-height:\s*0;\s*overflow:\s*auto;/);
  });

  it("图传和起飞按钮紧跟可达性状态，不被观测详情挤出可视区", () => {
    const pageSource = page();
    const streamStart = pageSource.indexOf('data-action="stream-start"');
    const streamFrames = pageSource.indexOf("图像源帧事实");
    const streamDesktop = pageSource.indexOf("电脑媒体接收与播放事实");
    expect(streamStart).toBeGreaterThan(-1);
    expect(streamFrames).toBeGreaterThan(-1);
    expect(streamStart).toBeLessThan(streamFrames);
    expect(streamStart).toBeLessThan(streamDesktop);

    const takeoff = pageSource.indexOf('data-action="flight-takeoff"');
    const confirm = pageSource.indexOf('id="confirm"');
    const flightFacts = pageSource.indexOf("DJI 飞行事实");
    expect(takeoff).toBeGreaterThan(-1);
    expect(confirm).toBeGreaterThan(-1);
    expect(takeoff).toBeLessThan(flightFacts);
    expect(confirm).toBeLessThan(flightFacts);
    expect(pageSource).toMatch(/\.flight-panel-actions\s*\{[^}]*position:\s*sticky;/);
  });

  it("图传页和设备页逐项展示手机帧、桌面服务和播放器事实，不把它们合成一个图传状态", () => {
    const pageSource = page();
    const rendererSource = renderer();
    for (const status of [
      "stream-camera-frame-state", "stream-camera-frame-count", "stream-camera-frame-age",
      "stream-camera-frame-generation", "stream-camera-frame-format", "stream-msdk-push", "stream-msdk-resolution",
      "stream-msdk-fps", "stream-msdk-bitrate", "stream-msdk-rtt", "stream-msdk-packet-loss",
      "stream-msdk-packet-cache", "stream-msdk-runtime-error",
      "stream-rtmp-service", "stream-http-flv-service", "stream-rtmp-arrival",
      "stream-player-source", "stream-player-rendering",
    ]) expect(pageSource).toContain(`data-flight-status="${status}"`);
    expect(rendererSource).toContain("cameraFrameStatus");
    expect(rendererSource).toContain("desktopMediaServiceStatus");
    expect(rendererSource).toContain("cameraFrameStatusRows(connection)");
    expect(rendererSource).toContain("desktopMediaStatusRows(view, device, streamDeviceId)");
    expect(rendererSource).toContain("player.error !== null");
    expect(rendererSource).toContain("正在解码并出画");
    expect(rendererSource).toContain("已收到媒体数据，等待解码或出画");
    expect(rendererSource).toContain("等待媒体数据");
  });

  it("直接飞行页补齐独立的飞行动态事实与降落效果观察，不用按钮回执替代遥测", () => {
    const pageSource = page();
    const rendererSource = renderer();
    for (const status of [
      "direct-flight-mode", "direct-altitude", "direct-position", "direct-gps-signal",
      "direct-gps-satellites", "direct-battery-link", "direct-vision-sensor", "direct-vision-warning",
      "direct-vision-positioning", "direct-low-battery-rth", "direct-remaining-flight-time",
      "direct-takeoff-failure", "direct-motor-start-failure", "direct-takeoff-observation",
      "direct-landing-observation", "direct-return-home-observation",
    ]) expect(pageSource).toContain(`data-flight-status="${status}"`);
    expect(rendererSource).toContain("directFlightObservationStatus");
    expect(rendererSource).toContain('renderFlightStatus("direct-flight-mode"');
  });

  it("将航线事实按来源分开显示，不把上传、DJI 原始状态、里程碑和桌面工作流混为一谈", () => {
    const pageSource = page();
    const rendererSource = renderer();
    for (const heading of [
      "命令可达性", "DJI 设备事实", "任务对象与手机暂存", "上传至飞机",
      "DJI 航线执行观测", "DJI 可信里程碑", "桌面任务工作流",
    ]) expect(pageSource).toContain(`<h4>${heading}</h4>`);
    for (const status of [
      "mission-selected-route", "mission-phone-file", "mission-phone-execution", "mission-revision",
      "mission-device-generation", "mission-upload-progress", "mission-dji-execution-state",
      "mission-start-point-reached", "mission-route-execution-started",
    ]) expect(pageSource).toContain(`data-flight-status="${status}"`);
    expect(rendererSource).toContain("missionUploadProgressStatus");
    expect(rendererSource).toContain("missionDjiExecutionStatus");
    expect(rendererSource).toContain("missionMilestoneStatus");
  });

  it("为每个具体操作保留就地的 MSDK 回调结果", () => {
    const source = renderer();
    const pageSource = page();
    for (const action of [
      "mission-stage", "mission-upload", "mission-start", "mission-pause", "mission-resume", "mission-stop",
      "stream-start", "stream-stop",
      "flight-takeoff", "flight-land", "flight-confirm-landing", "flight-return-home", "flight-stop-takeoff", "flight-stop-auto-landing",
    ]) {
      expect(pageSource).toContain(`data-operation-feedback="${action}"`);
    }
    expect(source).toContain("operationFeedback");
    expect(source).toContain("feedbackByAction");
    expect(source).toContain("未调用 DJI MSDK");
    expect(source).toContain("DJI MSDK 回调");
  });

  it("飞行页三个子页都固定一块当前进度，操作中只看命令、效果和下一步", () => {
    const pageSource = page();
    const rendererSource = renderer();
    const contract = readFileSync(new URL("../src/production/operator-console/CONTRACT.md", import.meta.url), "utf8");
    for (const lane of ["stream", "mission", "flight"] as const) {
      expect(pageSource).toContain(`data-progress="${lane}"`);
    }
    expect(pageSource).toContain('data-progress-field="headline"');
    expect(pageSource).toContain('data-progress-field="command"');
    expect(pageSource).toContain('data-progress-field="effect"');
    expect(pageSource).toContain('data-progress-field="next"');
    expect(rendererSource).toContain("const renderLaneProgress");
    expect(contract).toContain("当前进度");
    expect(contract).toContain("命令、效果和下一步");
  });

  it("航线启动已受理时把命令接受和飞机进航线拆开，并只允许停止", () => {
    const view = OperatorConsole.project({
      snapshot: snapshot([device({
        mission: { phase: "starting", routeId: "route-1", lastResult: { operation: "start", ok: true, code: null }, startPointReached: false, routeExecutionStarted: false },
      })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(view.missionLabel).toBe("启动已受理，等待飞机实际进入航线");
    expect(view.progress.mission).toEqual({
      headline: "启动已受理，等待飞机实际进入航线",
      command: "DJI 已接受执行航线，不等于飞机已进入航线",
      effect: "尚未收到当前任务的航线实际开始执行",
      next: "等待进入航线。现在只能停止，不能再点执行",
    });
    expect(view.missionActions.start.enabled).toBe(false);
    expect(view.missionActions.stop.enabled).toBe(true);
  });

  it("航线启动未确认时禁止重发执行，只指出可以停止", () => {
    const view = OperatorConsole.project({
      snapshot: snapshot([device({
        mission: { phase: "starting", routeId: "route-1", lastResult: { operation: "start", ok: false, code: "WAYLINE_START_UNCONFIRMED" }, failureCode: "WAYLINE_START_UNCONFIRMED" },
      })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(view.progress.mission.command).toContain("结果未确认");
    expect(view.progress.mission.next).toContain("不得再点执行");
    expect(view.progress.mission.next).toContain("停止");
    expect(view.missionActions.start.enabled).toBe(false);
    expect(view.missionActions.stop.enabled).toBe(true);
  });

  it("图传命令成功但电脑未收到画面时，进度不得写成图传正常", () => {
    const view = OperatorConsole.project({
      snapshot: snapshot([device({
        stream: { phase: "streaming", lastOperation: "start", failureCode: null },
        video: { phase: "unavailable", selected: true },
      })], { selectedVideoDeviceId: "phone-1" }),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(view.streamLabel).toBe("手机已接命令，电脑还没收到画面");
    expect(view.progress.stream.headline).toBe("手机已接命令，电脑还没收到画面");
    expect(view.progress.stream.command).toBe("DJI 已接受启动图传，不等于电脑已收到画面");
    expect(view.progress.stream.effect).toBe("电脑还没有可播放画面");
    expect(view.progress.stream.next).toContain("停止图传");
    expect(view.progress.stream.headline).not.toContain("图传播放中");
  });

  it("直接飞行待确认时进度只要求看确认框，不把命令写成已经下发", () => {
    const view = OperatorConsole.project({
      snapshot: snapshot([device({
        pendingFlightAction: { deviceId: "phone-1", action: "takeoff", confirmationId: "c1", expiresAtMs: Date.now() + 60_000 },
      })]),
      selection: { missionDeviceId: "phone-1", streamDeviceId: "phone-1" },
      workspace: "flight",
    });
    expect(view.progress.flight.command).toContain("尚未调用 DJI");
    expect(view.progress.flight.next).toContain("确认");
    expect(view.progress.flight.headline).toContain("起飞");
  });

  it("渲染器合并重入的状态轮询与用户触发重绘，避免无限堆积异步 DOM 更新", () => {
    const source = renderer();

    expect(source).toContain('import { createRenderScheduler, RenderDeadlineExceededError } from "./render-scheduler.js";');
    expect(source).toContain("const renderOnce");
    expect(source).toContain("const renderScheduler = createRenderScheduler");
    expect(source).toContain("renderScheduler.request()");
    expect(source).toContain("awaitCurrentRender");
    expect(source).toContain("deadlineMs: 5_000");
  });
});
