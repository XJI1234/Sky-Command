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
        { deviceId: "phone-1", payload: { kind: "object", fields: { missionExecution: { kind: "string", value: "FINISHED" }, missionFileName: { kind: "string", value: "survey.kmz" }, missionRevision: { kind: "number", value: "1" }, missionDeviceGeneration: { kind: "number", value: "0" } } } },
        { deviceId: "phone-2", payload: { missionExecution: "FAILED", missionFileName: "failed.kmz", missionRevision: 2, missionDeviceGeneration: 1 } },
        { deviceId: "phone-3", payload: { missionExecution: "EXECUTING", missionFileName: "active.kmz" } },
      ],
    };
    expect(RelayMissionPhaseSnapshotReader.readTerminalStates(raw)).toEqual([
      { deviceId: "phone-1", fileName: "survey.kmz", outcome: "completed", missionRevision: 1, deviceGeneration: 0 },
      { deviceId: "phone-2", fileName: "failed.kmz", outcome: "failed", missionRevision: 2, deviceGeneration: 1 },
    ]);
    expect(RelayMissionPhaseSnapshotReader.readTerminalStates({ telemetry: [] })).toEqual([]);
    expect(RelayMissionPhaseSnapshotReader.readTerminalStates({ telemetry: [{ deviceId: "phone-1", payload: { missionExecution: "FINISHED", missionFileName: "../unsafe.kmz", missionRevision: 1, missionDeviceGeneration: 0 } }] })).toBeNull();
    expect(RelayMissionPhaseSnapshotReader.readTerminalStates({ telemetry: [{ deviceId: "phone-1", payload: { missionExecution: "FINISHED", missionFileName: "survey.kmz" } }] })).toBeNull();
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
        if (key === "missionRevision") return 1;
        if (key === "missionDeviceGeneration") return 0;
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
        { deviceId: "phone-plain", payload: { missionExecution: "FINISHED", missionFileName: "plain.kmz", missionRevision: 1, missionDeviceGeneration: 0 } },
      ],
    });

    expect(result).toEqual([
      { deviceId: "phone-plain-throws", fileName: "plain.kmz", outcome: "completed", missionRevision: 1, deviceGeneration: 0 },
      { deviceId: "phone-plain", fileName: "plain.kmz", outcome: "completed", missionRevision: 1, deviceGeneration: 0 },
    ]);
  });

  it("严格隔离异常、超限和畸形的任务代际数字", () => {
    const numberValueThrows = new Proxy({ kind: "number" }, { get(target, key) {
      if (key === "value") throw new Error("secret");
      return target[key as keyof typeof target];
    } });
    const plainIntegerThrows = new Proxy({ missionExecution: "FINISHED", missionFileName: "survey.kmz", missionDeviceGeneration: 0 }, { get(target, key) {
      if (key === "missionRevision") throw new Error("secret");
      return target[key as keyof typeof target];
    } });
    const terminal = (revision: unknown, generation: unknown = 0) => ({
      deviceId: "phone-1",
      payload: {
        missionExecution: "FINISHED",
        missionFileName: "survey.kmz",
        missionRevision: revision,
        missionDeviceGeneration: generation,
      },
    });
    expect(RelayMissionPhaseSnapshotReader.readTerminalStates({ telemetry: [terminal(null)] })).toBeNull();
    expect(RelayMissionPhaseSnapshotReader.readTerminalStates({ telemetry: [terminal({ kind: "number", value: 1 })] })).toBeNull();
    expect(RelayMissionPhaseSnapshotReader.readTerminalStates({ telemetry: [terminal({ kind: "number", value: "9007199254740992" })] })).toBeNull();
    expect(RelayMissionPhaseSnapshotReader.readTerminalStates({ telemetry: [terminal(numberValueThrows)] })).toBeNull();
    expect(RelayMissionPhaseSnapshotReader.readTerminalStates({ telemetry: [{ deviceId: "phone-1", payload: plainIntegerThrows }] })).toBeNull();
  });

  it("隔离 JSON 数字值在校验期间发生的迟到读取异常", () => {
    let reads = 0;
    const delayedFailure = new Proxy({ kind: "number", value: "1" }, {
      get(target, key) {
        if (key === "value") {
          reads += 1;
          if (reads === 2) throw new Error("late numeric read");
        }
        return target[key as keyof typeof target];
      },
    });

    expect(RelayMissionPhaseSnapshotReader.readTerminalStates({
      telemetry: [{
        deviceId: "phone-1",
        payload: {
          kind: "object",
          fields: {
            missionExecution: { kind: "string", value: "FINISHED" },
            missionFileName: { kind: "string", value: "survey.kmz" },
            missionRevision: delayedFailure,
            missionDeviceGeneration: { kind: "number", value: "0" },
          },
        },
      }],
    })).toBeNull();
  });

  it("拒绝不完整、非整数、超限或读取不一致的受限 JSON 任务代际", () => {
    const wrapped = (revision: unknown, generation: unknown = { kind: "number", value: "0" }) => ({
      telemetry: [{
        deviceId: "phone-1",
        payload: {
          kind: "object",
          fields: {
            missionExecution: { kind: "string", value: "FINISHED" },
            missionFileName: { kind: "string", value: "survey.kmz" },
            missionRevision: revision,
            missionDeviceGeneration: generation,
          },
        },
      }],
    });
    expect(RelayMissionPhaseSnapshotReader.readTerminalStates(wrapped(null))).toBeNull();
    expect(RelayMissionPhaseSnapshotReader.readTerminalStates(wrapped({ kind: "string", value: "1" }))).toBeNull();
    expect(RelayMissionPhaseSnapshotReader.readTerminalStates(wrapped({ kind: "number", value: 1 }))).toBeNull();
    expect(RelayMissionPhaseSnapshotReader.readTerminalStates(wrapped({ kind: "number", value: "1.5" }))).toBeNull();
    expect(RelayMissionPhaseSnapshotReader.readTerminalStates(wrapped({ kind: "number", value: "9007199254740992" }))).toBeNull();

    let payloadReads = 0;
    const changingPayload = new Proxy({}, {
      get(_target, key) {
        if (key === "deviceId") return "phone-2";
        if (key !== "payload") return undefined;
        payloadReads += 1;
        if (payloadReads === 1) return { missionExecution: "FINISHED" };
        if (payloadReads === 2) return { missionFileName: "changing.kmz" };
        return null;
      },
    });
    expect(RelayMissionPhaseSnapshotReader.readTerminalStates({ telemetry: [changingPayload] })).toBeNull();

    let fieldsReads = 0;
    const changingFields = new Proxy({ kind: "object" }, {
      get(target, key) {
        if (key !== "fields") return target[key as keyof typeof target];
        fieldsReads += 1;
        if (fieldsReads === 1) return { missionExecution: { kind: "string", value: "FINISHED" } };
        if (fieldsReads === 2) return { missionFileName: { kind: "string", value: "changing.kmz" } };
        return null;
      },
    });
    expect(RelayMissionPhaseSnapshotReader.readTerminalStates({ telemetry: [{ deviceId: "phone-3", payload: changingFields }] })).toBeNull();
  });
});
