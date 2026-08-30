import { describe, expect, it } from "vitest";
import { MissionPhaseDomain, type MissionPhase, type MissionPhaseEvent } from "../src/modules/mission-control/mission-phase-domain/index.js";
import { WorkflowModel } from "../src/modules/cross-runtime-e2e/workflow-model.js";

const missionId = "model-mission";

const initialState = (phase: MissionPhase) => ({
  missionId: phase === "idle" ? null : missionId,
  phase,
  failureCode: phase === "failed" ? "MODEL_FAILURE" : null,
});

const event = (type: typeof WorkflowModel.mission.events[number]): MissionPhaseEvent => {
  if (type === "stage-requested" || type === "stage-succeeded") return { type, missionId };
  if (type === "operation-failed") return { type, code: "MODEL_FAILURE" };
  return { type } as MissionPhaseEvent;
};

describe("跨运行时独立工作流模型", () => {
  it("逐项比较航线生产状态机的全部状态与事件组合", () => {
    const audit = WorkflowModel.mission.audit();
    expect(audit.total).toBe(14 * 16);
    expect(audit.states).toBe(14);
    expect(audit.events).toBe(16);
    expect(audit.reachableStates).toBe(14);

    for (const phase of WorkflowModel.mission.states) {
      for (const type of WorkflowModel.mission.events) {
        const expected = WorkflowModel.mission.evaluate(phase, type);
        const actual = MissionPhaseDomain.create(initialState(phase)).transition(event(type));
        expect(actual.ok, `${phase} + ${type}`).toBe(expected.accepted);
        if (actual.ok && expected.accepted) expect(actual.state.phase, `${phase} + ${type}`).toBe(expected.next);
      }
    }
  });

  it("相同种子产生相同动作序列且不同种子发生分歧", () => {
    const first = WorkflowModel.generate(20_260_813, 128, WorkflowModel.mission.events);
    const second = WorkflowModel.generate(20_260_813, 128, WorkflowModel.mission.events);
    const different = WorkflowModel.generate(20_260_814, 128, WorkflowModel.mission.events);

    expect(first).toEqual(second);
    expect(first).not.toEqual(different);
    expect(first).toHaveLength(128);
    expect(first.slice(0, 8)).toEqual([
      "resume-requested", "pause-succeeded", "stop-requested", "stage-succeeded",
      "mission-completed", "stop-succeeded", "connection-lost", "start-succeeded",
    ]);
  });

  it("拒绝无效的确定性序列配置并保留零长度序列", () => {
    expect(WorkflowModel.generate(1, 0, ["event"])).toEqual([]);
    expect(() => WorkflowModel.generate(1.5, 1, ["event"])).toThrow("Invalid deterministic sequence configuration");
    expect(() => WorkflowModel.generate(1, 1.5, ["event"])).toThrow("Invalid deterministic sequence configuration");
    expect(() => WorkflowModel.generate(1, -1, ["event"])).toThrow("Invalid deterministic sequence configuration");
    expect(() => WorkflowModel.generate(1, 1, [])).toThrow("Invalid deterministic sequence configuration");
  });

  it("审计精确报告合法和非法转换数量", () => {
    expect(WorkflowModel.mission.audit()).toMatchObject({
      total: 224,
      accepted: 56,
      rejected: 168,
      reachableStates: 14,
    });
  });

  it("失败序列缩减器得到仍可复现失败的一项最小序列", async () => {
    const minimized = await WorkflowModel.minimize(
      ["noise-a", "noise-b", "fault", "noise-c", "noise-d"],
      async (actions) => actions.includes("fault"),
    );

    expect(minimized).toEqual(["fault"]);
  });

  it("缩减器拒绝不可复现输入，并能在无可删项时扩大粒度后保持最小反例", async () => {
    await expect(WorkflowModel.minimize(["safe"], async () => false)).rejects.toThrow("Initial sequence does not reproduce the failure");

    const minimized = await WorkflowModel.minimize(
      ["left", "right"],
      async (actions) => actions.includes("left") && actions.includes("right"),
    );
    expect(minimized).toEqual(["left", "right"]);
  });

  it("缩减器会把两个动作中的无关项删至单一反例，并且绝不接受空反例", async () => {
    await expect(WorkflowModel.minimize(["noise", "fault"], async (actions) => actions.includes("fault"))).resolves.toEqual(["fault"]);
    await expect(WorkflowModel.minimize(["left", "right"], async (actions) => actions.length !== 1)).resolves.toEqual(["left", "right"]);
  });

  it("缩减器在两轮无法删减后提高粒度并终止", async () => {
    let calls = 0;
    const minimized = await WorkflowModel.minimize(
      ["first", "second", "third"],
      async (actions) => { calls += 1; return actions.length === 3; },
    );
    expect(minimized).toEqual(["first", "second", "third"]);
    expect(calls).toBe(6);
  });

  it("缩减器在扩大粒度后删减时保持可预测的候选调用序列", async () => {
    const calls: string[] = [];
    const minimized = await WorkflowModel.minimize(
      ["a", "b", "c", "d", "e"],
      async (actions) => {
        calls.push(actions.join(""));
        return actions.includes("a") && actions.includes("e");
      },
    );
    expect(minimized).toEqual(["a", "e"]);
    expect(calls).toEqual(["abcde", "de", "abc", "cde", "abe", "e", "ab", "be", "ae", "e", "a"]);
  });
});
