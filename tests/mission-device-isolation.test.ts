import { describe, expect, it } from "vitest";
import { MissionControl } from "../src/modules/mission-control/index.js";
import { RelayMissionPhaseSnapshotReader } from "../src/modules/mission-control/relay-mission-phase-snapshot/index.js";

const phase = (deviceId: string) => ({ deviceId, fileName: "survey.kmz", missionRevision: 1, deviceGeneration: 0, sequence: 1, phase: "ROUTE_EXECUTION_STARTED" });
const terminal = (deviceId: string) => ({ deviceId, payload: { missionExecution: "FINISHED", missionFileName: "survey.kmz", missionRevision: 1, missionDeviceGeneration: 0 } });
const hostile = new Proxy({}, { get() { throw new Error("unreadable device"); } });

describe("mission device isolation", () => {
  it.each([null, hostile, { ...phase("bad"), sequence: 0 }])("keeps valid milestones around an invalid device entry", invalid => {
    expect(RelayMissionPhaseSnapshotReader.read({ missionPhases: [phase("a"), invalid, phase("b")] })).toEqual([phase("a"), phase("b")]);
  });

  it.each([null, hostile, { deviceId: "bad", payload: { missionExecution: "FAILED", missionFileName: "survey.kmz" } }])("keeps valid terminal states around an invalid device entry", invalid => {
    expect(RelayMissionPhaseSnapshotReader.readTerminalStates({ telemetry: [terminal("a"), invalid, terminal("b")] })).toMatchObject([
      { deviceId: "a", outcome: "completed" }, { deviceId: "b", outcome: "completed" },
    ]);
  });

  it.each([0, 1, 2, 3])("a malformed phone in slot %i does not suppress the other three missions", async badIndex => {
    const devices = Array.from({ length: 4 }, (_, index) => ({ deviceId: `phone-${index}`, sessionId: `session-${index}` }));
    let receive!: (snapshot: unknown) => void;
    const control = MissionControl.create({
      routeSource: { getMissionPayload: () => ({ ok: true, value: { routeId: "route", fileName: "survey.kmz", sizeBytes: 1, sha256: "a".repeat(64), bytes: new Uint8Array([1]) } }) },
      relay: {
        sendMission: async (deviceId, payload) => ({ deviceId, missionId: payload.missionId, status: "succeeded", detail: "test receipt" }),
        sendCommand: async deviceId => ({ deviceId, commandId: "command", status: "succeeded", detail: "test receipt" }),
        latestTelemetry: deviceId => ({ deviceId, payload: { sdkAvailability: "READY" }, capabilities: {} }),
        subscribe: listener => { receive = listener; return () => undefined; },
      },
    }, { createMissionId: deviceId => `mission-${deviceId}` });
    for (const { deviceId } of devices) {
      await control.stage(deviceId, "route"); await control.upload(deviceId); await control.start(deviceId);
    }
    receive({ devices, missionPhases: devices.map(({ deviceId }, index) => index === badIndex ? { ...phase(deviceId), sequence: 0 } : phase(deviceId)), telemetry: [] });
    devices.forEach(({ deviceId }, index) => expect(control.get(deviceId).phase).toBe(index === badIndex ? "starting" : "running"));
    receive({ devices, missionPhases: [], telemetry: devices.map(({ deviceId }, index) => index === badIndex ? { deviceId, payload: { missionExecution: "FINISHED" } } : terminal(deviceId)) });
    devices.forEach(({ deviceId }, index) => expect(control.get(deviceId).phase).toBe(index === badIndex ? "starting" : "completed"));
    control.dispose();
  });
});
