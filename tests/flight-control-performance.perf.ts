import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { FlightControl } from "../src/modules/flight-control/index.js";

it("直接飞行确认模块可在界面刷新预算内处理频繁读取", () => {
  let time = 0;
  const control = FlightControl.create({ dispatcher: { check: () => ({ ok: true }), dispatch: async (deviceId, action) => ({ ok: true, code: "SUCCEEDED", deviceId, action }), isBusy: () => false } }, { now: () => time, confirmation: { ttlMs: 1_000, createConfirmationId: () => "confirm" } });
  control.request("phone-1", "takeoff");
  const started = performance.now();
  for (let index = 0; index < 10_000; index += 1) { time = index; control.get("phone-1"); }
  expect(performance.now() - started).toBeLessThan(250);
});
