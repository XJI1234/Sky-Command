import { describe, expect, it } from "vitest";
import { RelayMissionPhaseSnapshotReader } from "../src/modules/mission-control/relay-mission-phase-snapshot/index.js";

const phase = (overrides: Record<string, unknown> = {}) => ({
  deviceId: "phone-1",
  missionRevision: 1,
  deviceGeneration: 0,
  sequence: 1,
  phase: "ROUTE_EXECUTION_STARTED",
  fileName: "survey.kmz",
  ...overrides
});

describe("中继航线阶段快照解析模块契约", () => {
  it("只投影完整可信的阶段快照，并与输入隔离", () => {
    const input = { missionPhases: [phase(), phase({ deviceId: "phone-2", sequence: 2, phase: "START_POINT_REACHED" })] };
    const result = RelayMissionPhaseSnapshotReader.read(input);
    expect(result).toMatchObject([{ deviceId: "phone-1", phase: "ROUTE_EXECUTION_STARTED" }, { deviceId: "phone-2", sequence: 2 }]);
    expect(Object.isFrozen(result)).toBe(true);
    input.missionPhases[0]!.fileName = "mutated.kmz";
    expect(result?.[0]).toMatchObject({ fileName: "survey.kmz" });
  });

  it("对任一无效条目或不可读取属性返回 null", () => {
    expect(RelayMissionPhaseSnapshotReader.read({ missionPhases: [phase({ sequence: 0 })] })).toBeNull();
    expect(RelayMissionPhaseSnapshotReader.read({ missionPhases: [phase({ phase: "UNKNOWN" })] })).toBeNull();
    expect(RelayMissionPhaseSnapshotReader.read({ missionPhases: [phase({ fileName: "../survey.kmz" })] })).toBeNull();
    expect(RelayMissionPhaseSnapshotReader.read(null)).toBeNull();
    expect(RelayMissionPhaseSnapshotReader.read({ missionPhases: [null] })).toBeNull();
    expect(RelayMissionPhaseSnapshotReader.read(new Proxy({}, { get() { throw new Error("secret"); } }))).toBeNull();
  });

  it("只从受限遥测中读取匹配文件名的已确认终态", () => {
    const raw = {
      telemetry: [
        { deviceId: "phone-1", payload: { kind: "object", fields: { missionExecution: { kind: "string", value: "FINISHED" }, missionFileName: { kind: "string", value: "survey.kmz" } } } },
        { deviceId: "phone-2", payload: { missionExecution: "FAILED", missionFileName: "failed.kmz" } },
        { deviceId: "phone-3", payload: { missionExecution: "EXECUTING", missionFileName: "active.kmz" } },
      ],
    };
    expect(RelayMissionPhaseSnapshotReader.readTerminalStates(raw)).toEqual([
      { deviceId: "phone-1", fileName: "survey.kmz", outcome: "completed" },
      { deviceId: "phone-2", fileName: "failed.kmz", outcome: "failed" },
    ]);
    expect(RelayMissionPhaseSnapshotReader.readTerminalStates({ telemetry: [] })).toEqual([]);
    expect(RelayMissionPhaseSnapshotReader.readTerminalStates({ telemetry: [{ deviceId: "phone-1", payload: { missionExecution: "FINISHED", missionFileName: "../unsafe.kmz" } }] })).toBeNull();
    expect(RelayMissionPhaseSnapshotReader.readTerminalStates({ telemetry: [{ deviceId: "phone-1", payload: null }] })).toEqual([]);
    expect(RelayMissionPhaseSnapshotReader.readTerminalStates({ telemetry: [{ deviceId: " ", payload: {} }] })).toBeNull();
    expect(RelayMissionPhaseSnapshotReader.readTerminalStates({})).toBeNull();
    expect(RelayMissionPhaseSnapshotReader.readTerminalStates(new Proxy({}, { get() { throw new Error("secret"); } }))).toBeNull();
  });

  it("把受限 JSON 包装层中无法读取或不是字符串的终态字段视为未知，而不是猜测任务结果", () => {
    const throwingFields = new Proxy({}, { get() { throw new Error("secret"); } });
    const throwingKind = new Proxy({}, { get() { throw new Error("secret"); } });
    const throwingJsonText = new Proxy({ kind: "string" }, {
      get(target, key) {
        if (key === "value") throw new Error("secret");
        return target[key as keyof typeof target];
      },
    });
    let plainReads = 0;
    const inconsistentPlainProjection = new Proxy({}, {
      get(_target, key) {
        if (key === "missionFileName") return "plain.kmz";
        if (key !== "missionExecution") return undefined;
        plainReads += 1;
        if (plainReads === 1) return "FINISHED";
        throw new Error("secret");
      },
    });
    const result = RelayMissionPhaseSnapshotReader.readTerminalStates({
      telemetry: [
        { deviceId: "phone-null", payload: { kind: "object", fields: { missionExecution: null } } },
        { deviceId: "phone-boolean", payload: { kind: "object", fields: { missionExecution: { kind: "boolean", value: true } } } },
        { deviceId: "phone-string-number", payload: { kind: "object", fields: { missionExecution: { kind: "string", value: 1 } } } },
        { deviceId: "phone-string-throws", payload: { kind: "object", fields: { missionExecution: throwingJsonText } } },
        { deviceId: "phone-bad-fields", payload: { kind: "object", fields: "not-an-object" } },
        { deviceId: "phone-throws", payload: { kind: "object", fields: throwingFields } },
        { deviceId: "phone-kind-throws", payload: throwingKind },
        { deviceId: "phone-plain-number", payload: { missionExecution: 1 } },
        { deviceId: "phone-plain-throws", payload: inconsistentPlainProjection },
        { deviceId: "phone-plain", payload: { missionExecution: "FINISHED", missionFileName: "plain.kmz" } },
      ],
    });

    expect(result).toEqual([
      { deviceId: "phone-plain-throws", fileName: "plain.kmz", outcome: "completed" },
      { deviceId: "phone-plain", fileName: "plain.kmz", outcome: "completed" },
    ]);
  });
});
