import { describe, expect, it } from "vitest";
import { MissionDispatcher, type CommandSendOutcome, type MissionSendOutcome } from "../src/modules/mission-control/mission-dispatcher/index.js";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const receipt = (status: CommandSendOutcome["status"] = "succeeded"): CommandSendOutcome => ({ deviceId: "phone", commandId: "command", status, detail: "test receipt" });
const rejectedReceipt = (): CommandSendOutcome => ({ ...receipt("rejected"), result: { kind: "object", fields: { domain: { kind: "string", value: "wayline" }, outcome: { kind: "string", value: "ACTION_REJECTED" }, errorCode: { kind: "string", value: "BUSY" }, errorDescription: { kind: "string", value: "DJI rejected the action" } } } });
const fixture = () => {
  const transfers: Array<ReturnType<typeof deferred<MissionSendOutcome>>> = [];
  const commands: Array<{ deviceId: string; name: string; pending: ReturnType<typeof deferred<CommandSendOutcome>> }> = [];
  let revision = 0;
  const dispatcher = MissionDispatcher.create({
    routeSource: { getMissionPayload: (routeId) => ({ ok: true, value: { routeId, fileName: "survey.kmz", sizeBytes: 1, sha256: "a".repeat(64), bytes: new Uint8Array([1]) } }) },
    relay: {
      sendMission: () => { const pending = deferred<MissionSendOutcome>(); transfers.push(pending); return pending.promise; },
      sendCommand: (deviceId, request) => { const pending = deferred<CommandSendOutcome>(); commands.push({ deviceId, name: request.name, pending }); return pending.promise; },
      latestTelemetry: (deviceId) => ({ deviceId, payload: { sdkAvailability: "READY" }, capabilities: {} }),
    },
  }, { createMissionId: () => `mission-${++revision}` });
  const stage = async (deviceId = "phone") => {
    const request = dispatcher.stage(deviceId, "route");
    transfers.at(-1)!.resolve({ deviceId, missionId: dispatcher.get(deviceId).missionId!, status: "succeeded", detail: "test receipt" });
    expect((await request).ok).toBe(true);
  };
  const command = async (operation: "upload" | "start" | "pause", deviceId = "phone") => {
    const request = dispatcher[operation](deviceId);
    commands.at(-1)!.pending.resolve(receipt());
    expect((await request).ok).toBe(true);
  };
  const prepare = async (deviceId = "phone") => { await stage(deviceId); await command("upload", deviceId); };
  return { dispatcher, transfers, commands, stage, command, prepare };
};

describe("mission operation recovery", () => {
  it.each(["succeeded", "rejected"] as const)("ignores an old transfer %s after disconnect and a new same-file stage", async status => {
    const f = fixture();
    const old = f.dispatcher.stage("phone", "route");
    f.dispatcher.recordDisconnected("phone");
    const current = f.dispatcher.stage("phone", "route");
    const before = f.dispatcher.get("phone");
    f.transfers[0]!.resolve({ deviceId: "phone", missionId: "mission-1", status, detail: "old receipt" });
    await old;
    expect(f.dispatcher.get("phone")).toEqual(before);
    expect(await f.dispatcher.upload("phone")).toMatchObject({ ok: false, code: "OPERATION_IN_PROGRESS" });
    f.transfers[1]!.resolve({ deviceId: "phone", missionId: "mission-2", status: "succeeded", detail: "new receipt" });
    expect(await current).toMatchObject({ ok: true, state: { phase: "staged", missionId: "mission-2" } });
  });

  it("does not apply an old upload success to a new upload after reconnect", async () => {
    const f = fixture();
    await f.stage();
    const old = f.dispatcher.upload("phone");
    const oldReply = f.commands.at(-1)!;
    f.dispatcher.recordDisconnected("phone");
    await f.stage();
    const current = f.dispatcher.upload("phone");
    const currentReply = f.commands.at(-1)!;
    const before = f.dispatcher.get("phone");
    oldReply.pending.resolve(receipt());
    await old;
    expect(f.dispatcher.get("phone")).toEqual(before);
    currentReply.pending.resolve(receipt());
    expect(await current).toMatchObject({ ok: true, state: { phase: "uploaded" } });
  });

  it("keeps a reconnect stop authoritative when the previous start replies", async () => {
    const f = fixture();
    await f.prepare();
    const old = f.dispatcher.start("phone");
    const oldReply = f.commands.at(-1)!;
    f.dispatcher.recordDisconnected("phone");
    const stop = f.dispatcher.stop("phone");
    const stopReply = f.commands.at(-1)!;
    const before = f.dispatcher.get("phone");
    oldReply.pending.resolve(receipt("timed-out"));
    await old;
    expect(f.dispatcher.get("phone")).toEqual(before);
    expect(await f.dispatcher.stop("phone")).toMatchObject({ code: "OPERATION_IN_PROGRESS" });
    stopReply.pending.resolve(receipt());
    expect((await stop).ok).toBe(true);
  });

  it.each(["start", "pause", "resume"] as const)("allows a fresh task after confirmed stop without waiting for the old %s receipt", async operation => {
    const f = fixture();
    await f.prepare();
    if (operation !== "start") {
      await f.command("start");
      f.dispatcher.recordExecutionStarted("phone", "survey.kmz", 1, 0);
      if (operation === "resume") await f.command("pause");
    }
    const old = f.dispatcher[operation]("phone");
    const oldReply = f.commands.at(-1)!;
    const stop = f.dispatcher.stop("phone");
    f.commands.at(-1)!.pending.resolve(receipt());
    expect(await stop).toMatchObject({ ok: true, state: { phase: "idle" } });
    await f.stage();
    const before = f.dispatcher.get("phone");
    oldReply.pending.resolve(receipt());
    await old;
    expect(f.dispatcher.get("phone")).toEqual(before);
  });

  it("does not let a preempted start timeout overwrite a confirmed pause result", async () => {
    const f = fixture();
    await f.prepare();
    const old = f.dispatcher.start("phone");
    const oldReply = f.commands.at(-1)!;
    await f.command("pause");
    const before = f.dispatcher.get("phone");
    oldReply.pending.resolve(receipt("timed-out"));
    expect(await old).toMatchObject({ ok: false });
    expect(f.dispatcher.get("phone")).toEqual(before);
  });

  it.each(["pausing", "paused", "resuming", "stopping"] as const)("retains the first execution milestone received while %s so a matching terminal can settle the mission", async phase => {
    const f = fixture();
    await f.prepare();
    await f.command("start");
    let pending: Promise<unknown> | undefined;
    if (phase === "pausing") pending = f.dispatcher.pause("phone");
    if (phase === "paused" || phase === "resuming") await f.command("pause");
    if (phase === "resuming") pending = f.dispatcher.resume("phone");
    if (phase === "stopping") pending = f.dispatcher.stop("phone");
    expect(f.dispatcher.get("phone").phase).toBe(phase);
    expect(f.dispatcher.recordMissionPhase("phone", "survey.kmz", 1, 0, 1, "ROUTE_EXECUTION_STARTED")).toMatchObject({ phase, routeExecutionStarted: true });
    expect(f.dispatcher.recordExecutionTerminal("phone", "survey.kmz", "failed", 1, 0)).toMatchObject({ phase: "failed" });
    if (pending) { f.commands.at(-1)!.pending.resolve(receipt()); await pending; }
    expect(f.dispatcher.get("phone").phase).toBe("failed");
  });

  it("restores observed running after a pause is rejected when execution began during the pause request", async () => {
    const f = fixture();
    await f.prepare();
    await f.command("start");
    const pause = f.dispatcher.pause("phone");
    f.dispatcher.recordMissionPhase("phone", "survey.kmz", 1, 0, 1, "ROUTE_EXECUTION_STARTED");
    f.commands.at(-1)!.pending.resolve({ ...receipt("rejected"), result: { kind: "object", fields: { domain: { kind: "string", value: "wayline" }, outcome: { kind: "string", value: "INVOCATION_FAILED" } } } });
    expect(await pause).toMatchObject({ ok: false, state: { phase: "running", routeExecutionStarted: true } });
  });

  it("does not report an unobserved start timeout as success while pause is pending", async () => {
    const f = fixture();
    await f.prepare();
    const start = f.dispatcher.start("phone");
    const startReply = f.commands.at(-1)!;
    const pause = f.dispatcher.pause("phone");
    const pauseReply = f.commands.at(-1)!;
    const before = f.dispatcher.get("phone");
    startReply.pending.resolve(receipt("timed-out"));
    expect(await start).toMatchObject({ ok: false, code: "WAYLINE_START_UNCONFIRMED" });
    expect(f.dispatcher.get("phone")).toEqual(before);
    pauseReply.pending.resolve(receipt());
    await pause;
  });

  it.each(["pause", "resume"] as const)("preserves a %s success received during a later rejected stop", async operation => {
    const f = fixture();
    await f.prepare();
    await f.command("start");
    f.dispatcher.recordExecutionStarted("phone", "survey.kmz", 1, 0);
    if (operation === "resume") await f.command("pause");
    const prior = f.dispatcher[operation]("phone");
    const priorReply = f.commands.at(-1)!;
    const stop = f.dispatcher.stop("phone");
    const stopReply = f.commands.at(-1)!;
    const before = f.dispatcher.get("phone");
    priorReply.pending.resolve(receipt());
    expect((await prior).ok).toBe(true);
    expect(f.dispatcher.get("phone")).toEqual(before);
    stopReply.pending.resolve(rejectedReceipt());
    expect(await stop).toMatchObject({ ok: false, state: { phase: operation === "pause" ? "paused" : "running", lastResult: { operation: "stop", code: "WAYLINE_ACTION_REJECTED" } } });
  });

  it("restores uploaded when both an overlapping start and pause are explicitly rejected", async () => {
    const f = fixture();
    await f.prepare();
    const start = f.dispatcher.start("phone");
    const startReply = f.commands.at(-1)!;
    const pause = f.dispatcher.pause("phone");
    const pauseReply = f.commands.at(-1)!;
    startReply.pending.resolve(rejectedReceipt());
    expect(await start).toMatchObject({ ok: false, code: "WAYLINE_ACTION_REJECTED" });
    pauseReply.pending.resolve(rejectedReceipt());
    expect(await pause).toMatchObject({ ok: false, state: { phase: "uploaded" } });
  });

  it("does not write an old receipt into a newer mission that has also disconnected", async () => {
    const f = fixture();
    const old = f.dispatcher.stage("phone", "route");
    f.dispatcher.recordDisconnected("phone");
    await f.stage();
    f.dispatcher.recordDisconnected("phone");
    const before = f.dispatcher.get("phone");
    f.transfers[0]!.resolve({ deviceId: "phone", missionId: "mission-1", status: "succeeded", detail: "old receipt" });
    await old;
    expect(f.dispatcher.get("phone")).toEqual(before);
  });

  it("publishes running after a new execution milestone following an unconfirmed resume and explicit start", async () => {
    const f = fixture();
    await f.prepare(); await f.command("start");
    f.dispatcher.recordMissionPhase("phone", "survey.kmz", 1, 0, 1, "ROUTE_EXECUTION_STARTED");
    await f.command("pause");
    const resume = f.dispatcher.resume("phone");
    f.commands.at(-1)!.pending.resolve(receipt("timed-out"));
    await resume;
    await f.command("start");
    const published: string[] = [];
    f.dispatcher.subscribe(lanes => published.push(lanes[0]!.phase));
    f.dispatcher.recordMissionPhase("phone", "survey.kmz", 1, 0, 2, "ROUTE_EXECUTION_STARTED");
    expect(published).toEqual(["running"]);
  });
});
