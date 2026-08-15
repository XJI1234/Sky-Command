import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { MissionControl } from "../src/modules/mission-control/index.js";

it("飞行任务控制模块可在界面刷新预算内处理频繁快照读取", () => {
  const control = MissionControl.create({ routeSource: { getMissionPayload: () => ({ ok: false as const, error: { code: "ROUTE_NOT_FOUND" } }) }, relay: { sendMission: async () => { throw new Error("unused"); }, sendCommand: async () => { throw new Error("unused"); }, latestTelemetry: () => null, subscribe: () => () => undefined } }, { createMissionId: () => "mission-1" });
  const started = performance.now();
  for (let index = 0; index < 10_000; index += 1) { control.get(`phone-${index}`); control.list(); }
  expect(performance.now() - started).toBeLessThan(250);
});
