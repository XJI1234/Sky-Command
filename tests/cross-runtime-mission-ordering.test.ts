import { describe, expect, it } from "vitest";
import { MissionPhaseIntake } from "../src/modules/relay-link/mission-phase-intake/index.js";

const fact = (missionRevision: number, deviceGeneration: number, sequence: number) => ({
  connectionId: "connection-1",
  missionRevision,
  deviceGeneration,
  sequence,
  phase: "ROUTE_EXECUTION_STARTED" as const,
  fileName: "route.kmz",
});

describe("航线阶段代次与序号隔离", () => {
  it("拒绝旧任务修订和旧设备代次但允许新任务从序号一重新开始", () => {
    const intake = MissionPhaseIntake.create();
    expect(intake.accept(fact(2, 1, 9))).toMatchObject({ ok: true });
    expect(intake.accept(fact(1, 1, 100))).toMatchObject({ ok: false, error: { code: "STALE_MISSION_PHASE" } });
    expect(intake.accept(fact(3, 0, 100))).toMatchObject({ ok: false, error: { code: "STALE_MISSION_PHASE" } });
    expect(intake.accept(fact(3, 1, 1))).toMatchObject({ ok: true });
  });

  it("同一任务拒绝重复和倒退序号", () => {
    const intake = MissionPhaseIntake.create();
    expect(intake.accept(fact(1, 0, 3))).toMatchObject({ ok: true });
    expect(intake.accept(fact(1, 0, 3))).toMatchObject({ ok: false, error: { code: "STALE_MISSION_PHASE" } });
    expect(intake.accept(fact(1, 0, 2))).toMatchObject({ ok: false, error: { code: "STALE_MISSION_PHASE" } });
  });
});
