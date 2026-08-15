import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { MissionDispatcher } from "../src/modules/mission-control/mission-dispatcher/index.js";

it("mission dispatcher handles frequent invalid reads within the UI responsiveness budget", () => {
  const dispatcher = MissionDispatcher.create({
    routeSource: { getMissionPayload: () => ({ ok: false as const, error: { code: "ROUTE_NOT_FOUND" } }) },
    relay: { sendMission: async () => { throw new Error("not used"); }, sendCommand: async () => { throw new Error("not used"); }, latestTelemetry: () => null }
  }, { createMissionId: () => "mission-1" });
  const started = performance.now();
  for (let index = 0; index < 10_000; index += 1) {
    dispatcher.get(`phone-${index}`);
    dispatcher.list();
  }
  expect(performance.now() - started).toBeLessThan(250);
});
