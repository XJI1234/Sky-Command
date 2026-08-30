import { describe, expect, it } from "vitest";
import { MissionPhaseDomain, type MissionPhaseEvent, type MissionPhaseState } from "../src/modules/mission-control/mission-phase-domain/index.js";

const transition = (machine: ReturnType<typeof MissionPhaseDomain.create>, event: MissionPhaseEvent) => {
  const result = machine.transition(event);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
};

const stageAndUpload = (machine: ReturnType<typeof MissionPhaseDomain.create>): void => {
  transition(machine, { type: "stage-requested", missionId: "mission-1" });
  transition(machine, { type: "stage-succeeded", missionId: "mission-1" });
  transition(machine, { type: "upload-requested" });
  transition(machine, { type: "upload-succeeded" });
};

describe("mission phase domain contract", () => {
  it("starts idle and completes a mission through distinct upload and execution phases", () => {
    const machine = MissionPhaseDomain.create();
    expect(machine.state()).toEqual({ missionId: null, phase: "idle", failureCode: null });

    expect(transition(machine, { type: "stage-requested", missionId: "mission-1" }).phase).toBe("staging");
    expect(transition(machine, { type: "stage-succeeded", missionId: "mission-1" }).phase).toBe("staged");
    expect(transition(machine, { type: "upload-requested" }).phase).toBe("uploading");
    expect(transition(machine, { type: "upload-succeeded" }).phase).toBe("uploaded");
    expect(transition(machine, { type: "start-requested" }).phase).toBe("starting");
    expect(transition(machine, { type: "start-succeeded" }).phase).toBe("running");
    expect(transition(machine, { type: "pause-requested" }).phase).toBe("pausing");
    expect(transition(machine, { type: "pause-succeeded" }).phase).toBe("paused");
    expect(transition(machine, { type: "resume-requested" }).phase).toBe("resuming");
    expect(transition(machine, { type: "resume-succeeded" }).phase).toBe("running");
    const completed = transition(machine, { type: "mission-completed" });
    expect(completed).toEqual({ missionId: "mission-1", phase: "completed", failureCode: null });
  });

  it("supports operator stop from starting, running, and paused phases", () => {
    for (const stopPhase of ["starting", "running", "paused"] as const) {
      const machine = MissionPhaseDomain.create();
      stageAndUpload(machine);
      transition(machine, { type: "start-requested" });
      if (stopPhase !== "starting") transition(machine, { type: "start-succeeded" });
      if (stopPhase === "paused") { transition(machine, { type: "pause-requested" }); transition(machine, { type: "pause-succeeded" }); }
      expect(transition(machine, { type: "stop-requested" }).phase).toBe("stopping");
      expect(transition(machine, { type: "stop-succeeded" })).toEqual({ missionId: null, phase: "idle", failureCode: null });
    }
  });

  it("allows one explicit stop after the desktop loses and regains session knowledge", () => {
    const machine = MissionPhaseDomain.create();
    stageAndUpload(machine);
    transition(machine, { type: "start-requested" });
    expect(transition(machine, { type: "connection-lost" }).phase).toBe("disconnected");

    expect(transition(machine, { type: "stop-requested" }).phase).toBe("stopping");
  });

  it("allows a matching terminal fact to settle a task that ended while the desktop was disconnected", () => {
    const completed = MissionPhaseDomain.create();
    stageAndUpload(completed);
    transition(completed, { type: "start-requested" });
    transition(completed, { type: "start-succeeded" });
    transition(completed, { type: "connection-lost" });
    expect(transition(completed, { type: "mission-completed" }).phase).toBe("completed");

    const failed = MissionPhaseDomain.create();
    stageAndUpload(failed);
    transition(failed, { type: "start-requested" });
    transition(failed, { type: "start-succeeded" });
    transition(failed, { type: "connection-lost" });
    expect(transition(failed, { type: "operation-failed", code: "MISSION_EXECUTION_FAILED" }).phase).toBe("failed");
  });

  it("preserves a failure reason and allows a new mission after reset or terminal state", () => {
    const machine = MissionPhaseDomain.create();
    stageAndUpload(machine);
    transition(machine, { type: "start-requested" });
    const failed = transition(machine, { type: "operation-failed", code: "aircraft-rejected" });
    expect(failed).toEqual({ missionId: "mission-1", phase: "failed", failureCode: "aircraft-rejected" });
    expect(transition(machine, { type: "reset" })).toEqual({ missionId: null, phase: "idle", failureCode: null });
    expect(transition(machine, { type: "stage-requested", missionId: "mission-2" }).missionId).toBe("mission-2");
    expect(transition(machine, { type: "reset" })).toEqual({ missionId: null, phase: "idle", failureCode: null });
    stageAndUpload(machine);
    transition(machine, { type: "start-requested" });
    transition(machine, { type: "start-succeeded" });
    transition(machine, { type: "mission-completed" });
    expect(transition(machine, { type: "stage-requested", missionId: "mission-3" }).phase).toBe("staging");
  });

  it("moves every active phase to disconnected and can stage again after reconnect", () => {
    const activePhases: MissionPhaseState["phase"][] = ["staging", "staged", "uploading", "uploaded", "starting", "running", "paused", "stopping"];
    for (const phase of activePhases) {
      const machine = MissionPhaseDomain.create();
      transition(machine, { type: "stage-requested", missionId: "mission-1" });
      if (phase === "staged" || phase === "uploading" || phase === "uploaded" || phase === "starting" || phase === "running" || phase === "paused" || phase === "stopping") transition(machine, { type: "stage-succeeded", missionId: "mission-1" });
      if (phase === "uploading" || phase === "uploaded" || phase === "starting" || phase === "running" || phase === "paused" || phase === "stopping") transition(machine, { type: "upload-requested" });
      if (phase === "uploaded" || phase === "starting" || phase === "running" || phase === "paused" || phase === "stopping") transition(machine, { type: "upload-succeeded" });
      if (phase === "starting" || phase === "running" || phase === "paused" || phase === "stopping") transition(machine, { type: "start-requested" });
      if (phase === "running" || phase === "paused" || phase === "stopping") transition(machine, { type: "start-succeeded" });
      if (phase === "paused" || phase === "stopping") { transition(machine, { type: "pause-requested" }); transition(machine, { type: "pause-succeeded" }); }
      if (phase === "stopping") transition(machine, { type: "stop-requested" });
      expect(transition(machine, { type: "connection-lost" }).phase).toBe("disconnected");
      expect(transition(machine, { type: "stage-requested", missionId: "mission-2" }).phase).toBe("staging");
    }
  });

  it("rejects illegal events without changing state", () => {
    const machine = MissionPhaseDomain.create();
    const before = machine.state();
    const result = machine.transition({ type: "start-requested" });
    expect(result).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION", currentPhase: "idle" } });
    expect(machine.state()).toBe(before);
  });

  it("rejects every command event from an active but incompatible phase", () => {
    const machine = MissionPhaseDomain.create();
    transition(machine, { type: "stage-requested", missionId: "mission-1" });
    const illegal = (event: MissionPhaseEvent) => expect(machine.transition(event)).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION", currentPhase: "staging" } });
    illegal({ type: "stage-requested", missionId: "mission-2" });
    expect(machine.transition({ type: "stage-succeeded", missionId: "" })).toMatchObject({ ok: false, error: { code: "INVALID_MISSION_ID" } });
    illegal({ type: "upload-requested" });
    illegal({ type: "upload-succeeded" });
    illegal({ type: "start-requested" });
    illegal({ type: "start-succeeded" });
    illegal({ type: "pause-requested" });
    illegal({ type: "pause-succeeded" });
    illegal({ type: "resume-requested" });
    illegal({ type: "resume-succeeded" });
    illegal({ type: "stop-requested" });
    illegal({ type: "stop-succeeded" });
    illegal({ type: "mission-completed" });

    transition(machine, { type: "stage-succeeded", missionId: "mission-1" });
    expect(machine.transition({ type: "stage-succeeded", missionId: "mission-1" })).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION", currentPhase: "staged" } });
    expect(machine.transition({ type: "operation-failed", code: "late-failure" })).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION", currentPhase: "staged" } });

    transition(machine, { type: "upload-requested" });
    transition(machine, { type: "upload-succeeded" });
    expect(machine.transition({ type: "stop-requested" })).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION", currentPhase: "uploaded" } });
    transition(machine, { type: "start-requested" });
    transition(machine, { type: "start-succeeded" });
    transition(machine, { type: "mission-completed" });
    expect(machine.transition({ type: "connection-lost" })).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION", currentPhase: "completed" } });
  });

  it("rejects invalid and mismatched mission identifiers", () => {
    const machine = MissionPhaseDomain.create();
    expect(machine.transition({ type: "stage-requested", missionId: "   " })).toMatchObject({ ok: false, error: { code: "INVALID_MISSION_ID" } });
    transition(machine, { type: "stage-requested", missionId: "mission-1" });
    expect(machine.transition({ type: "stage-succeeded", missionId: "mission-2" })).toMatchObject({ ok: false, error: { code: "MISSION_ID_MISMATCH" } });
    expect(machine.transition({ type: "operation-failed", code: "   " })).toMatchObject({ ok: false, error: { code: "INVALID_EVENT" } });
    expect(machine.transition({ type: "unknown" } as never)).toMatchObject({ ok: false, error: { code: "INVALID_EVENT" } });
    expect(machine.transition({ type: "__invalid__" } as never)).toMatchObject({ ok: false, error: { code: "INVALID_EVENT" } });
  });

  it("contains exceptions while reading event fields", () => {
    const machine = MissionPhaseDomain.create();
    transition(machine, { type: "stage-requested", missionId: "mission-1" });
    const event = { type: "operation-failed", get code(): string { throw new Error("untrusted getter"); } } as unknown as MissionPhaseEvent;
    expect(machine.transition(event)).toMatchObject({ ok: false, error: { code: "INVALID_EVENT" } });
    expect(machine.state().phase).toBe("staging");
  });

  it("contains exceptions while reading the event type", () => {
    const machine = MissionPhaseDomain.create();
    const event = { get type(): string { throw new Error("untrusted type getter"); } } as unknown as MissionPhaseEvent;
    expect(machine.transition(event)).toMatchObject({ ok: false, error: { code: "INVALID_EVENT", message: "Mission event type cannot be read" } });
    expect(machine.state().phase).toBe("idle");
  });

  it("rejects inaccessible, primitive, and malformed event types without changing state", () => {
    const machine = MissionPhaseDomain.create();
    for (const event of [null, undefined, 7, "start-requested", { type: 7 }, { type: "not-listed" }]) {
      expect(machine.transition(event as never)).toMatchObject({ ok: false, error: { code: "INVALID_EVENT", currentPhase: "idle", message: "Mission event is invalid" } });
      expect(machine.state()).toEqual({ missionId: null, phase: "idle", failureCode: null });
    }
  });

  it("prioritizes transition legality when a stage completion arrives without a staged mission", () => {
    const machine = MissionPhaseDomain.create();
    expect(machine.transition({ type: "stage-succeeded", missionId: "mission-1" })).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION", currentPhase: "idle" } });
    expect(machine.state()).toEqual({ missionId: null, phase: "idle", failureCode: null });
  });

  it("returns immutable detached snapshots and normalizes invalid initial state", () => {
    const initial = { missionId: "mission-1", phase: "staged", failureCode: null } as const;
    const machine = MissionPhaseDomain.create(initial);
    const first = machine.state();
    expect(Object.isFrozen(first)).toBe(true);
    expect(Reflect.set(first, "phase", "idle")).toBe(false);
    expect(machine.state()).toEqual(initial);

    const invalid = MissionPhaseDomain.create({ missionId: null, phase: "running", failureCode: null } as never);
    expect(invalid.state()).toEqual({ missionId: null, phase: "idle", failureCode: null });

    const invalidIdleMission = MissionPhaseDomain.create({ missionId: "mission-1", phase: "idle", failureCode: null } as never);
    const invalidIdleFailure = MissionPhaseDomain.create({ missionId: null, phase: "idle", failureCode: "unexpected" } as never);
    const invalidUnexpectedFailure = MissionPhaseDomain.create({ missionId: "mission-1", phase: "staged", failureCode: "unexpected" } as never);
    const failed = MissionPhaseDomain.create({ missionId: "mission-1", phase: "failed", failureCode: "upload-failed" });
    const throwingInitial = { get phase(): string { throw new Error("untrusted initial getter"); } } as never;
    expect(invalidIdleMission.state().phase).toBe("idle");
    expect(invalidIdleFailure.state().phase).toBe("idle");
    expect(invalidUnexpectedFailure.state().phase).toBe("idle");
    expect(failed.state().phase).toBe("failed");
    expect(failed.reset()).toEqual({ missionId: null, phase: "idle", failureCode: null });
    expect(MissionPhaseDomain.create(throwingInitial).state()).toEqual({ missionId: null, phase: "idle", failureCode: null });
  });
});
