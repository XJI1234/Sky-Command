import { expect, it } from "vitest";
import { PreflightCheck, type PreflightInput } from "../src/modules/mission-control/preflight-check/index.js";

const input: PreflightInput = Object.freeze({
  relayConnected: true,
  payload: Object.freeze({ sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true, isFlying: false, motorsOn: false, batteryPercent: 80 }),
  capabilities: Object.freeze({ waypointMission: true, waypointMissionSupport: "supported" }),
  missionPhase: "uploaded"
});

it("preflight check evaluates frequent UI refreshes within the responsiveness budget", () => {
  const startedAt = performance.now();
  let accepted = 0;
  for (let index = 0; index < 100_000; index += 1) if (PreflightCheck.evaluate(input).ok) accepted += 1;
  expect(accepted).toBe(100_000);
  expect(performance.now() - startedAt).toBeLessThan(500);
});
