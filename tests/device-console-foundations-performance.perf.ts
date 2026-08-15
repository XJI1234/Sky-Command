import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { CapabilityGate, LinkChain, PairingController, type PairingRelayPort } from "../src/modules/device-console/index.js";

it("设备控制台基础决策和请求调度可在界面交互预算内处理一千台设备", async () => {
  const started = performance.now();
  const input = { relayConnected: true, sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, aircraftConnected: true, capabilities: { liveVideo: true, waypointMission: true, waypointMissionSupport: "supported" as const } };
  const port: PairingRelayPort = { sendCommand: async () => ({ status: "accepted", detail: "" }) };
  const pairing = PairingController.create({ port });
  await Promise.all(Array.from({ length: 1_000 }, (_, index) => {
    const deviceId = `phone-${index}`;
    LinkChain.evaluate({ deviceId, relayConnected: true, telemetry: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true } });
    CapabilityGate.evaluate({ operation: "waypoint-mission", ...input });
    return pairing.refresh(deviceId);
  }));
  expect(performance.now() - started).toBeLessThan(1_000);
});
