import { describe, expect, it } from "vitest";
import {
  EMPTY_STATUS,
  commandReachStatus,
  directAlertStatus,
  directProcessStatus,
  hudAltitude,
  hudBattery,
  hudFlying,
  hudMotors,
  hudText,
  monitorAircraftStatus,
  monitorHoverCommand,
  monitorRouteControl,
  monitorDirectFlight,
  monitorStreamToggle,
  missionExecutionNowStatus,
  missionUploadOrActionStatus,
  streamErrorStatus,
  streamPaintStatus,
  streamPushStatus,
} from "../src/production/operator-console/flight-now-status/index.js";

describe("飞行页现在状态文案", () => {
  it("图传链路按断点合成一句，推流和出画分开写", () => {
    expect(commandReachStatus({ selected: false, relayOnline: false, msdkReady: false })).toBe("未选择手机");
    expect(commandReachStatus({ selected: true, relayOnline: false, msdkReady: true, airLinkConnected: true, cameraConnected: true })).toBe("中继未连接");
    expect(commandReachStatus({ selected: true, relayOnline: true, msdkReady: false, airLinkConnected: true, cameraConnected: true })).toBe("MSDK 未就绪");
    expect(commandReachStatus({ selected: true, relayOnline: true, msdkReady: true, airLinkConnected: false, cameraConnected: true })).toBe("AirLink 未连接");
    expect(commandReachStatus({ selected: true, relayOnline: true, msdkReady: true, airLinkConnected: true, cameraConnected: false })).toBe("主相机未连接");
    expect(commandReachStatus({ selected: true, relayOnline: true, msdkReady: true, airLinkConnected: true, cameraConnected: true })).toBe("可推流");
    expect(commandReachStatus({ selected: true, relayOnline: true, msdkReady: true })).toBe("可下发");
    expect(streamPushStatus({ selected: true, streaming: true, resolution: "1920x1080", fps: 30 })).toBe("推流中 · 1920x1080 · 30 fps");
    expect(streamPushStatus({ selected: true, streaming: false, resolution: null, fps: null })).toBe("未推流");
    expect(streamPaintStatus({ selected: true, painting: true })).toBe("正在出画");
    expect(streamPaintStatus({ selected: true, painting: false })).toBe("未出画");
    expect(streamErrorStatus({ selected: true, code: null, description: null })).toBe(EMPTY_STATUS);
  });

  it("航线第三行优先未完成上传，否则写动作", () => {
    expect(missionUploadOrActionStatus({ selected: true, uploadPercent: 42, action: "动作 1 · 进行中" })).toBe("上传中 42%");
    expect(missionUploadOrActionStatus({ selected: true, uploadPercent: 100, action: "动作 1 · 进行中" })).toBe("动作 1 · 进行中");
    expect(missionUploadOrActionStatus({ selected: true, uploadPercent: null, action: null })).toBe(EMPTY_STATUS);
    expect(missionExecutionNowStatus({
      selected: true,
      execution: "EXECUTING",
      waypoint: "航点 7",
      fileName: "默认",
    })).toBe("EXECUTING · 航点 7 · 默认");
  });

  it("直接飞行过程与急事行不编造，失败优先于视觉告警", () => {
    expect(directProcessStatus({
      selected: true, flying: "grounded", motorsOn: false, flightMode: "GPS_NORMAL",
      landingConfirmationNeeded: false, lowBatteryRthState: "IDLE",
    })).toBe("地面");
    expect(directProcessStatus({
      selected: true, flying: "grounded", motorsOn: true, flightMode: "GPS_NORMAL",
      landingConfirmationNeeded: false, lowBatteryRthState: "IDLE",
    })).toBe("起飞中");
    expect(directProcessStatus({
      selected: true, flying: "flying", motorsOn: true, flightMode: "AUTO_LANDING",
      landingConfirmationNeeded: false, lowBatteryRthState: "IDLE",
    })).toBe("降落中");
    expect(directProcessStatus({
      selected: true, flying: "flying", motorsOn: true, flightMode: "GO_HOME",
      landingConfirmationNeeded: false, lowBatteryRthState: "IDLE",
    })).toBe("返航中");
    expect(directAlertStatus({
      selected: true, takeoffFailure: "FAIL", motorStartFailure: "MOTOR", visionWarning: "WARNING",
    })).toBe("FAIL");
    expect(directAlertStatus({
      selected: true, takeoffFailure: null, motorStartFailure: null, visionWarning: null,
    })).toBe(EMPTY_STATUS);
    expect(hudFlying("flying")).toBe("飞行中");
    expect(hudMotors(false)).toBe("电机关");
    expect(hudBattery(87)).toBe("87%");
    expect(hudAltitude(120.54)).toBe("120.5 m");
    expect(hudText(null)).toBe(EMPTY_STATUS);
  });

  it("监控页按飞机自己的键归到一个外层状态，缺键时不写成地面", () => {
    const facts = {
      flying: null as string | null,
      motorsOn: null as boolean | null,
      flightMode: null as string | null,
      landingConfirmationNeeded: null as boolean | null,
      landingProtectionState: null as string | null,
      lowBatteryRthState: null as string | null,
      missionExecution: null as string | null,
      djiMissionState: null as string | null,
      waypointIndex: null as number | null,
      flightController: null as string | null,
    };
    expect(monitorAircraftStatus(facts)).toEqual({ label: "未确认", detail: "" });
    expect(monitorAircraftStatus({ ...facts, flightController: "unknown" })).toEqual({ label: "未确认", detail: "" });
    expect(monitorAircraftStatus({ ...facts, flightController: "disconnected", flying: "grounded", motorsOn: false })).toEqual({ label: "飞控未连接", detail: "" });
    expect(monitorAircraftStatus({ ...facts, flightController: "connected", flying: "grounded", motorsOn: null })).toEqual({ label: "未确认", detail: "" });
    expect(monitorAircraftStatus({ ...facts, flying: "flying", flightMode: "GO_HOME", landingConfirmationNeeded: true })).toEqual({ label: "继续降落", detail: "" });
    expect(monitorAircraftStatus({ ...facts, flying: "flying", flightMode: "CONFIRM_LANDING" })).toEqual({ label: "继续降落", detail: "" });
    expect(monitorAircraftStatus({ ...facts, flying: "flying", flightMode: "AUTO_LANDING", landingProtectionState: "NOT_SAFE_TO_LAND" })).toEqual({ label: "降落", detail: "当前不适合降落" });
    expect(monitorAircraftStatus({ ...facts, flying: "flying", flightMode: "GO_HOME" })).toEqual({ label: "返航", detail: "" });
    expect(monitorAircraftStatus({ ...facts, flying: "flying", flightMode: "GPS_NORMAL", lowBatteryRthState: "COUNTING_DOWN" })).toEqual({ label: "返航", detail: "" });
    expect(monitorAircraftStatus({ ...facts, flying: "flying", flightMode: "GPS_NORMAL", lowBatteryRthState: "EXECUTED" })).toEqual({ label: "悬停", detail: "GPS_NORMAL" });
    expect(monitorAircraftStatus({ ...facts, flying: "grounded", motorsOn: false, flightMode: "GO_HOME", lowBatteryRthState: "EXECUTED", landingConfirmationNeeded: true })).toEqual({ label: "地面", detail: "" });
    expect(monitorAircraftStatus({ ...facts, flying: "flying", flightMode: "GPS_NORMAL", missionExecution: "EXECUTING", waypointIndex: 3 })).toEqual({ label: "执行航线", detail: "航点 3" });
    expect(monitorAircraftStatus({ ...facts, flying: "flying", flightMode: "GPS_NORMAL", missionExecution: "EXECUTING", djiMissionState: "FINISHED" })).toEqual({ label: "悬停", detail: "GPS_NORMAL" });
    expect(monitorAircraftStatus({ ...facts, flying: "flying", missionExecution: "PAUSED", djiMissionState: "EXECUTING", waypointIndex: 4 })).toEqual({ label: "执行航线", detail: "航点 4" });
    expect(monitorAircraftStatus({ ...facts, flying: "flying", djiMissionState: "PAUSED", waypointIndex: 2 })).toEqual({ label: "执行航线", detail: "已暂停 · 航点 2" });
    expect(monitorAircraftStatus({ ...facts, flying: "grounded", motorsOn: false, missionExecution: "EXECUTING" })).toEqual({ label: "地面", detail: "" });
    expect(monitorAircraftStatus({ ...facts, flying: "grounded", motorsOn: true })).toEqual({ label: "起飞", detail: "" });
    expect(monitorAircraftStatus({ ...facts, flying: "flying", flightMode: "GPS_NORMAL" })).toEqual({ label: "悬停", detail: "GPS_NORMAL" });
    expect(monitorAircraftStatus({ ...facts, flying: "grounded", motorsOn: false })).toEqual({ label: "地面", detail: "" });
  });

  it("监控页悬停按飞控状态选择刹车命令，地面和已经悬停不再发送", () => {
    const facts = {
      flying: null as string | null,
      motorsOn: null as boolean | null,
      flightMode: null as string | null,
      landingConfirmationNeeded: null as boolean | null,
      landingProtectionState: null as string | null,
      lowBatteryRthState: null as string | null,
      missionExecution: null as string | null,
      djiMissionState: null as string | null,
      waypointIndex: null as number | null,
      flightController: null as string | null,
    };
    expect(monitorHoverCommand({ ...facts, flightController: "disconnected", flying: "flying" })).toEqual({ kind: "none", state: "failed", detail: "飞控未连接" });
    expect(monitorHoverCommand({ ...facts, flying: "grounded", motorsOn: false })).toEqual({ kind: "none", state: "done", detail: "飞机在地面" });
    expect(monitorHoverCommand({ ...facts, flying: "flying", flightMode: "GPS_NORMAL" })).toEqual({ kind: "none", state: "done", detail: "飞机已在悬停" });
    expect(monitorHoverCommand({ ...facts, flying: "flying", djiMissionState: "PAUSED" })).toMatchObject({ kind: "stop", detail: "正在停止航线，飞机悬停" });
    expect(monitorHoverCommand({ ...facts, flying: "flying", flightMode: "AUTO_TAKEOFF" })).toMatchObject({ kind: "flight", action: "stop-takeoff" });
    expect(monitorHoverCommand({ ...facts, flying: "grounded", motorsOn: true })).toMatchObject({ kind: "flight", action: "stop-takeoff" });
    expect(monitorHoverCommand({ ...facts, flying: "flying", flightMode: "AUTO_LANDING" })).toMatchObject({ kind: "flight", action: "stop-auto-landing" });
    expect(monitorHoverCommand({ ...facts, flying: "flying", flightMode: "CONFIRM_LANDING" })).toMatchObject({ kind: "flight", action: "stop-auto-landing" });
    expect(monitorHoverCommand({ ...facts, flying: "flying", landingConfirmationNeeded: true })).toMatchObject({ kind: "flight", action: "stop-auto-landing" });
    expect(monitorHoverCommand({ ...facts, flying: "flying", flightMode: "GO_HOME" })).toMatchObject({ kind: "flight", action: "stop-go-home" });
    expect(monitorHoverCommand({ ...facts, flying: "flying", flightMode: "GPS_NORMAL", lowBatteryRthState: "COUNTING_DOWN" })).toMatchObject({ kind: "flight", action: "stop-go-home" });
    expect(monitorHoverCommand({ ...facts, flying: "flying", missionExecution: "STARTING" })).toMatchObject({ kind: "stop" });
    expect(monitorHoverCommand({ ...facts, flying: "flying", djiMissionState: "ENTER_WAYLINE" })).toMatchObject({ kind: "stop" });
    expect(monitorHoverCommand({ ...facts, flying: "flying", djiMissionState: "EXECUTING" })).toMatchObject({ kind: "stop" });
    expect(monitorHoverCommand(facts)).toEqual({ kind: "none", state: "failed", detail: "飞控状态未确认，未发送悬停" });
  });

  it("监控页航线键按飞机是否真的进入航线在选择、暂停和继续之间切换", () => {
    const idle = {
      missionPhase: null as string | null,
      routeExecutionStarted: false,
      missionExecution: null as string | null,
      djiMissionState: null as string | null,
    };
    expect(monitorRouteControl(idle)).toBe("choose");
    expect(monitorRouteControl({ ...idle, missionPhase: "starting" })).toBe("await");
    expect(monitorRouteControl({ ...idle, missionExecution: "STARTING" })).toBe("await");
    expect(monitorRouteControl({ ...idle, missionPhase: "running" })).toBe("pause");
    expect(monitorRouteControl({ ...idle, routeExecutionStarted: true })).toBe("choose");
    expect(monitorRouteControl({ ...idle, missionPhase: "starting", routeExecutionStarted: true })).toBe("pause");
    expect(monitorRouteControl({ ...idle, missionPhase: "starting", djiMissionState: "EXECUTING" })).toBe("pause");
    expect(monitorRouteControl({ ...idle, djiMissionState: "EXECUTING" })).toBe("pause");
    expect(monitorRouteControl({ ...idle, missionPhase: "pausing" })).toBe("pause");
    expect(monitorRouteControl({ ...idle, missionPhase: "pausing", djiMissionState: "PAUSED" })).toBe("resume");
    expect(monitorRouteControl({ ...idle, missionPhase: "paused" })).toBe("resume");
    expect(monitorRouteControl({ ...idle, djiMissionState: "PAUSED" })).toBe("resume");
    expect(monitorRouteControl({ ...idle, missionPhase: "running", djiMissionState: "PAUSED" })).toBe("resume");
    expect(monitorRouteControl({ ...idle, missionPhase: "resuming" })).toBe("resume");
    expect(monitorRouteControl({ ...idle, missionPhase: "resuming", djiMissionState: "EXECUTING" })).toBe("pause");
    expect(monitorRouteControl({ ...idle, missionPhase: "stopping" })).toBe("stopping");
    expect(monitorRouteControl({ ...idle, missionPhase: "idle", routeExecutionStarted: true })).toBe("choose");
    expect(monitorRouteControl({ ...idle, missionPhase: "failed" })).toBe("choose");
  });

  it("监控页返航和降落键跟着飞控状态切换", () => {
    const idle = {
      flying: null as string | null,
      motorsOn: null as boolean | null,
      flightMode: null as string | null,
      landingConfirmationNeeded: null as boolean | null,
      lowBatteryRthState: null as string | null,
    };
    expect(monitorDirectFlight(idle)).toMatchObject({ home: { label: "返航", mode: "return-home" }, land: { label: "降落", mode: "land" } });
    expect(monitorDirectFlight({ ...idle, flying: "flying", flightMode: "GPS_NORMAL" })).toMatchObject({ home: { mode: "return-home" }, land: { mode: "land" } });
    expect(monitorDirectFlight({ ...idle, flying: "flying", flightMode: "GO_HOME" })).toMatchObject({ home: { label: "停止返航", mode: "stop-go-home" }, land: { mode: "land" } });
    expect(monitorDirectFlight({ ...idle, flying: "flying", flightMode: "AUTO_RETURN" })).toMatchObject({ home: { mode: "stop-go-home" }, land: { mode: "land" } });
    expect(monitorDirectFlight({ ...idle, flying: "flying", flightMode: "GPS_NORMAL", lowBatteryRthState: "COUNTING_DOWN" })).toMatchObject({ home: { mode: "stop-go-home" }, land: { mode: "land" } });
    expect(monitorDirectFlight({ ...idle, flying: "flying", flightMode: "GPS_NORMAL", lowBatteryRthState: "EXECUTED" })).toMatchObject({ home: { mode: "return-home" }, land: { mode: "land" } });
    expect(monitorDirectFlight({ ...idle, flying: "flying", flightMode: "AUTO_LANDING" })).toMatchObject({ home: { mode: "return-home" }, land: { label: "降落", mode: "land" } });
    expect(monitorDirectFlight({ ...idle, flying: "flying", landingConfirmationNeeded: true })).toMatchObject({ home: { mode: "return-home" }, land: { label: "确认降落", mode: "confirm-landing" } });
    expect(monitorDirectFlight({ ...idle, flying: "flying", flightMode: "CONFIRM_LANDING" })).toMatchObject({ land: { mode: "confirm-landing" } });
    expect(monitorDirectFlight({ ...idle, flying: "flying", flightMode: "GO_HOME", landingConfirmationNeeded: true })).toMatchObject({ home: { mode: "return-home" }, land: { mode: "confirm-landing" } });
    expect(monitorDirectFlight({ ...idle, flying: "grounded", motorsOn: false, flightMode: "GO_HOME", landingConfirmationNeeded: true })).toMatchObject({ home: { mode: "return-home" }, land: { mode: "land" } });
  });

  it("监控页图传键在启动和停止之间切换，未就绪时不发启动", () => {
    const idle = {
      present: true,
      streamPhase: null as string | null,
      videoPhase: null as string | null,
      failureCode: null as string | null,
      sdkReady: true,
      airLink: "connected" as string | null,
      camera: "connected" as string | null,
      playing: false,
      phoneStreaming: false,
      releasePhoneHold: false,
    };
    expect(monitorStreamToggle({ ...idle, present: false })).toMatchObject({ label: "启动图传", enabled: false, mode: "idle" });
    expect(monitorStreamToggle(idle)).toMatchObject({ label: "启动图传", enabled: true, mode: "start" });
    expect(monitorStreamToggle({ ...idle, sdkReady: false })).toMatchObject({ enabled: false, mode: "idle", title: "手机尚未就绪，无法启动图传" });
    expect(monitorStreamToggle({ ...idle, streamPhase: "streaming" })).toMatchObject({ label: "停止图传", enabled: true, mode: "stop" });
    expect(monitorStreamToggle({ ...idle, videoPhase: "ready" })).toMatchObject({ label: "停止图传", mode: "stop" });
    expect(monitorStreamToggle({ ...idle, streamPhase: "stopping" })).toMatchObject({ label: "停止图传", enabled: true, mode: "stop" });
    expect(monitorStreamToggle({ ...idle, streamPhase: "failed" })).toMatchObject({ label: "启动图传", enabled: true, mode: "start" });
    expect(monitorStreamToggle({ ...idle, streamPhase: "failed", failureCode: "SOURCE_UNAVAILABLE" })).toMatchObject({ label: "启动图传", enabled: true, mode: "start" });
    expect(monitorStreamToggle({ ...idle, streamPhase: "failed", failureCode: "SOURCE_UNAVAILABLE", playing: true })).toMatchObject({ label: "启动图传", mode: "start" });
    expect(monitorStreamToggle({ ...idle, playing: true })).toMatchObject({ label: "停止图传", mode: "stop" });
    expect(monitorStreamToggle({ ...idle, phoneStreaming: true })).toMatchObject({ label: "停止图传", enabled: true, mode: "stop" });
    expect(monitorStreamToggle({ ...idle, phoneStreaming: true, releasePhoneHold: true })).toMatchObject({ label: "启动图传", enabled: true, mode: "start" });
    expect(monitorStreamToggle({ ...idle, streamPhase: "stopping", phoneStreaming: true })).toMatchObject({ label: "停止图传", enabled: true, mode: "stop" });
  });
});
