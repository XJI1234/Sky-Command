import { describe, expect, it } from "vitest";
import { MissionPhaseIntake } from "../src/modules/relay-link/mission-phase-intake/index.js";

const fact = (overrides: Record<string, unknown> = {}) => ({
  connectionId: "connection-1",
  missionRevision: 1,
  deviceGeneration: 0,
  sequence: 1,
  phase: "START_POINT_REACHED",
  fileName: "survey.kmz",
  ...overrides
});

describe("航线阶段接收模块契约", () => {
  it("按连接保存严格递增的阶段事实并隔离不同连接", () => {
    const intake = MissionPhaseIntake.create();
    expect(intake.accept(fact())).toMatchObject({ ok: true, value: { sequence: 1, phase: "START_POINT_REACHED" } });
    expect(intake.accept(fact({ sequence: 2, phase: "ROUTE_EXECUTION_STARTED" }))).toMatchObject({ ok: true, value: { sequence: 2, phase: "ROUTE_EXECUTION_STARTED" } });
    expect(intake.accept(fact({ sequence: 1 }))).toMatchObject({ ok: false, error: { code: "STALE_MISSION_PHASE" } });
    expect(intake.accept(fact({ connectionId: "connection-2", sequence: 1 }))).toMatchObject({ ok: true });
    expect(intake.snapshot()).toMatchObject([
      { connectionId: "connection-1", sequence: 2, phase: "ROUTE_EXECUTION_STARTED" },
      { connectionId: "connection-2", sequence: 1 }
    ]);
    intake.remove("connection-1");
    expect(intake.get("connection-1")).toBeNull();
    expect(intake.snapshot()).toHaveLength(1);
  });

  it("拒绝无效事实并隔离输入和输出", () => {
    const intake = MissionPhaseIntake.create();
    expect(intake.accept(null as never)).toMatchObject({ ok: false, error: { code: "INVALID_MISSION_PHASE" } });
    for (const input of [fact({ connectionId: " " }), fact({ missionRevision: 0 }), fact({ deviceGeneration: -1 }), fact({ sequence: 0 }), fact({ phase: "UNKNOWN" }), fact({ fileName: "../survey.kmz" })]) {
      expect(intake.accept(input)).toMatchObject({ ok: false, error: { code: "INVALID_MISSION_PHASE" } });
    }
    const input = fact();
    const accepted = intake.accept(input);
    expect(accepted.ok).toBe(true);
    input.fileName = "mutated.kmz";
    expect(intake.get("connection-1")).toMatchObject({ fileName: "survey.kmz" });
    expect(Object.isFrozen(intake.snapshot())).toBe(true);
    expect(intake.get(" ")).toBeNull();
    intake.remove(" ");
    expect(intake.accept(new Proxy(fact({ connectionId: "connection-3" }), { get() { throw new Error("secret"); } }) as never)).toMatchObject({ ok: false, error: { code: "INVALID_MISSION_PHASE" } });
  });
});
