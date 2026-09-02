import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

const summaryModule = new URL("../src/production/operator-console/device-fact-summary/index.ts", import.meta.url);

describe("设备事实摘要", () => {
  it("按稳定顺序格式化已确认设备、飞行和图传事实", async () => {
    expect(existsSync(summaryModule)).toBe(true);
    const { DeviceFactSummary } = await import(summaryModule.href);

    expect(DeviceFactSummary.format({
      aircraftModel: "Matrice 4T",
      remoteControllerModel: "DJI RC Plus",
      batteryPercent: 87,
      lowBatteryRthState: "IDLE",
      remainingFlightTimeSeconds: 1085,
      flightState: "grounded",
      motorsOn: false,
      flightMode: "N",
      pose: { latitude: 30.27415, longitude: 120.15515, altitudeMeters: 12.3 },
      live: { streaming: true, resolution: "1920x1080", fps: 29.97, videoBitrateKbps: 1802, rttMillis: 42 },
    })).toBe("机型 Matrice 4T · 遥控器 DJI RC Plus · 电量 87% · 低电量返航未触发 · 低电量返航预估 18分5秒 · 飞机在地面 · 电机未启动 · 飞行模式 N · 高度 12.3 m · 位置 30.27415, 120.15515 · DJI 图传已确认推流 · 1920x1080 · 30 fps · 1802 kbps · RTT 42 ms");
  });

  it("不以非法值、未知值或未运行图传伪造设备事实", async () => {
    expect(existsSync(summaryModule)).toBe(true);
    const { DeviceFactSummary } = await import(summaryModule.href);

    expect(DeviceFactSummary.format({
      aircraftModel: " ",
      remoteControllerModel: "RC\u0000 Plus",
      batteryPercent: 101,
      remainingFlightTimeSeconds: -1,
      flightState: "unknown",
      motorsOn: null,
      flightMode: "",
      pose: { latitude: 91, longitude: 120, altitudeMeters: Number.POSITIVE_INFINITY },
      live: { streaming: false, resolution: "1920x1080", fps: 30, videoBitrateKbps: 1802, rttMillis: 42 },
    })).toBe("电量尚未取得 · 飞行状态尚未确认 · DJI 图传已确认停止");
  });

  it("在飞行和图传运行时仅追加可安全表示的边界事实", async () => {
    const { DeviceFactSummary } = await import(summaryModule.href);

    expect(DeviceFactSummary.format({
      aircraftModel: 42,
      remoteControllerModel: "R".repeat(129),
      batteryPercent: 0,
      lowBatteryRthState: "unknown",
      remainingFlightTimeSeconds: 0,
      flightState: "flying",
      motorsOn: true,
      flightMode: "\u0000",
      pose: { altitudeMeters: -20_001, latitude: -90, longitude: -180 },
      live: { streaming: true, resolution: "", fps: 240.1, videoBitrateKbps: 100_001, rttMillis: 60_001 },
    })).toBe("电量 0% · 飞机在空中 · 电机已启动 · 位置 -90.00000, -180.00000 · DJI 图传已确认推流");
  });

  it("隔离无法读取的外部属性", async () => {
    const { DeviceFactSummary } = await import(summaryModule.href);
    const connection = Object.defineProperty({}, "batteryPercent", { get: () => { throw new Error("unreadable"); } });

    expect(DeviceFactSummary.format(connection)).toBe("电量尚未取得 · 飞行状态尚未确认");
  });

  it.each([
    ["COUNTING_DOWN", "低电量返航正在倒计时"],
    ["EXECUTED", "低电量返航已执行"],
    ["CANCELLED", "低电量返航已取消"],
  ])("保留 MSDK 返回的低电量返航状态 %s", async (lowBatteryRthState, expected) => {
    const { DeviceFactSummary } = await import(summaryModule.href);
    expect(DeviceFactSummary.format({
      batteryPercent: 80,
      lowBatteryRthState,
      flightState: "grounded",
    })).toContain(expected);
  });
});
