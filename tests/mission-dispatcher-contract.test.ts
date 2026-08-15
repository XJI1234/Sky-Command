import { describe, expect, it } from "vitest";
import { MissionDispatcher } from "../src/modules/mission-control/mission-dispatcher/index.js";

const routePayload = () => ({
  routeId: "route-1",
  fileName: "survey.kmz",
  sizeBytes: 3,
  sha256: "a".repeat(64),
  bytes: new Uint8Array([1, 2, 3])
});

const makeFixture = () => {
  const commands: Array<{ deviceId: string; name: string; fields: unknown }> = [];
  const missions: unknown[] = [];
  let commandStatus: "succeeded" | "rejected" = "succeeded";
  let telemetry: unknown = { deviceId: "phone-1", payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true, isFlying: false, motorsOn: false, batteryPercent: 80 }, capabilities: { waypointMission: true, waypointMissionSupport: "supported" } };
  const dispatcher = MissionDispatcher.create({
    routeSource: { getMissionPayload: () => ({ ok: true as const, value: routePayload() }) },
    relay: {
      sendMission: async (_deviceId: string, payload: unknown) => { missions.push(payload); return { deviceId: "phone-1", missionId: "mission-1", status: "succeeded" as const, detail: "accepted" }; },
      sendCommand: async (deviceId: string, request: { name: string; fields: unknown }) => { commands.push({ deviceId, ...request }); return { deviceId, commandId: "command-1", status: commandStatus, detail: "result" }; },
      latestTelemetry: () => telemetry as never
    }
  }, { createMissionId: () => "mission-1" });
  return { dispatcher, commands, missions, setCommandStatus: (status: "succeeded" | "rejected") => { commandStatus = status; }, setTelemetry: (value: unknown) => { telemetry = value; } };
};

const stage = async (dispatcher: ReturnType<typeof MissionDispatcher.create>) => {
  const result = await dispatcher.stage("phone-1", "route-1");
  expect(result.ok).toBe(true);
};

describe("mission dispatcher contract", () => {
  it("stages a route on one phone without treating staging as aircraft upload", async () => {
    const sent: unknown[] = [];
    const sourceBytes = new Uint8Array([1, 2, 3]);
    const dispatcher = MissionDispatcher.create({
      routeSource: { getMissionPayload: () => ({ ok: true as const, value: { ...routePayload(), bytes: sourceBytes } }) },
      relay: {
        sendMission: async (_deviceId: string, payload: unknown) => { sent.push(payload); return { deviceId: "phone-1", missionId: "mission-1", status: "succeeded", detail: "accepted" }; },
        sendCommand: async () => ({ deviceId: "phone-1", commandId: "command-1", status: "succeeded", detail: "ok" }),
        latestTelemetry: () => null
      }
    }, { createMissionId: () => "mission-1" });

    const result = await dispatcher.stage("phone-1", "route-1");

    expect(result).toMatchObject({ ok: true, operation: "stage", state: { deviceId: "phone-1", routeId: "route-1", missionId: "mission-1", phase: "staged", failureCode: null } });
    expect(dispatcher.get("phone-1")).toMatchObject({ phase: "staged" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ missionId: "mission-1", fileName: "survey.kmz", size: 3, sha256: "a".repeat(64), bytes: new Uint8Array([1, 2, 3]) });
    expect((sent[0] as { bytes: Uint8Array }).bytes).not.toBe(sourceBytes);
  });

  it("uploads only a staged mission and sends the exact confirmation command", async () => {
    const fixture = makeFixture();
    await stage(fixture.dispatcher);

    const result = await fixture.dispatcher.upload("phone-1");

    expect(result).toMatchObject({ ok: true, operation: "upload", state: { phase: "uploaded" } });
    expect(fixture.commands).toEqual([{ deviceId: "phone-1", name: "wayline.upload", fields: { confirm: true } }]);
    expect(fixture.dispatcher.get("phone-1").lastResult).toEqual({ operation: "upload", ok: true, code: null });
  });

  it("blocks start before sending when telemetry preflight is unsafe", async () => {
    const fixture = makeFixture();
    await stage(fixture.dispatcher);
    await fixture.dispatcher.upload("phone-1");
    fixture.setTelemetry(null);

    const result = await fixture.dispatcher.start("phone-1");

    expect(result).toMatchObject({ ok: false, operation: "start", code: "PREFLIGHT_BLOCKED" });
    expect(fixture.commands).toHaveLength(1);
    expect(fixture.dispatcher.get("phone-1").phase).toBe("uploaded");
    expect(fixture.dispatcher.get("phone-1").lastResult).toEqual({ operation: "start", ok: false, code: "PREFLIGHT_BLOCKED" });
  });

  it("starts after preflight passes and keeps command confirmation explicit", async () => {
    const fixture = makeFixture();
    await stage(fixture.dispatcher);
    await fixture.dispatcher.upload("phone-1");

    const result = await fixture.dispatcher.start("phone-1");

    expect(result).toMatchObject({ ok: true, operation: "start", state: { phase: "starting" } });
    expect(fixture.commands.at(-1)).toEqual({ deviceId: "phone-1", name: "wayline.start", fields: { confirm: true } });
    expect(fixture.dispatcher.recordExecutionStarted(" ", routePayload().fileName)).toBeNull();
    expect(fixture.dispatcher.recordExecutionStarted("missing-phone", routePayload().fileName)).toBeNull();
    expect(fixture.dispatcher.recordExecutionStarted("phone-1", "../route.kmz")).toBeNull();
    expect(fixture.dispatcher.recordExecutionStarted("phone-1", "other.kmz")).toBeNull();
    expect(fixture.dispatcher.recordExecutionStarted("phone-1", routePayload().fileName)).toMatchObject({ phase: "running" });
    expect(fixture.dispatcher.recordExecutionStarted("phone-1", routePayload().fileName)).toBeNull();
  });

  it("accepts a matching DJI terminal fact without inventing a running phase", async () => {
    const fixture = makeFixture();
    await stage(fixture.dispatcher);
    await fixture.dispatcher.upload("phone-1");
    await fixture.dispatcher.start("phone-1");

    expect(fixture.dispatcher.recordExecutionTerminal("phone-1", routePayload().fileName, "completed")).toMatchObject({ phase: "completed" });
    expect(fixture.dispatcher.get("phone-1")).toMatchObject({ phase: "completed", lastResult: { operation: "start", ok: true, code: null } });
    expect(fixture.dispatcher.recordExecutionTerminal("phone-1", routePayload().fileName, "completed")).toBeNull();

    const failed = makeFixture();
    await stage(failed.dispatcher);
    await failed.dispatcher.upload("phone-1");
    await failed.dispatcher.start("phone-1");
    expect(failed.dispatcher.recordExecutionTerminal("phone-1", "other.kmz", "failed")).toBeNull();
    expect(failed.dispatcher.get("phone-1").phase).toBe("starting");
    expect(failed.dispatcher.recordExecutionTerminal("phone-1", routePayload().fileName, "failed")).toMatchObject({ phase: "failed", failureCode: "MISSION_EXECUTION_FAILED" });
    expect(failed.dispatcher.recordExecutionTerminal("phone-1", routePayload().fileName, "failed")).toBeNull();
    expect(failed.dispatcher.recordExecutionTerminal("phone-1", "../survey.kmz", "completed")).toBeNull();
    expect(failed.dispatcher.recordExecutionTerminal("phone-1", routePayload().fileName, "unknown" as never)).toBeNull();
  });

  it("supports pause, resume, and stop as independent confirmed operations", async () => {
    const fixture = makeFixture();
    await stage(fixture.dispatcher);
    await fixture.dispatcher.upload("phone-1");
    await fixture.dispatcher.start("phone-1");
    fixture.dispatcher.recordExecutionStarted("phone-1", routePayload().fileName);

    expect((await fixture.dispatcher.pause("phone-1"))).toMatchObject({ ok: true, state: { phase: "paused" } });
    expect((await fixture.dispatcher.resume("phone-1"))).toMatchObject({ ok: true, state: { phase: "running" } });
    expect((await fixture.dispatcher.stop("phone-1"))).toMatchObject({ ok: true, state: { phase: "idle" } });
    expect(fixture.commands.map((command) => command.name)).toEqual(["wayline.upload", "wayline.start", "wayline.pause", "wayline.resume", "wayline.stop"]);
  });

  it("在手机端尚未确认时保留暂停和继续的请求中状态", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const dispatcher = MissionDispatcher.create({
      routeSource: { getMissionPayload: () => ({ ok: true as const, value: routePayload() }) },
      relay: {
        sendMission: async (_deviceId, payload) => ({ deviceId: "phone-1", missionId: payload.missionId, status: "succeeded" as const, detail: "accepted" }),
        sendCommand: async () => new Promise((resolve) => { resolvers.push(resolve); }),
        latestTelemetry: () => ({ deviceId: "phone-1", payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true, isFlying: false, motorsOn: false, batteryPercent: 80 }, capabilities: { waypointMission: true, waypointMissionSupport: "supported" } })
      }
    }, { createMissionId: () => "mission-1" });
    await stage(dispatcher);
    const upload = dispatcher.upload("phone-1"); resolvers.shift()!({ status: "succeeded" }); await upload;
    const start = dispatcher.start("phone-1"); resolvers.shift()!({ status: "succeeded" }); await start;
    dispatcher.recordExecutionStarted("phone-1", routePayload().fileName);

    const pause = dispatcher.pause("phone-1");
    expect(dispatcher.get("phone-1").phase).toBe("pausing");
    resolvers.shift()!({ status: "succeeded" });
    await expect(pause).resolves.toMatchObject({ ok: true, state: { phase: "paused" } });

    const resume = dispatcher.resume("phone-1");
    expect(dispatcher.get("phone-1").phase).toBe("resuming");
    resolvers.shift()!({ status: "succeeded" });
    await expect(resume).resolves.toMatchObject({ ok: true, state: { phase: "running" } });
  });

  it("moves the lane to failed when an aircraft command is rejected", async () => {
    const fixture = makeFixture();
    await stage(fixture.dispatcher);
    fixture.setCommandStatus("rejected");

    const result = await fixture.dispatcher.upload("phone-1");

    expect(result).toMatchObject({ ok: false, operation: "upload", code: "WAYLINE_UPLOAD_FAILED", state: { phase: "failed", failureCode: "WAYLINE_UPLOAD_FAILED" } });
  });

  it("does not create a lane when the route source rejects the payload", async () => {
    const dispatcher = MissionDispatcher.create({
      routeSource: { getMissionPayload: () => ({ ok: false as const, error: { code: "ROUTE_NOT_UPLOADABLE" } }) },
      relay: { sendMission: async () => { throw new Error("must not send"); }, sendCommand: async () => { throw new Error("must not send"); }, latestTelemetry: () => null }
    }, { createMissionId: () => "mission-1" });

    const result = await dispatcher.stage("phone-1", "route-1");

    expect(result).toMatchObject({ ok: false, code: "ROUTE_UNAVAILABLE", state: null });
    expect(dispatcher.list()).toEqual([]);

    const malformed = MissionDispatcher.create({
      routeSource: { getMissionPayload: () => ({ ok: false, value: routePayload() } as never) },
      relay: { sendMission: async () => { throw new Error("must not send"); }, sendCommand: async () => { throw new Error("must not send"); }, latestTelemetry: () => null }
    }, { createMissionId: () => "mission-1" });
    expect(await malformed.stage("phone-1", "route-1")).toMatchObject({ ok: false, code: "ROUTE_UNAVAILABLE" });
    const nullRoute = MissionDispatcher.create({
      routeSource: { getMissionPayload: () => null as never },
      relay: { sendMission: async () => { throw new Error("must not send"); }, sendCommand: async () => { throw new Error("must not send"); }, latestTelemetry: () => null }
    }, { createMissionId: () => "mission-1" });
    expect(await nullRoute.stage("phone-1", "route-1")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });

    const malformedBytes = MissionDispatcher.create({
      routeSource: { getMissionPayload: () => ({ ok: true as const, value: { ...routePayload(), bytes: [] as never } }) },
      relay: { sendMission: async () => { throw new Error("must not send"); }, sendCommand: async () => { throw new Error("must not send"); }, latestTelemetry: () => null }
    }, { createMissionId: () => "mission-1" });
    expect(await malformedBytes.stage("phone-1", "route-1")).toMatchObject({ ok: false, code: "ROUTE_UNAVAILABLE" });
  });

  it("rejects malformed IDs, missing lanes, and illegal phases without outbound effects", async () => {
    const fixture = makeFixture();
    expect(await fixture.dispatcher.stage(null as never, "route-1")).toMatchObject({ ok: false, code: "INVALID_DEVICE_ID", state: null });
    expect(await fixture.dispatcher.stage("phone-1", "   ")).toMatchObject({ ok: false, code: "INVALID_ROUTE_ID", state: null });
    expect(await fixture.dispatcher.upload("phone-1")).toMatchObject({ ok: false, code: "ILLEGAL_PHASE", state: null });
    expect(await fixture.dispatcher.start("phone-1")).toMatchObject({ ok: false, code: "ILLEGAL_PHASE", state: null });
    expect(await fixture.dispatcher.upload(null as never)).toMatchObject({ ok: false, code: "INVALID_DEVICE_ID", state: null });
    expect(fixture.dispatcher.get(null as never).deviceId).toBe("");
    expect(fixture.dispatcher.get(7 as never).deviceId).toBe("");
    expect(fixture.dispatcher.get(" ").deviceId).toBe(" ");
    await stage(fixture.dispatcher);
    expect(await fixture.dispatcher.stage("phone-1", "route-2")).toMatchObject({ ok: false, code: "ILLEGAL_PHASE" });
    expect(await fixture.dispatcher.pause("phone-1")).toMatchObject({ ok: false, code: "ILLEGAL_PHASE" });
    expect(fixture.dispatcher.get("phone-1").lastResult).toEqual({ operation: "pause", ok: false, code: "ILLEGAL_PHASE" });
    expect(() => fixture.dispatcher.get("missing-phone")).not.toThrow();
    expect(fixture.commands).toEqual([]);
  });

  it("contains route and mission-id provider exceptions and rejects malformed IDs", async () => {
    const routeThrowing = MissionDispatcher.create({
      routeSource: { getMissionPayload: () => { throw new Error("route fault"); } },
      relay: { sendMission: async () => { throw new Error("must not send"); }, sendCommand: async () => { throw new Error("must not send"); }, latestTelemetry: () => null }
    }, { createMissionId: () => "mission-1" });
    expect(await routeThrowing.stage("phone-1", "route-1")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });

    const idThrowing = MissionDispatcher.create({
      routeSource: { getMissionPayload: () => ({ ok: true as const, value: routePayload() }) },
      relay: { sendMission: async () => { throw new Error("must not send"); }, sendCommand: async () => { throw new Error("must not send"); }, latestTelemetry: () => null }
    }, { createMissionId: () => { throw new Error("id fault"); } });
    expect(await idThrowing.stage("phone-1", "route-1")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE" });

    const invalidId = MissionDispatcher.create({
      routeSource: { getMissionPayload: () => ({ ok: true as const, value: routePayload() }) },
      relay: { sendMission: async () => { throw new Error("must not send"); }, sendCommand: async () => { throw new Error("must not send"); }, latestTelemetry: () => null }
    }, { createMissionId: () => "   " });
    expect(await invalidId.stage("phone-1", "route-1")).toMatchObject({ ok: false, code: "MISSION_ID_UNAVAILABLE" });
  });

  it("contains relay send failures and reports a disconnected preflight blocker", async () => {
    const transferFailure = MissionDispatcher.create({
      routeSource: { getMissionPayload: () => ({ ok: true as const, value: routePayload() }) },
      relay: { sendMission: async () => { throw new Error("send fault"); }, sendCommand: async () => { throw new Error("must not send"); }, latestTelemetry: () => null }
    }, { createMissionId: () => "mission-1" });
    expect(await transferFailure.stage("phone-1", "route-1")).toMatchObject({ ok: false, code: "MISSION_TRANSFER_FAILED", state: { phase: "failed" } });

    const fixture = makeFixture();
    await stage(fixture.dispatcher);
    await fixture.dispatcher.upload("phone-1");
    fixture.setTelemetry(null);
    const result = await fixture.dispatcher.start("phone-1");
    expect(result).toMatchObject({ ok: false, code: "PREFLIGHT_BLOCKED", blockers: expect.arrayContaining([expect.objectContaining({ code: "RELAY_DISCONNECTED" })]) });
    expect(fixture.dispatcher.get("phone-1").lastResult).toEqual({ operation: "start", ok: false, code: "PREFLIGHT_BLOCKED" });
  });

  it("rejects a second operation on the same phone while the transfer is pending", async () => {
    let resolveTransfer!: (value: { deviceId: string; missionId: string; status: "succeeded"; detail: string }) => void;
    const dispatcher = MissionDispatcher.create({
      routeSource: { getMissionPayload: () => ({ ok: true as const, value: routePayload() }) },
      relay: {
        sendMission: () => new Promise((resolve) => { resolveTransfer = resolve; }),
        sendCommand: async () => ({ deviceId: "phone-1", commandId: "command-1", status: "succeeded" as const, detail: "ok" }),
        latestTelemetry: () => null
      }
    }, { createMissionId: () => "mission-1" });

    const first = dispatcher.stage("phone-1", "route-1");
    expect(dispatcher.get("phone-1").lastResult).toBeNull();
    const second = await dispatcher.stage("phone-1", "route-2");
    resolveTransfer({ deviceId: "phone-1", missionId: "mission-1", status: "succeeded", detail: "accepted" });

    expect(second).toMatchObject({ ok: false, code: "OPERATION_IN_PROGRESS" });
    await expect(first).resolves.toMatchObject({ ok: true, state: { routeId: "route-1", phase: "staged" } });
  });

  it("keeps device lanes isolated while they stage concurrently", async () => {
    const sentDevices: string[] = [];
    const dispatcher = MissionDispatcher.create({
      routeSource: { getMissionPayload: (routeId: string) => ({ ok: true as const, value: { ...routePayload(), routeId } }) },
      relay: {
        sendMission: async (deviceId: string, payload: { missionId: string }) => { sentDevices.push(deviceId); return { deviceId, missionId: payload.missionId, status: "succeeded" as const, detail: "accepted" }; },
        sendCommand: async () => ({ deviceId: "phone-1", commandId: "command-1", status: "succeeded" as const, detail: "ok" }),
        latestTelemetry: () => null
      }
    }, { createMissionId: (deviceId) => `mission-${deviceId}` });

    const [one, two] = await Promise.all([dispatcher.stage("phone-1", "route-1"), dispatcher.stage("phone-2", "route-2")]);

    expect(one).toMatchObject({ ok: true, state: { missionId: "mission-phone-1", routeId: "route-1" } });
    expect(two).toMatchObject({ ok: true, state: { missionId: "mission-phone-2", routeId: "route-2" } });
    expect(sentDevices.sort()).toEqual(["phone-1", "phone-2"]);
    expect(dispatcher.list().map((lane) => lane.deviceId)).toEqual(["phone-1", "phone-2"]);
  });

  it("contains hostile dependency results and retains a failed but inspectable lane", async () => {
    const dispatcher = MissionDispatcher.create({
      routeSource: { getMissionPayload: () => ({ ok: true as const, value: routePayload() }) },
      relay: {
        sendMission: async () => new Proxy({}, { get() { throw new Error("untrusted result"); } }) as never,
        sendCommand: async () => ({ deviceId: "phone-1", commandId: "command-1", status: "succeeded" as const, detail: "ok" }),
        latestTelemetry: () => null
      }
    }, { createMissionId: () => "mission-1" });

    await expect(dispatcher.stage("phone-1", "route-1")).resolves.toMatchObject({ ok: false, code: "MISSION_TRANSFER_FAILED", state: { phase: "failed" } });
    expect(dispatcher.get("phone-1").phase).toBe("failed");

    const primitiveResult = MissionDispatcher.create({
      routeSource: { getMissionPayload: () => ({ ok: true as const, value: routePayload() }) },
      relay: { sendMission: async () => 7 as never, sendCommand: async () => ({ deviceId: "phone-1", commandId: "command-1", status: "succeeded" as const, detail: "ok" }), latestTelemetry: () => null }
    }, { createMissionId: () => "mission-1" });
    await expect(primitiveResult.stage("phone-1", "route-1")).resolves.toMatchObject({ ok: false, code: "MISSION_TRANSFER_FAILED" });

    const nullResult = MissionDispatcher.create({
      routeSource: { getMissionPayload: () => ({ ok: true as const, value: routePayload() }) },
      relay: { sendMission: async () => null as never, sendCommand: async () => ({ deviceId: "phone-1", commandId: "command-1", status: "succeeded" as const, detail: "ok" }), latestTelemetry: () => null }
    }, { createMissionId: () => "mission-1" });
    await expect(nullResult.stage("phone-1", "route-1")).resolves.toMatchObject({ ok: false, code: "MISSION_TRANSFER_FAILED" });

    const throwingStatus = MissionDispatcher.create({
      routeSource: { getMissionPayload: () => ({ ok: true as const, value: routePayload() }) },
      relay: { sendMission: async () => ({ get status(): never { throw new Error("status unavailable"); } }) as never, sendCommand: async () => ({ deviceId: "phone-1", commandId: "command-1", status: "succeeded" as const, detail: "ok" }), latestTelemetry: () => null }
    }, { createMissionId: () => "mission-1" });
    await expect(throwingStatus.stage("phone-1", "route-1")).resolves.toMatchObject({ ok: false, code: "MISSION_TRANSFER_FAILED" });
  });

  it("treats a rejected phone transfer and telemetry read faults as explicit failures", async () => {
    const transferRejected = MissionDispatcher.create({
      routeSource: { getMissionPayload: () => ({ ok: true as const, value: routePayload() }) },
      relay: { sendMission: async () => ({ deviceId: "phone-1", missionId: "mission-1", status: "rejected" as const, detail: "rejected" }), sendCommand: async () => { throw new Error("must not send"); }, latestTelemetry: () => null }
    }, { createMissionId: () => "mission-1" });
    expect(await transferRejected.stage("phone-1", "route-1")).toMatchObject({ ok: false, code: "MISSION_TRANSFER_FAILED" });

    const telemetryFault = makeFixture();
    await stage(telemetryFault.dispatcher);
    await telemetryFault.dispatcher.upload("phone-1");
    telemetryFault.setTelemetry(new Proxy({}, { get() { throw new Error("telemetry fault"); } }));
    expect(await telemetryFault.dispatcher.start("phone-1")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE", state: { phase: "uploaded" } });

    const readerFault = MissionDispatcher.create({
      routeSource: { getMissionPayload: () => ({ ok: true as const, value: routePayload() }) },
      relay: { sendMission: async (_deviceId, payload) => ({ deviceId: "phone-1", missionId: payload.missionId, status: "succeeded" as const, detail: "ok" }), sendCommand: async () => ({ deviceId: "phone-1", commandId: "command-1", status: "succeeded" as const, detail: "ok" }), latestTelemetry: () => { throw new Error("reader fault"); } }
    }, { createMissionId: () => "mission-1" });
    await stage(readerFault);
    await readerFault.upload("phone-1");
    expect(await readerFault.start("phone-1")).toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE", state: { phase: "uploaded" } });
  });

  it("publishes detached snapshots, isolates listener failures, and forgets only terminal lanes", async () => {
    const fixture = makeFixture();
    const observed: unknown[] = [];
    fixture.dispatcher.subscribe(() => { throw new Error("listener fault"); });
    const unsubscribe = fixture.dispatcher.subscribe((lanes) => { observed.push(lanes); });

    await stage(fixture.dispatcher);
    const lane = fixture.dispatcher.get("phone-1");
    expect(Object.isFrozen(lane)).toBe(true);
    expect(Object.isFrozen(fixture.dispatcher.list())).toBe(true);
    expect(fixture.dispatcher.forget("phone-1")).toBe(false);
    await fixture.dispatcher.upload("phone-1");
    await fixture.dispatcher.start("phone-1");
    await fixture.dispatcher.stop("phone-1");
    expect(fixture.dispatcher.forget("phone-1")).toBe(true);
    expect(fixture.dispatcher.list()).toEqual([]);
    expect(fixture.dispatcher.forget("missing-phone")).toBe(false);
    unsubscribe();
    unsubscribe();
    expect(observed.length).toBeGreaterThan(0);
  });

  it("records a confirmed relay disappearance without sending a recovery command", async () => {
    const fixture = makeFixture();
    await stage(fixture.dispatcher);
    expect(fixture.dispatcher.recordDisconnected("phone-1")).toMatchObject({ deviceId: "phone-1", phase: "disconnected", missionId: "mission-1" });
    expect(fixture.commands).toEqual([]);
    expect(fixture.dispatcher.recordDisconnected("phone-1")).toBeNull();
    expect(fixture.dispatcher.recordDisconnected("missing-phone")).toBeNull();
    await expect(fixture.dispatcher.stage("phone-1", "route-2")).resolves.toMatchObject({ ok: true, state: { phase: "staged", routeId: "route-2" } });
  });

  it("rejects a second command on a busy lane", async () => {
    const fixture = makeFixture();
    await stage(fixture.dispatcher);
    await fixture.dispatcher.upload("phone-1");
    await fixture.dispatcher.start("phone-1");
    let resolveCommand!: (value: { deviceId: string; commandId: string; status: "succeeded"; detail: string }) => void;
    const busy = MissionDispatcher.create({
      routeSource: { getMissionPayload: () => ({ ok: true as const, value: routePayload() }) },
      relay: {
        sendMission: async (_deviceId, payload) => ({ deviceId: "phone-1", missionId: payload.missionId, status: "succeeded" as const, detail: "ok" }),
        sendCommand: (deviceId, request) => request.name === "wayline.upload"
          ? Promise.resolve({ deviceId, commandId: "command-upload", status: "succeeded" as const, detail: "ok" })
          : new Promise((resolve) => { resolveCommand = resolve; }),
        latestTelemetry: () => ({ deviceId: "phone-1", payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true, isFlying: false, motorsOn: false, batteryPercent: 80 }, capabilities: { waypointMission: true, waypointMissionSupport: "supported" } })
      }
    }, { createMissionId: () => "mission-1" });
    await stage(busy);
    await busy.upload("phone-1");
    const first = busy.start("phone-1");
    const second = await busy.start("phone-1");
    expect(second).toMatchObject({ ok: false, code: "OPERATION_IN_PROGRESS" });
    resolveCommand({ deviceId: "phone-1", commandId: "command-1", status: "succeeded", detail: "ok" });
    await expect(first).resolves.toMatchObject({ ok: true, state: { phase: "starting" } });
  });

  it("stops from starting to match the aircraft, and refuses stop before start", async () => {
    const fixture = makeFixture();
    await stage(fixture.dispatcher);
    await fixture.dispatcher.upload("phone-1");
    expect(await fixture.dispatcher.stop("phone-1")).toMatchObject({ ok: false, code: "ILLEGAL_PHASE", state: { phase: "uploaded" } });
    expect(fixture.commands.map((command) => command.name)).toEqual(["wayline.upload"]);
    expect(await fixture.dispatcher.start("phone-1")).toMatchObject({ ok: true, state: { phase: "starting" } });
    expect(await fixture.dispatcher.stop("phone-1")).toMatchObject({ ok: true, state: { phase: "idle" } });
    expect(fixture.commands.map((command) => command.name)).toEqual(["wayline.upload", "wayline.start", "wayline.stop"]);
  });

  it("keeps ROUTE_EXECUTION_STARTED while start is still in flight", async () => {
    let resolveCommand!: (value: { deviceId: string; commandId: string; status: "succeeded" | "rejected"; detail: string }) => void;
    const dispatcher = MissionDispatcher.create({
      routeSource: { getMissionPayload: () => ({ ok: true as const, value: routePayload() }) },
      relay: {
        sendMission: async (_deviceId, payload) => ({ deviceId: "phone-1", missionId: payload.missionId, status: "succeeded" as const, detail: "ok" }),
        sendCommand: (deviceId, request) => request.name === "wayline.upload"
          ? Promise.resolve({ deviceId, commandId: "command-upload", status: "succeeded" as const, detail: "ok" })
          : new Promise((resolve) => { resolveCommand = resolve; }),
        latestTelemetry: () => ({ deviceId: "phone-1", payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true, isFlying: false, motorsOn: false, batteryPercent: 80 }, capabilities: { waypointMission: true, waypointMissionSupport: "supported" } })
      }
    }, { createMissionId: () => "mission-1" });
    await stage(dispatcher);
    await dispatcher.upload("phone-1");
    const pending = dispatcher.start("phone-1");
    expect(dispatcher.get("phone-1").phase).toBe("starting");
    expect(dispatcher.recordExecutionStarted("phone-1", routePayload().fileName)).toMatchObject({ phase: "running" });
    resolveCommand({ deviceId: "phone-1", commandId: "command-1", status: "succeeded", detail: "ok" });
    await expect(pending).resolves.toMatchObject({ ok: true, state: { phase: "running" } });
  });

  it("does not fail a mission that already started if the start ack later fails", async () => {
    let resolveCommand!: (value: { deviceId: string; commandId: string; status: "succeeded" | "rejected"; detail: string }) => void;
    const dispatcher = MissionDispatcher.create({
      routeSource: { getMissionPayload: () => ({ ok: true as const, value: routePayload() }) },
      relay: {
        sendMission: async (_deviceId, payload) => ({ deviceId: "phone-1", missionId: payload.missionId, status: "succeeded" as const, detail: "ok" }),
        sendCommand: (deviceId, request) => request.name === "wayline.upload"
          ? Promise.resolve({ deviceId, commandId: "command-upload", status: "succeeded" as const, detail: "ok" })
          : new Promise((resolve) => { resolveCommand = resolve; }),
        latestTelemetry: () => ({ deviceId: "phone-1", payload: { sdkRegistered: true, remoteControllerConnected: true, flightControllerConnected: true, connected: true, isFlying: false, motorsOn: false, batteryPercent: 80 }, capabilities: { waypointMission: true, waypointMissionSupport: "supported" } })
      }
    }, { createMissionId: () => "mission-1" });
    await stage(dispatcher);
    await dispatcher.upload("phone-1");
    const pending = dispatcher.start("phone-1");
    expect(dispatcher.recordExecutionStarted("phone-1", routePayload().fileName)).toMatchObject({ phase: "running" });
    resolveCommand({ deviceId: "phone-1", commandId: "command-1", status: "rejected", detail: "late" });
    await expect(pending).resolves.toMatchObject({ ok: true, state: { phase: "running" } });
  });
});
