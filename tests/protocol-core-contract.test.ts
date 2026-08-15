import { describe, expect, it } from "vitest";
import {
  JsonNull,
  ProtocolLimits,
  RelayFrameCodec,
  type JsonValue,
  type RelayFrame,
  validate,
  validateJsonObject,
} from "../src/modules/relay-link/protocol-core/index.js";
import type { ProtocolErrorCode } from "../src/modules/relay-link/protocol-core/index.js";

const text = (value: string): JsonValue => ({ kind: "string", value });
const number = (value: string): JsonValue => ({ kind: "number", value });
const object = (fields: Record<string, JsonValue>): JsonValue => ({ kind: "object", fields });
const validFrames: RelayFrame[] = [
  { type: "hello", deviceId: "phone-1", protocolVersion: "1" },
  { type: "paired", sessionId: "session-1", protocolVersion: "1" },
  { type: "paired", sessionId: "session-2", protocolVersion: null },
  { type: "telemetry", payload: { kind: "object", fields: { battery: number("98") } }, capabilities: { kind: "object", fields: {} } },
  { type: "command", id: "cmd-1", command: { name: "camera.start", fields: { mode: text("video") } } },
  { type: "command-result", id: "cmd-1", ok: true, detail: "accepted" },
  { type: "mission-begin", id: "mission-1", fileName: "route.kmz", size: 1, sha256: "a".repeat(64) },
  { type: "mission-chunk", id: "mission-1", data: new Uint8Array([0, 1, 255]) },
  { type: "mission-complete", id: "mission-1" },
  { type: "mission-result", id: "mission-1", ok: false, detail: "rejected" },
  { type: "mission-phase", missionRevision: 1, deviceGeneration: 0, sequence: 1, phase: "START_POINT_REACHED", fileName: "route.kmz" },
  { type: "diagnostic-report", runId: "run-1", events: [{ sequence: 1, timestampMillis: 0, level: "INFO", module: "relay-gateway", eventCode: "STARTED", operationId: null, safeDetail: "connected" }] },
  { type: "diagnostic-ack", runId: "run-1", acknowledgedSequence: 1 },
];

describe("relay-link/protocol-core contract", () => {
  it.each(validFrames)("round-trips %s frames", (frame) => {
    const encoded = RelayFrameCodec.encode(frame);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) throw encoded.error;
    const decoded = RelayFrameCodec.decode(encoded.value);
    expect(decoded).toMatchObject({ kind: "decoded", frame });
  });

  it("uses compact UTF-8 JSON and canonical command field placement", () => {
    const result = RelayFrameCodec.encode({ type: "command", id: "x", command: { name: "go", fields: { z: number("1") } } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(new TextDecoder().decode(result.value)).toBe('{"type":"command","id":"x","command":{"z":1,"name":"go"}}');
  });

  it("rejects invalid frame fields with stable codes", () => {
    const cases: readonly [RelayFrame, ProtocolErrorCode][] = [
      [{ type: "hello", deviceId: "", protocolVersion: "1" }, "INVALID_DEVICE_ID"],
      [{ type: "hello", deviceId: "x", protocolVersion: "2" }, "PROTOCOL_VERSION_UNSUPPORTED"],
      [{ type: "paired", sessionId: "\n", protocolVersion: null }, "INVALID_SESSION_ID"],
      [{ type: "command", id: "x", command: { name: "", fields: {} } }, "INVALID_COMMAND_NAME"],
      [{ type: "command", id: "x", command: { name: "go", fields: { name: text("reserved") } } }, "INVALID_FIELD"],
      [{ type: "command-result", id: "x", ok: true, detail: "a".repeat(1025) }, "INVALID_RESULT_DETAIL"],
      [{ type: "mission-begin", id: "x", fileName: "../route.kmz", size: 1, sha256: "a".repeat(64) }, "INVALID_FILE_NAME"],
      [{ type: "mission-begin", id: "x", fileName: "route.kmz", size: 0, sha256: "a".repeat(64) }, "MISSION_SIZE_OUT_OF_RANGE"],
      [{ type: "mission-begin", id: "x", fileName: "route.kmz", size: 1, sha256: "A".repeat(64) }, "INVALID_SHA256"],
      [{ type: "mission-chunk", id: "x", data: new Uint8Array() }, "EMPTY_CHUNK"],
      [{ type: "mission-phase", missionRevision: 0, deviceGeneration: 0, sequence: 1, phase: "START_POINT_REACHED", fileName: "route.kmz" } as never, "INVALID_FIELD"],
    ];
    for (const [frame, code] of cases) expect(validate(frame)).toMatchObject({ ok: false, error: { code } });
  });

  it("accepts all protocol boundaries", () => {
    expect(validate({ type: "hello", deviceId: "a".repeat(128), protocolVersion: "1" })).toMatchObject({ ok: true });
    expect(validate({ type: "command", id: "x", command: { name: "n".repeat(64), fields: {} } })).toMatchObject({ ok: true });
    expect(validate({ type: "command-result", id: "x", ok: true, detail: "d".repeat(1024) })).toMatchObject({ ok: true });
    expect(validate({ type: "mission-begin", id: "x", fileName: `${"a".repeat(124)}.kmz`, size: ProtocolLimits.maxMissionBytes, sha256: "f".repeat(64) })).toMatchObject({ ok: true });
    expect(validate({ type: "mission-chunk", id: "x", data: new Uint8Array(ProtocolLimits.maxMissionChunkBytes) })).toMatchObject({ ok: true });
  });

  it("validates telemetry JSON recursively and keeps number spelling", () => {
    const frame: RelayFrame = { type: "telemetry", payload: { kind: "object", fields: { n: number("1e+2"), nil: JsonNull } }, capabilities: { kind: "object", fields: {} } };
    expect(validate(frame)).toMatchObject({ ok: true });
    const encoded = RelayFrameCodec.encode(frame);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) throw encoded.error;
    expect(RelayFrameCodec.decode(encoded.value)).toMatchObject({ kind: "decoded", frame });
  });

  it("normalizes only structured JSON objects without requiring an enclosing relay frame", () => {
    const input = { kind: "object", fields: { camera: { kind: "object", fields: { mode: text("photo") } } } };
    const normalized = validateJsonObject(input);
    expect(normalized).toEqual({ ok: true, value: input });
    if (!normalized.ok) throw new Error("expected a normalized object");
    expect(normalized.value).not.toBe(input);
    expect(normalized.value.fields).not.toBe(input.fields);
    expect(Object.isFrozen(normalized.value)).toBe(true);
    expect(Object.isFrozen(normalized.value.fields)).toBe(true);
    expect(validateJsonObject({ kind: "string", value: "not-an-object" })).toEqual({ ok: false, error: { code: "INVALID_FIELD", message: "JSON value must be an object" } });
    const hostile = new Proxy(input, { get() { throw new Error("unreadable"); } });
    expect(validateJsonObject(hostile)).toEqual({ ok: false, error: { code: "INVALID_FIELD", message: "JSON value is invalid" } });
  });

  it("rejects malformed input without throwing or leaking data", () => {
    const malformed: readonly [Uint8Array, ProtocolErrorCode | "IGNORED"][] = [
      [new Uint8Array(), "INVALID_JSON"],
      [new TextEncoder().encode("[]"), "INVALID_JSON"],
      [new TextEncoder().encode('{"type":"hello","deviceId":"x","protocolVersion":"1"} trailing'), "INVALID_JSON"],
      [new TextEncoder().encode('{"type":"hello","deviceId":"x","deviceId":"y","protocolVersion":"1"}'), "INVALID_JSON"],
      [new Uint8Array([0xc3, 0x28]), "INVALID_UTF8"],
      [new TextEncoder().encode('{"type":"unknown"}'), "IGNORED"],
      [new TextEncoder().encode('{"type":"mission-chunk","id":"x","data":"!!!!"}'), "INVALID_BASE64"],
      [new TextEncoder().encode('{"type":"hello","deviceId":1,"protocolVersion":"1"}'), "INVALID_FIELD"],
    ];
    for (const [bytes, expected] of malformed) {
      const result = RelayFrameCodec.decode(bytes);
      if (expected === "IGNORED") expect(result).toMatchObject({ kind: "ignored", type: "unknown" });
      else expect(result).toMatchObject({ kind: "rejected", error: { code: expected } });
    }
    const result = RelayFrameCodec.decode(new TextEncoder().encode('{"type":"hello","deviceId":"secret","protocolVersion":"2"}'));
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("defensively copies mission bytes and freezes outputs", () => {
    const bytes = new Uint8Array([1, 2]);
    const frame: RelayFrame = { type: "mission-chunk", id: "x", data: bytes };
    bytes[0] = 9;
    const acceptedFrame = validate({ type: "mission-chunk", id: "x", data: new Uint8Array([1, 2]) });
    expect(acceptedFrame.ok).toBe(true);
    if (!acceptedFrame.ok || acceptedFrame.value.type !== "mission-chunk") throw new Error("expected chunk");
    const acceptedCopy = acceptedFrame.value.data;
    acceptedCopy[0] = 9;
    expect(acceptedFrame.value.data[0]).toBe(1);
    const encoded = RelayFrameCodec.encode(acceptedFrame.value);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) throw encoded.error;
    const decoded = RelayFrameCodec.decode(encoded.value);
    expect(decoded.kind).toBe("decoded");
    if (decoded.kind !== "decoded" || decoded.frame.type !== "mission-chunk") throw new Error("expected chunk");
    const copy = decoded.frame.data;
    copy[0] = 8;
    expect(decoded.frame.data[0]).toBe(1);
    expect(Object.isFrozen(decoded)).toBe(true);
  });

  it("does not throw for hostile validation getters", () => {
    const hostile = new Proxy({ type: "hello", deviceId: "x", protocolVersion: "1" }, { get() { throw new Error("secret"); } }) as unknown as RelayFrame;
    expect(() => validate(hostile)).not.toThrow();
    expect(validate(hostile)).toMatchObject({ ok: false, error: { code: "INVALID_FIELD" } });
  });

  it("accepts the mobile mission-phase wire frame without widening other frame rules", () => {
    const wire = new TextEncoder().encode('{"type":"mission-phase","missionRevision":7,"deviceGeneration":2,"sequence":9,"phase":"ROUTE_EXECUTION_STARTED","fileName":"survey.kmz"}');
    expect(RelayFrameCodec.decode(wire)).toMatchObject({
      kind: "decoded",
      frame: {
        type: "mission-phase",
        missionRevision: 7,
        deviceGeneration: 2,
        sequence: 9,
        phase: "ROUTE_EXECUTION_STARTED",
        fileName: "survey.kmz"
      }
    });
    expect(RelayFrameCodec.decode(new TextEncoder().encode('{"type":"mission-phase","missionRevision":1,"deviceGeneration":0,"sequence":"1","phase":"START_POINT_REACHED","fileName":"survey.kmz"}'))).toMatchObject({ kind: "rejected", error: { code: "INVALID_FIELD" } });
  });

  it("保留手机端 command-result 的可选结构化结果并兼容旧结果帧", () => {
    const wire = new TextEncoder().encode('{"type":"command-result","id":"settings-1","ok":true,"detail":"Settings confirmed","result":{"domain":"camera","settings":{"autoExposureLockEnabled":true,"focusMode":"AF","cameraIndex":"LEFT_OR_MAIN"}}}');
    const decoded = RelayFrameCodec.decode(wire);
    expect(decoded).toMatchObject({
      kind: "decoded",
      frame: { type: "command-result", result: { kind: "object", fields: { domain: { kind: "string", value: "camera" }, settings: { kind: "object" } } } }
    });
    if (decoded.kind !== "decoded") throw new Error("expected command result");
    const encoded = RelayFrameCodec.encode(decoded.frame);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) throw encoded.error;
    expect(new TextDecoder().decode(encoded.value)).toContain('"result"');
    expect(RelayFrameCodec.decode(new TextEncoder().encode('{"type":"command-result","id":"legacy-1","ok":true,"detail":"accepted"}'))).toMatchObject({ kind: "decoded", frame: { type: "command-result", id: "legacy-1", detail: "accepted" } });
  });

  it("拒绝非对象和不可读取的命令结构化结果", () => {
    expect(validate({ type: "command-result", id: "x", ok: true, detail: "done", result: { kind: "string", value: "bad" } as never })).toMatchObject({ ok: false, error: { code: "INVALID_FIELD" } });
    expect(validate({ type: "command-result", id: "x", ok: true, detail: "done", result: { kind: "number", value: "NaN" } as never })).toMatchObject({ ok: false, error: { code: "INVALID_JSON" } });
    const hostile = new Proxy({ type: "command-result", id: "x", ok: true, detail: "done" }, { get(target, key) { if (key === "result") throw new Error("secret"); return Reflect.get(target, key); } });
    expect(validate(hostile as never)).toMatchObject({ ok: false, error: { code: "INVALID_FIELD" } });
    expect(validate({ type: "mission-result", id: "x", ok: "true", detail: "done" } as never)).toMatchObject({ ok: false, error: { code: "INVALID_FIELD" } });
  });

  it("只接受已脱敏并按序的手机诊断事件", () => {
    const valid = {
      type: "diagnostic-report" as const,
      runId: "run-1",
      events: [{ sequence: 1, timestampMillis: 0, level: "WARN" as const, module: "relay-gateway", eventCode: "RETRYING", operationId: "operation-1", safeDetail: "retry pending" }],
    };
    expect(validate(valid)).toMatchObject({ ok: true });

    const invalid: readonly unknown[] = [
      { type: "diagnostic-report", runId: "run-1", events: [] },
      { type: "diagnostic-report", runId: "run-1", events: Array.from({ length: ProtocolLimits.maxDiagnosticEventsPerReport + 1 }, (_, index) => ({ ...valid.events[0], sequence: index + 1 })) },
      { type: "diagnostic-report", runId: "run-1", events: [null] },
      { type: "diagnostic-report", runId: "run-1", events: [{ ...valid.events[0], sequence: 0 }] },
      { type: "diagnostic-report", runId: "run-1", events: [{ ...valid.events[0], timestampMillis: -1 }] },
      { type: "diagnostic-report", runId: "run-1", events: [{ ...valid.events[0], level: "TRACE" }] },
      { type: "diagnostic-report", runId: "run-1", events: [{ ...valid.events[0], module: "1bad" }] },
      { type: "diagnostic-report", runId: "run-1", events: [{ ...valid.events[0], eventCode: "bad space" }] },
      { type: "diagnostic-report", runId: "run-1", events: [{ ...valid.events[0], operationId: "\n" }] },
      { type: "diagnostic-report", runId: "run-1", events: [{ ...valid.events[0], safeDetail: "bad\ntext" }] },
      { type: "diagnostic-report", runId: "run-1", events: [{ ...valid.events[0], safeDetail: "x".repeat(ProtocolLimits.maxDiagnosticDetailCodePoints + 1) }] },
      { type: "diagnostic-report", runId: "run-1", events: [valid.events[0], { ...valid.events[0], sequence: 1 }] },
    ];
    for (const frame of invalid) expect(validate(frame as never)).toMatchObject({ ok: false });
  });

  it("在线上拒绝不合法的诊断报告和确认帧", () => {
    const decode = (value: unknown) => RelayFrameCodec.decode(new TextEncoder().encode(JSON.stringify(value)));
    const event = { sequence: 1, timestampMillis: 0, level: "INFO", module: "relay-gateway", eventCode: "STARTED", safeDetail: "connected" };
    expect(decode({ type: "diagnostic-report", runId: "run-1", events: [event] })).toMatchObject({ kind: "decoded", frame: { type: "diagnostic-report", events: [{ operationId: null }] } });
    expect(decode({ type: "diagnostic-report", runId: "run-1", events: [{ ...event, operationId: null }] })).toMatchObject({ kind: "decoded", frame: { type: "diagnostic-report", events: [{ operationId: null }] } });
    expect(decode({ type: "diagnostic-report", runId: "run-1", events: "not-an-array" })).toMatchObject({ kind: "rejected", error: { code: "INVALID_FIELD" } });
    expect(decode({ type: "diagnostic-report", runId: "run-1", events: ["not-an-event"] })).toMatchObject({ kind: "rejected", error: { code: "INVALID_FIELD" } });
    expect(decode({ type: "diagnostic-report", runId: "run-1", events: [{ ...event, operationId: false }] })).toMatchObject({ kind: "rejected", error: { code: "INVALID_FIELD" } });
    expect(decode({ type: "diagnostic-report", runId: "run-1", events: [{ ...event, level: "TRACE" }] })).toMatchObject({ kind: "rejected", error: { code: "INVALID_DIAGNOSTIC_REPORT" } });
    expect(decode({ type: "diagnostic-ack", runId: "run-1" })).toMatchObject({ kind: "rejected", error: { code: "INVALID_FIELD" } });
    expect(decode({ type: "diagnostic-ack", runId: "run-1", acknowledgedSequence: -1 })).toMatchObject({ kind: "rejected", error: { code: "INVALID_DIAGNOSTIC_ACKNOWLEDGEMENT" } });
    expect(decode({ type: "diagnostic-ack", runId: "run-1", acknowledgedSequence: 1.5 })).toMatchObject({ kind: "rejected", error: { code: "INVALID_FIELD" } });
  });

  it("对诊断帧的每个输入字段单独执行严格检查", () => {
    const event = { sequence: 1, timestampMillis: 0, level: "INFO", module: "relay-gateway", eventCode: "STARTED", operationId: null, safeDetail: "connected" };
    const report = (events: unknown) => ({ type: "diagnostic-report", runId: "run-1", events });
    expect(validate(report([new Proxy({}, { get() { throw new Error("unreadable"); } })]) as never)).toMatchObject({ ok: false, error: { code: "INVALID_FIELD" } });
    expect(validate({ ...report([event]), runId: "" } as never)).toMatchObject({ ok: false, error: { code: "INVALID_MESSAGE_ID" } });
    expect(validate(report("not-an-array") as never)).toMatchObject({ ok: false, error: { code: "INVALID_FIELD" } });
    expect(validate(report([{ ...event, sequence: "1" }]) as never)).toMatchObject({ ok: false, error: { code: "INVALID_FIELD" } });
    expect(validate(report([{ ...event, operationId: {} }]) as never)).toMatchObject({ ok: false, error: { code: "INVALID_FIELD" } });
    expect(validate({ type: "diagnostic-ack", runId: "" as string, acknowledgedSequence: 1 } as never)).toMatchObject({ ok: false, error: { code: "INVALID_MESSAGE_ID" } });
    expect(validate({ type: "diagnostic-ack", runId: "run-1", acknowledgedSequence: "1" } as never)).toMatchObject({ ok: false, error: { code: "INVALID_FIELD" } });
  });

  it("拒绝诊断时间戳和序号的非整数线上表示", () => {
    const decode = (source: string) => RelayFrameCodec.decode(new TextEncoder().encode(source));
    const prefix = '{"type":"diagnostic-report","runId":"run-1","events":[{"sequence":';
    const suffix = ',"timestampMillis":0,"level":"INFO","module":"relay-gateway","eventCode":"STARTED","safeDetail":"connected"}]}';
    expect(decode(prefix + '"1"' + suffix)).toMatchObject({ kind: "rejected", error: { code: "INVALID_FIELD" } });
    expect(decode(prefix + '1.5' + suffix)).toMatchObject({ kind: "rejected", error: { code: "INVALID_FIELD" } });
    expect(decode(prefix + '9007199254740992' + suffix)).toMatchObject({ kind: "rejected", error: { code: "INVALID_FIELD" } });
    expect(decode('{"type":"diagnostic-report","runId":"run-1","events":[{"sequence":1,"timestampMillis":"0","level":"INFO","module":"relay-gateway","eventCode":"STARTED","safeDetail":"connected"}]}')).toMatchObject({ kind: "rejected", error: { code: "INVALID_FIELD" } });
    expect(decode('{"type":"diagnostic-report","runId":"run-1","events":[{"sequence":1,"timestampMillis":0,"level":1,"module":"relay-gateway","eventCode":"STARTED","safeDetail":"connected"}]}')).toMatchObject({ kind: "rejected", error: { code: "INVALID_FIELD" } });
  });

  it("rejects every malformed diagnostic event field before the report is accepted", () => {
    const event = { sequence: 1, timestampMillis: 0, level: "INFO", module: "relay-gateway", eventCode: "STARTED", operationId: null, safeDetail: "connected" };
    const malformed = [
      { ...event, sequence: "1" },
      { ...event, timestampMillis: "0" },
      { ...event, level: 1 },
      { ...event, module: 1 },
      { ...event, eventCode: 1 },
      { ...event, safeDetail: 1 },
      { ...event, operationId: {} },
    ];
    for (const candidate of malformed) {
      expect(validate({ type: "diagnostic-report", runId: "run-1", events: [candidate] } as never)).toEqual({ ok: false, error: { code: "INVALID_FIELD", message: "Diagnostic event fields are invalid" } });
    }
  });

  it("rejects every malformed diagnostic event field received on the wire", () => {
    const event = { sequence: 1, timestampMillis: 0, level: "INFO", module: "relay-gateway", eventCode: "STARTED", safeDetail: "connected" };
    const malformed = [
      { ...event, sequence: "1" },
      { ...event, timestampMillis: "0" },
      { ...event, level: 1 },
      { ...event, module: 1 },
      { ...event, eventCode: 1 },
      { ...event, safeDetail: 1 },
      { ...event, operationId: false },
    ];
    for (const candidate of malformed) {
      const bytes = new TextEncoder().encode(JSON.stringify({ type: "diagnostic-report", runId: "run-1", events: [candidate] }));
      expect(RelayFrameCodec.decode(bytes)).toEqual({ kind: "rejected", error: { code: "INVALID_FIELD", message: "Diagnostic event fields are invalid" } });
    }
  });

  it("distinguishes JSON container kinds and nesting-depth boundaries", () => {
    expect(validateJsonObject({ kind: "unknown", fields: {} })).toEqual({ ok: false, error: { code: "INVALID_JSON", message: "Unsupported JSON value" } });
    expect(validateJsonObject({ kind: "array", values: [] })).toEqual({ ok: false, error: { code: "INVALID_FIELD", message: "JSON value must be an object" } });
    expect(validateJsonObject({ kind: "object", fields: [] })).toEqual({ ok: false, error: { code: "INVALID_FIELD", message: "JSON object is invalid" } });
    let nested: JsonValue = { kind: "null" };
    for (let index = 0; index < ProtocolLimits.maxJsonNestingDepth; index += 1) nested = { kind: "object", fields: { nested } };
    expect(validateJsonObject(nested)).toMatchObject({ ok: true });
    nested = { kind: "object", fields: { nested } };
    expect(validateJsonObject(nested)).toEqual({ ok: false, error: { code: "INVALID_JSON", message: "JSON nesting is too deep" } });
  });

  it("rejects every semantically invalid diagnostic event and report boundary", () => {
    const event = { sequence: 1, timestampMillis: 0, level: "INFO", module: "relay-gateway", eventCode: "STARTED", operationId: null, safeDetail: "connected" };
    const invalidEvent = [
      { ...event, sequence: 0 },
      { ...event, timestampMillis: -1 },
      { ...event, level: "TRACE" },
      { ...event, module: "1invalid" },
      { ...event, eventCode: "bad space" },
      { ...event, operationId: "bad\u0000operation" },
      { ...event, safeDetail: "bad\u0000detail" },
      { ...event, safeDetail: "d".repeat(ProtocolLimits.maxDiagnosticDetailCodePoints + 1) },
    ];
    for (const candidate of invalidEvent) {
      expect(validate({ type: "diagnostic-report", runId: "run-1", events: [candidate] } as never)).toEqual({ ok: false, error: { code: "INVALID_DIAGNOSTIC_REPORT", message: "Diagnostic event is invalid" } });
    }
    expect(validate({ type: "diagnostic-report", runId: "run-1", events: [] })).toEqual({ ok: false, error: { code: "INVALID_DIAGNOSTIC_REPORT", message: "Diagnostic event count is invalid" } });
    expect(validate({ type: "diagnostic-report", runId: "run-1", events: Array.from({ length: ProtocolLimits.maxDiagnosticEventsPerReport + 1 }, (_, index) => ({ ...event, sequence: index + 1 })) })).toEqual({ ok: false, error: { code: "INVALID_DIAGNOSTIC_REPORT", message: "Diagnostic event count is invalid" } });
    expect(validate({ type: "diagnostic-report", runId: "run-1", events: [event, { ...event, sequence: 1 }] })).toEqual({ ok: false, error: { code: "INVALID_DIAGNOSTIC_REPORT", message: "Diagnostic event is invalid" } });
  });

  it("rejects semantically invalid diagnostic reports received on the wire", () => {
    const event = { sequence: 1, timestampMillis: 0, level: "INFO", module: "relay-gateway", eventCode: "STARTED", safeDetail: "connected" };
    const invalid = [
      { ...event, sequence: 0 },
      { ...event, timestampMillis: -1 },
      { ...event, level: "TRACE" },
      { ...event, module: "1invalid" },
      { ...event, eventCode: "bad space" },
      { ...event, operationId: "bad\u0000operation" },
      { ...event, safeDetail: "bad\u0000detail" },
    ];
    for (const candidate of invalid) {
      const bytes = new TextEncoder().encode(JSON.stringify({ type: "diagnostic-report", runId: "run-1", events: [candidate] }));
      expect(RelayFrameCodec.decode(bytes)).toEqual({ kind: "rejected", error: { code: "INVALID_DIAGNOSTIC_REPORT", message: "Diagnostic event is invalid" } });
    }
  });

  it("enforces every JSON scalar, container, field-name, and numeric-text boundary", () => {
    expect(validateJsonObject({ kind: "object", fields: { number: { kind: "number", value: "-1.25e+3" }, array: { kind: "array", values: [{ kind: "boolean", value: false }] } } })).toMatchObject({ ok: true });
    const invalid = [
      { kind: "string", value: 1 },
      { kind: "boolean", value: "true" },
      { kind: "number", value: "NaN" },
      { kind: "number", value: "1".repeat(ProtocolLimits.maxJsonNumberChars + 1) },
      { kind: "array", values: {} },
      { kind: "object", fields: null },
      { kind: "object", fields: { "": { kind: "null" } } },
      { kind: "object", fields: { ["f".repeat(ProtocolLimits.maxJsonFieldNameCodePoints + 1)]: { kind: "null" } } },
      { kind: "object", fields: { "bad\u0000field": { kind: "null" } } },
    ];
    for (const value of invalid) expect(validateJsonObject(value)).toMatchObject({ ok: false });
  });

  it("rejects every missing required text field in a known wire frame", () => {
    const cases: readonly [Record<string, unknown>, string][] = [
      [{ type: "hello", protocolVersion: "1" }, "deviceId"],
      [{ type: "hello", deviceId: "phone-1" }, "protocolVersion"],
      [{ type: "paired" }, "sessionId"],
      [{ type: "command-result", ok: true, detail: "done" }, "id"],
      [{ type: "mission-begin", fileName: "route.kmz", size: 1, sha256: "a".repeat(64) }, "id"],
      [{ type: "mission-begin", id: "mission-1", size: 1, sha256: "a".repeat(64) }, "fileName"],
      [{ type: "mission-begin", id: "mission-1", fileName: "route.kmz", size: 1 }, "sha256"],
      [{ type: "mission-chunk", data: "AA==" }, "id"],
      [{ type: "mission-chunk", id: "mission-1" }, "data"],
      [{ type: "mission-complete" }, "id"],
      [{ type: "mission-result", ok: true, detail: "done" }, "id"],
      [{ type: "mission-phase", missionRevision: 1, deviceGeneration: 0, sequence: 1, fileName: "route.kmz" }, "phase"],
      [{ type: "mission-phase", missionRevision: 1, deviceGeneration: 0, sequence: 1, phase: "START_POINT_REACHED" }, "fileName"],
      [{ type: "diagnostic-report", events: [] }, "runId"],
      [{ type: "diagnostic-ack", acknowledgedSequence: 0 }, "runId"],
    ];
    for (const [frame, field] of cases) {
      expect(RelayFrameCodec.decode(new TextEncoder().encode(JSON.stringify(frame)))).toEqual({ kind: "rejected", error: { code: "INVALID_FIELD", message: `Field ${field} must be text` } });
    }
  });

  it("rejects every non-integer mission-phase counter received on the wire", () => {
    const phase = { type: "mission-phase", missionRevision: 1, deviceGeneration: 0, sequence: 1, phase: "START_POINT_REACHED", fileName: "route.kmz" };
    for (const field of ["missionRevision", "deviceGeneration", "sequence"] as const) {
      const malformed = { ...phase, [field]: "1" };
      expect(RelayFrameCodec.decode(new TextEncoder().encode(JSON.stringify(malformed)))).toEqual({ kind: "rejected", error: { code: "INVALID_FIELD", message: "Mission phase fields must be integers" } });
    }
  });

  it("rejects every non-object command fields container supplied to frame validation", () => {
    for (const fields of [null, "fields", 1, [], true]) {
      const frame = { type: "command", id: "command-1", command: { name: "camera.start", fields } };
      expect(validate(frame as never)).toEqual({ ok: false, error: { code: "INVALID_FIELD", message: "Command fields must be an object" } });
    }
  });

  it("accepts each documented diagnostic level and rejects an unlisted level", () => {
    const event = { sequence: 1, timestampMillis: 0, module: "relay-gateway", eventCode: "STARTED", operationId: null, safeDetail: "connected" };
    for (const level of ["DEBUG", "INFO", "WARN", "ERROR"] as const) {
      expect(validate({ type: "diagnostic-report", runId: "run-1", events: [{ ...event, level }] })).toMatchObject({ ok: true });
    }
    expect(validate({ type: "diagnostic-report", runId: "run-1", events: [{ ...event, level: "TRACE" }] } as never)).toEqual({ ok: false, error: { code: "INVALID_DIAGNOSTIC_REPORT", message: "Diagnostic event is invalid" } });
  });

  it("normalizes pairing, telemetry, and result frame field combinations independently", () => {
    expect(validate({ type: "paired", sessionId: "session-1", protocolVersion: null })).toMatchObject({ ok: true });
    expect(validate({ type: "paired", sessionId: "session-1" })).toMatchObject({ ok: true, value: { protocolVersion: null } });
    for (const protocolVersion of ["2", 1, true]) expect(validate({ type: "paired", sessionId: "session-1", protocolVersion } as never)).toMatchObject({ ok: false });
    const objectPayload = { kind: "object", fields: {} } as const;
    expect(validate({ type: "telemetry", payload: objectPayload, capabilities: objectPayload })).toMatchObject({ ok: true });
    for (const [payload, capabilities] of [[{ kind: "string", value: "bad" }, objectPayload], [objectPayload, { kind: "array", values: [] }]] as const) {
      expect(validate({ type: "telemetry", payload, capabilities } as never)).toEqual({ ok: false, error: { code: "INVALID_FIELD", message: "Telemetry fields must be objects" } });
    }
    for (const type of ["command-result", "mission-result"] as const) {
      expect(validate({ type, id: "result-1", ok: "true", detail: "done" } as never)).toEqual({ ok: false, error: { code: "INVALID_FIELD", message: "Field ok must be boolean" } });
      expect(validate({ type, id: "result-1", ok: true, detail: 1 } as never)).toEqual({ ok: false, error: { code: "INVALID_RESULT_DETAIL", message: "Result detail is invalid" } });
    }
    expect(validate({ type: "command-result", id: "result-1", ok: true, detail: "done", result: { kind: "array", values: [] } } as never)).toEqual({ ok: false, error: { code: "INVALID_FIELD", message: "Command result must be an object" } });
  });

  it("enforces mission transfer and diagnostic acknowledgement boundaries independently", () => {
    const begin = { type: "mission-begin" as const, id: "mission-1", fileName: "route.kmz", size: 1, sha256: "a".repeat(64) };
    expect(validate(begin)).toMatchObject({ ok: true });
    for (const fileName of ["route.zip", "../route.kmz", "folder/route.kmz", "route.kmz\u0000"]) expect(validate({ ...begin, fileName })).toEqual({ ok: false, error: { code: "INVALID_FILE_NAME", message: "Mission file name is invalid" } });
    for (const size of [0, ProtocolLimits.maxMissionBytes + 1, 1.5, "1"]) expect(validate({ ...begin, size } as never)).toMatchObject({ ok: false });
    for (const sha256 of ["A".repeat(64), "a".repeat(63), "z".repeat(64)]) expect(validate({ ...begin, sha256 })).toEqual({ ok: false, error: { code: "INVALID_SHA256", message: "Mission SHA-256 is invalid" } });
    expect(validate({ type: "mission-chunk", id: "mission-1", data: new Uint8Array([1]) })).toMatchObject({ ok: true });
    expect(validate({ type: "mission-chunk", id: "mission-1", data: new Uint8Array() })).toEqual({ ok: false, error: { code: "EMPTY_CHUNK", message: "Mission chunk is empty" } });
    expect(validate({ type: "mission-chunk", id: "mission-1", data: new Uint8Array(ProtocolLimits.maxMissionChunkBytes + 1) })).toEqual({ ok: false, error: { code: "CHUNK_TOO_LARGE", message: "Mission chunk is too large" } });
    expect(validate({ type: "mission-chunk", id: "mission-1", data: [] } as never)).toEqual({ ok: false, error: { code: "INVALID_FIELD", message: "Mission chunk is invalid" } });
    for (const acknowledgedSequence of [0, 1]) expect(validate({ type: "diagnostic-ack", runId: "run-1", acknowledgedSequence })).toMatchObject({ ok: true });
    expect(validate({ type: "diagnostic-ack", runId: "run-1", acknowledgedSequence: -1 })).toEqual({ ok: false, error: { code: "INVALID_DIAGNOSTIC_ACKNOWLEDGEMENT", message: "Diagnostic acknowledgement sequence is invalid" } });
    expect(validate({ type: "diagnostic-ack", runId: "run-1", acknowledgedSequence: 1.5 } as never)).toEqual({ ok: false, error: { code: "INVALID_FIELD", message: "Diagnostic acknowledgement sequence must be an integer" } });
  });

  it("accepts only canonical Base64 mission chunks received on the wire", () => {
    const decodeChunk = (data: string) => RelayFrameCodec.decode(new TextEncoder().encode(JSON.stringify({ type: "mission-chunk", id: "mission-1", data })));
    expect(decodeChunk("AA==")).toMatchObject({ kind: "decoded", frame: { type: "mission-chunk", id: "mission-1", data: new Uint8Array([0]) } });
    expect(decodeChunk("")).toEqual({ kind: "rejected", error: { code: "EMPTY_CHUNK", message: "Mission chunk is empty" } });
    for (const data of ["A", "AA", "A===", "!!!!", "AA=A"]) {
      expect(decodeChunk(data)).toEqual({ kind: "rejected", error: { code: "INVALID_BASE64", message: "Mission chunk is not valid Base64" } });
    }
    expect(decodeChunk("A".repeat(ProtocolLimits.maxMissionChunkBase64Chars + 1))).toEqual({ kind: "rejected", error: { code: "CHUNK_TOO_LARGE", message: "Mission chunk is too large" } });
  });

  it("distinguishes invalid in-memory types from ignored future wire frame types", () => {
    expect(validate(null as never)).toEqual({ ok: false, error: { code: "INVALID_FIELD", message: "Frame is invalid" } });
    expect(validate({ type: 1 } as never)).toEqual({ ok: false, error: { code: "INVALID_FIELD", message: "Frame type is invalid" } });
    for (const type of ["", "bad\u0000type", "t".repeat(ProtocolLimits.maxMessageTypeCodePoints + 1), "future-message"]) {
      expect(validate({ type } as never)).toEqual({ ok: false, error: { code: "INVALID_MESSAGE_TYPE", message: "Message type is invalid" } });
    }
    const decode = (value: unknown) => RelayFrameCodec.decode(new TextEncoder().encode(JSON.stringify(value)));
    expect(decode({ type: 1 })).toEqual({ kind: "rejected", error: { code: "INVALID_FIELD", message: "Field type must be text" } });
    expect(decode({ type: "" })).toEqual({ kind: "rejected", error: { code: "INVALID_MESSAGE_TYPE", message: "Message type is invalid" } });
    expect(decode({ type: "future-message" })).toEqual({ kind: "ignored", type: "future-message" });
  });

  it("enforces every mission phase state field independently", () => {
    const phase = { type: "mission-phase" as const, missionRevision: 1, deviceGeneration: 0, sequence: 1, phase: "START_POINT_REACHED" as const, fileName: "route.kmz" };
    expect(validate(phase)).toMatchObject({ ok: true });
    expect(validate({ ...phase, phase: "ROUTE_EXECUTION_STARTED" })).toMatchObject({ ok: true });
    for (const missionRevision of [0, -1, 1.5, "1"]) expect(validate({ ...phase, missionRevision } as never)).toEqual({ ok: false, error: { code: "INVALID_FIELD", message: "Mission phase is invalid" } });
    for (const deviceGeneration of [-1, 1.5, "0"]) expect(validate({ ...phase, deviceGeneration } as never)).toEqual({ ok: false, error: { code: "INVALID_FIELD", message: "Mission phase is invalid" } });
    for (const sequence of [0, -1, 1.5, "1"]) expect(validate({ ...phase, sequence } as never)).toEqual({ ok: false, error: { code: "INVALID_FIELD", message: "Mission phase is invalid" } });
    expect(validate({ ...phase, phase: "UNKNOWN" } as never)).toEqual({ ok: false, error: { code: "INVALID_FIELD", message: "Mission phase is invalid" } });
    expect(validate({ ...phase, fileName: "route.zip" })).toEqual({ ok: false, error: { code: "INVALID_FIELD", message: "Mission phase is invalid" } });
  });

  it("enforces command names and command field-name boundaries independently", () => {
    const command = { type: "command" as const, id: "command-1", command: { name: "camera.start", fields: { mode: { kind: "string" as const, value: "photo" } } } };
    expect(validate(command)).toMatchObject({ ok: true });
    for (const name of ["", "bad\u0000name", "n".repeat(ProtocolLimits.maxCommandNameCodePoints + 1)]) expect(validate({ ...command, command: { ...command.command, name } })).toEqual({ ok: false, error: { code: "INVALID_COMMAND_NAME", message: "Command name is invalid" } });
    expect(validate({ ...command, command: { name: "camera.start", fields: { name: { kind: "string", value: "reserved" } } } } as never)).toEqual({ ok: false, error: { code: "INVALID_FIELD", message: "Command fields contain a reserved name" } });
    for (const key of ["", "bad\u0000field", "f".repeat(ProtocolLimits.maxJsonFieldNameCodePoints + 1)]) {
      expect(validate({ ...command, command: { name: "camera.start", fields: { [key]: { kind: "null" } } } } as never)).toEqual({ ok: false, error: { code: "INVALID_FIELD", message: "JSON field name is invalid" } });
    }
  });

  it("defensively copies every accepted JSON container and rejects scalar-shape mismatches", () => {
    const nestedArray = { kind: "array", values: [{ kind: "string", value: "first" }] } as const;
    const input = { kind: "object", fields: { nestedArray } } as const;
    const result = validateJsonObject(input);
    expect(result).toMatchObject({ ok: true, value: { kind: "object", fields: { nestedArray: { kind: "array", values: [{ kind: "string", value: "first" }] } } } });
    if (!result.ok) throw new Error("expected normalized object");
    expect(result.value.fields.nestedArray).not.toBe(nestedArray);
    expect(result.value.fields.nestedArray.kind).toBe("array");
    if (result.value.fields.nestedArray.kind !== "array") throw new Error("expected array");
    expect(result.value.fields.nestedArray.values).not.toBe(nestedArray.values);
    expect(Object.isFrozen(result.value.fields.nestedArray.values)).toBe(true);

    const invalid: readonly unknown[] = [
      { kind: "string", value: 1 },
      { kind: "boolean", value: "false" },
      { kind: "number", value: 1 },
      { kind: "number", value: "01" },
      { kind: "number", value: "1." },
      { kind: "number", value: ".1" },
      { kind: "number", value: "1e" },
      { kind: "array", values: {} },
      { kind: "object", fields: [] },
      { kind: "object", fields: { field: { kind: "unknown" } } },
    ];
    for (const value of invalid) expect(validateJsonObject(value)).toMatchObject({ ok: false });
  });

  it("enforces exact JSON and diagnostic identifier boundaries", () => {
    const maxText = "x".repeat(ProtocolLimits.maxJsonStringCodePoints);
    expect(validateJsonObject({ kind: "object", fields: { text: { kind: "string", value: maxText } } })).toMatchObject({ ok: true });
    expect(validateJsonObject({ kind: "object", fields: { text: { kind: "string", value: `${maxText}x` } } })).toEqual({ ok: false, error: { code: "INVALID_JSON", message: "JSON string is too long" } });
    const maxNumber = "1".repeat(ProtocolLimits.maxJsonNumberChars);
    expect(validateJsonObject({ kind: "object", fields: { number: { kind: "number", value: maxNumber } } })).toMatchObject({ ok: true });
    expect(validateJsonObject({ kind: "object", fields: { number: { kind: "number", value: `${maxNumber}1` } } })).toEqual({ ok: false, error: { code: "INVALID_JSON", message: "JSON number is invalid" } });
    const event = { sequence: 1, timestampMillis: 0, level: "INFO", module: "A", eventCode: "A", operationId: null, safeDetail: "ok" };
    expect(validate({ type: "diagnostic-report", runId: "run-1", events: [event] })).toMatchObject({ ok: true });
    for (const candidate of [
      { ...event, module: "" },
      { ...event, module: "1invalid" },
      { ...event, module: "bad space" },
      { ...event, module: "A".repeat(ProtocolLimits.maxDiagnosticModuleCodePoints + 1) },
      { ...event, eventCode: "" },
      { ...event, eventCode: "1invalid" },
      { ...event, eventCode: "bad space" },
      { ...event, eventCode: "A".repeat(ProtocolLimits.maxDiagnosticEventCodePoints + 1) },
    ]) {
      expect(validate({ type: "diagnostic-report", runId: "run-1", events: [candidate] } as never)).toEqual({ ok: false, error: { code: "INVALID_DIAGNOSTIC_REPORT", message: "Diagnostic event is invalid" } });
    }
  });

  it("preserves copy isolation for mission chunks supplied by callers", () => {
    const source = new Uint8Array([1, 2, 3]);
    const normalized = validate({ type: "mission-chunk", id: "mission-1", data: source });
    expect(normalized).toMatchObject({ ok: true });
    source[0] = 9;
    if (!normalized.ok || normalized.value.type !== "mission-chunk") throw new Error("expected mission chunk");
    expect([...normalized.value.data]).toEqual([1, 2, 3]);
    expect(normalized.value.data).not.toBe(source);
  });

  it("rejects whitespace-only identifiers while preserving the precise public error", () => {
    for (const value of ["", " ", "\t"]) {
      expect(validate({ type: "hello", deviceId: value, protocolVersion: "1" })).toEqual({ ok: false, error: { code: "INVALID_DEVICE_ID", message: "Device ID is invalid" } });
    }
  });

  it("classifies each malformed diagnostic field as a structural protocol error", () => {
    const validEvent = { sequence: 1, timestampMillis: 0, level: "INFO", module: "relay", eventCode: "READY", operationId: null, safeDetail: "ready" };
    const malformed = [
      { ...validEvent, sequence: undefined },
      { ...validEvent, sequence: NaN },
      { ...validEvent, sequence: Infinity },
      { ...validEvent, sequence: 1.5 },
      { ...validEvent, timestampMillis: undefined },
      { ...validEvent, timestampMillis: NaN },
      { ...validEvent, timestampMillis: Infinity },
      { ...validEvent, timestampMillis: 0.5 },
      { ...validEvent, level: undefined },
      { ...validEvent, module: undefined },
      { ...validEvent, eventCode: undefined },
      { ...validEvent, safeDetail: undefined },
      { ...validEvent, operationId: false },
    ];
    for (const event of malformed) {
      expect(validate({ type: "diagnostic-report", runId: "run-1", events: [event] } as never)).toEqual({ ok: false, error: { code: "INVALID_FIELD", message: "Diagnostic event fields are invalid" } });
    }
  });

  it("classifies each invalid diagnostic value as a diagnostic-domain error", () => {
    const validEvent = { sequence: 1, timestampMillis: 0, level: "INFO", module: "relay", eventCode: "READY", operationId: null, safeDetail: "ready" };
    const invalid = [
      { ...validEvent, sequence: 0 },
      { ...validEvent, timestampMillis: -1 },
      { ...validEvent, level: "TRACE" },
      { ...validEvent, module: "1relay" },
      { ...validEvent, eventCode: "1READY" },
      { ...validEvent, operationId: " " },
      { ...validEvent, safeDetail: "bad\u0000detail" },
      { ...validEvent, safeDetail: "d".repeat(ProtocolLimits.maxDiagnosticDetailCodePoints + 1) },
    ];
    for (const event of invalid) {
      expect(validate({ type: "diagnostic-report", runId: "run-1", events: [event] } as never)).toEqual({ ok: false, error: { code: "INVALID_DIAGNOSTIC_REPORT", message: "Diagnostic event is invalid" } });
    }
  });
});
