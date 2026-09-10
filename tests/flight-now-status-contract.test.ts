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
});
