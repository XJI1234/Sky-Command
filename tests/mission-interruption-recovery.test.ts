import { describe, expect, it } from "vitest";
import { MissionControl } from "../src/modules/mission-control/index.js";
import { MissionDispatcher, type CommandSendOutcome } from "../src/modules/mission-control/mission-dispatcher/index.js";
import { monitorRouteControl } from "../src/production/operator-console/flight-now-status/index.js";

const payload = { routeId: "route", fileName: "survey.kmz", sizeBytes: 1, sha256: "a".repeat(64), bytes: new Uint8Array([1]) };
const result = (deviceId: string): CommandSendOutcome => ({ deviceId, commandId: "command", status: "succeeded", detail: "accepted" });
const phase = (deviceId: string, missionRevision: number) => ({ deviceId, fileName: payload.fileName, missionRevision, deviceGeneration: 0, sequence: 1, phase: "ROUTE_EXECUTION_STARTED" });
const terminal = (deviceId: string, missionRevision: number, execution = "FAILED") => ({ deviceId, payload: { missionFileName: payload.fileName, missionRevision, missionDeviceGeneration: 0, missionExecution: execution } });
const fixture = () => {
  let receive!: (snapshot: unknown) => void;
  let pendingName = "";
  let settle!: (value: CommandSendOutcome) => void;
  const calls: Array<{ deviceId: string; name: string }> = [];
  const dependencies = {
    routeSource: { getMissionPayload: () => ({ ok: true as const, value: payload }) },
    relay: {
      sendMission: async (deviceId: string, value: { missionId: string }) => ({ deviceId, missionId: value.missionId, status: "succeeded" as const, detail: "accepted" }),
      sendCommand: async (deviceId: string, value: { name: string }) => {
        calls.push({ deviceId, name: value.name });
        return value.name === pendingName ? new Promise<CommandSendOutcome>(resolve => { settle = resolve; }) : result(deviceId);
      },
      latestTelemetry: (deviceId: string) => ({ deviceId, payload: { sdkRegistered: true }, capabilities: {} }),
      subscribe: (listener: (snapshot: unknown) => void) => { receive = listener; return () => undefined; },
    },
  };
  const options = { createMissionId: (deviceId: string) => `mission-${deviceId}` };
  const control = MissionControl.create(dependencies, options);
  return { control, dispatcher: MissionDispatcher.create(dependencies, options), receive: (snapshot: unknown) => receive(snapshot), calls,
    hold: (name: string) => { pendingName = name; }, settle: (value: CommandSendOutcome) => settle(value) };
};
const start = async (control: Pick<ReturnType<typeof MissionControl.create>, "stage" | "upload" | "start">, deviceId: string) => {
  expect((await control.stage(deviceId, "route")).ok).toBe(true);
  expect((await control.upload(deviceId)).ok).toBe(true);
  expect((await control.start(deviceId)).ok).toBe(true);
};

describe("mission interruption recovery", () => {
  it("does not bind a second same-file flight to the first flight's cached milestone in any of four lanes", async () => {
    const f = fixture();
    const devices = Array.from({ length: 4 }, (_, i) => ({ deviceId: `phone-${i}`, sessionId: `session-${i}` }));
    for (const { deviceId } of devices) await start(f.control, deviceId);
    f.receive({ devices, missionPhases: devices.map(d => phase(d.deviceId, 1)), telemetry: [] });
    f.receive({ devices, missionPhases: devices.map(d => phase(d.deviceId, 1)), telemetry: devices.map(d => terminal(d.deviceId, 1)) });
    for (const { deviceId } of devices) await start(f.control, deviceId);
    f.receive({ devices, missionPhases: devices.map(d => phase(d.deviceId, 1)), telemetry: devices.map(d => terminal(d.deviceId, 1)) });
    expect(f.control.list().map(lane => lane.phase)).toEqual(["starting", "starting", "starting", "starting"]);
    f.receive({ devices, missionPhases: devices.map(d => phase(d.deviceId, 2)), telemetry: [] });
    expect(f.control.list().map(lane => lane.phase)).toEqual(["running", "running", "running", "running"]);
    for (const [i, { deviceId }] of devices.entries()) {
      f.receive({ devices, missionPhases: [], telemetry: [terminal(deviceId, 2, i % 2 ? "FINISHED" : "FAILED")] });
      expect(f.control.get(deviceId).phase).toBe(i % 2 ? "completed" : "failed");
      expect(f.control.list().slice(i + 1).every(lane => lane.phase === "running")).toBe(true);
    }
    expect(f.calls).toHaveLength(16);
    f.control.dispose();
  });

  it("consumes cached milestones seen before a task and accepts terminal telemetry without a milestone array", async () => {
    const f = fixture();
    const devices = [{ deviceId: "phone", sessionId: "session" }];
    f.receive({ devices, missionPhases: [phase("phone", 1)] });
    await start(f.control, "phone");
    f.receive({ devices, missionPhases: [phase("phone", 1)] });
    expect(f.control.get("phone").phase).toBe("starting");
    f.receive({ devices, missionPhases: [phase("phone", 2)] });
    f.receive({ devices, telemetry: [terminal("phone", 2)] });
    expect(f.control.get("phone").phase).toBe("failed");
    f.control.dispose();
  });

  it.each(["failed", "completed"] as const)("settles %s while pause is waiting and isolates the late receipt from the next task", async outcome => {
    const f = fixture();
    const d = f.dispatcher;
    await start(d, "phone");
    d.recordExecutionStarted("phone", payload.fileName, 1, 0);
    f.hold("wayline.pause");
    const pause = d.pause("phone");
    expect(d.get("phone").phase).toBe("pausing");
    expect(d.recordExecutionTerminal("phone", payload.fileName, outcome, 1, 0)?.phase).toBe(outcome);
    await start(d, "phone");
    f.settle(result("phone"));
    await pause;
    expect(d.get("phone")).toMatchObject({ phase: "starting", routeExecutionStarted: false, lastResult: { operation: "start", ok: true } });
    expect(d.recordExecutionTerminal("phone", payload.fileName, outcome, 1, 0)).toBeNull();
    d.recordExecutionStarted("phone", payload.fileName, 2, 0);
    expect(d.recordExecutionTerminal("phone", payload.fileName, outcome, 1, 0)).toBeNull();
    expect(d.recordExecutionTerminal("phone", payload.fileName, outcome, 2, 0)?.phase).toBe(outcome);
    f.control.dispose();
  });

  it("keeps the replay watermark across release and resets it for a replaced phone session", async () => {
    const f = fixture();
    const devices = [{ deviceId: "phone", sessionId: "session-1" }];
    await start(f.control, "phone");
    f.receive({ devices, missionPhases: [phase("phone", 3)] });
    f.control.release("phone");
    await start(f.control, "phone");
    f.receive({ devices, missionPhases: [phase("phone", 3)] });
    expect(f.control.get("phone").phase).toBe("starting");
    f.control.release("phone");
    f.receive({ devices: [] });
    f.receive({ devices: [{ deviceId: "phone", sessionId: "session-2" }], missionPhases: [] });
    await start(f.control, "phone");
    f.receive({ devices: [{ deviceId: "phone", sessionId: "session-2" }], missionPhases: [phase("phone", 1)] });
    expect(f.control.get("phone").phase).toBe("running");
    f.control.dispose();
  });

  it.each(["paused", "resuming", "stopping"])("accepts an observed completion from %s", async state => {
    const f = fixture();
    const d = f.dispatcher;
    await start(d, "phone");
    d.recordExecutionStarted("phone", payload.fileName, 1, 0);
    await d.pause("phone");
    let pending: Promise<unknown> | undefined;
    if (state !== "paused") { f.hold(`wayline.${state === "resuming" ? "resume" : "stop"}`); pending = state === "resuming" ? d.resume("phone") : d.stop("phone"); }
    expect(d.recordExecutionTerminal("phone", payload.fileName, "completed", 1, 0)?.phase).toBe("completed");
    if (pending) { f.settle(result("phone")); await pending; }
    expect(d.get("phone").phase).toBe("completed");
    f.control.dispose();
  });

  it.each(["running", "pausing", "paused", "resuming", "stopping"])("returns the route picker after an observed terminal state instead of stale %s controls", missionPhase => {
    for (const missionExecution of ["FAILED", "FINISHED"]) expect(monitorRouteControl({ missionPhase, routeExecutionStarted: true, missionExecution, djiMissionState: missionExecution === "FAILED" ? "INTERRUPTED" : "FINISHED" })).toBe("choose");
    for (const terminalPhase of ["failed", "completed"]) expect(monitorRouteControl({ missionPhase: terminalPhase, routeExecutionStarted: true, missionExecution: "EXECUTING", djiMissionState: "EXECUTING" })).toBe("choose");
    expect(monitorRouteControl({ missionPhase: "starting", routeExecutionStarted: false, missionExecution: "FINISHED", djiMissionState: "FINISHED" })).toBe("await");
  });
});
