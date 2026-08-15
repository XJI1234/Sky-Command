import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { RelayFrameCodec, validate } from "../src/modules/relay-link/protocol-core/index.js";

const bytes = (source: string): Uint8Array => new TextEncoder().encode(source);
const telemetry = (payload: unknown, capabilities: unknown = { kind: "object", fields: {} }) => ({ type: "telemetry" as const, payload, capabilities });

describe("relay-link/protocol-core robustness contract", () => {
  it.each([
    "{\"type\":\"hello\",\"deviceId\":\"x\\q\",\"protocolVersion\":\"1\"}",
    "{\"type\":\"hello\",\"deviceId\":\"x\\u00zz\",\"protocolVersion\":\"1\"}",
    "{\"type\":\"hello\",\"deviceId\":\"x\\\",\"protocolVersion\":\"1\"}",
    "{\"type\":\"hello\",\"deviceId\":\"x\u0001\",\"protocolVersion\":\"1\"}",
    "{\"type\":\"hello\" \"deviceId\":\"x\",\"protocolVersion\":\"1\"}",
    "{\"type\":\"hello\",\"deviceId\":\"x\" \"protocolVersion\":\"1\"}",
    "{\"type\":\"hello\",\"deviceId\":\"x\",\"protocolVersion\":\"1\"",
  ])("rejects invalid JSON syntax %#", (source) => {
    expect(RelayFrameCodec.decode(bytes(source))).toMatchObject({ kind: "rejected", error: { code: "INVALID_JSON" } });
  });

  it("parses every legal JSON escape before routing an unknown message", () => {
    const source = '{"type":"future-message","value":"q\\\"\\\\\\/\\b\\f\\n\\r\\t\\u0041"}';
    expect(RelayFrameCodec.decode(bytes(source))).toMatchObject({ kind: "ignored", type: "future-message" });
  });

  it.each([
    [null, "INVALID_FIELD"],
    [{ type: 1 }, "INVALID_FIELD"],
    [{ type: "" }, "INVALID_MESSAGE_TYPE"],
    [{ type: "unsupported" }, "INVALID_MESSAGE_TYPE"],
    [telemetry({ kind: "array", values: "not-array" }), "INVALID_FIELD"],
    [telemetry({ kind: "object", fields: [] }), "INVALID_FIELD"],
    [telemetry({ kind: "object", fields: { child: { kind: "unknown" } } }), "INVALID_JSON"],
    [telemetry({ kind: "object", fields: { child: { kind: "string", value: 1 } } }), "INVALID_FIELD"],
    [telemetry({ kind: "object", fields: { child: { kind: "boolean", value: "yes" } } }), "INVALID_FIELD"],
    [{ type: "command", id: "x", command: { name: "go", fields: [] } }, "INVALID_FIELD"],
    [{ type: "command", id: "x", command: { name: "go", fields: { "": { kind: "null" } } } }, "INVALID_FIELD"],
    [{ type: "command-result", id: "", ok: true, detail: "" }, "INVALID_MESSAGE_ID"],
    [{ type: "command-result", id: "x", ok: "yes", detail: "" }, "INVALID_FIELD"],
    [{ type: "mission-begin", id: "", fileName: "route.kmz", size: 1, sha256: "a".repeat(64) }, "INVALID_MESSAGE_ID"],
    [{ type: "mission-begin", id: "x", fileName: "route.kmz", size: 1.5, sha256: "a".repeat(64) }, "INVALID_FIELD"],
    [{ type: "mission-complete", id: "" }, "INVALID_MESSAGE_ID"],
  ] as const)("rejects direct invalid shape %#", (frame, code) => {
    expect(validate(frame as never)).toMatchObject({ ok: false, error: { code } });
  });

  it("returns a stable result when getters, command fields, and buffers are hostile", () => {
    const paired = new Proxy({ type: "paired", sessionId: "x", protocolVersion: "1" }, { get(_, key) { if (key === "protocolVersion") throw new Error("sensitive"); return Reflect.get(_, key); } });
    expect(validate(paired as never)).toMatchObject({ ok: false, error: { code: "INVALID_FIELD" } });
    expect(validate({ type: "command", id: "x", command: new Proxy({}, { get() { throw new Error("sensitive"); } }) } as never)).toMatchObject({ ok: false });
    expect(RelayFrameCodec.decode(null as never)).toMatchObject({ kind: "rejected", error: { code: "INVALID_FIELD" } });
  });

  it.each(["sequence", "timestampMillis", "level", "module", "eventCode", "operationId", "safeDetail"])("rejects an unreadable diagnostic event %s field", (field) => {
    const event = new Proxy({ sequence: 1, timestampMillis: 1, level: "INFO", module: "relay", eventCode: "READY", operationId: null, safeDetail: "ready" }, {
      get(target, key) {
        if (key === field) throw new Error("unreadable");
        return target[key as keyof typeof target];
      },
    });
    expect(validate({ type: "diagnostic-report", runId: "run-1", events: [event] } as never)).toMatchObject({ ok: false, error: { code: "INVALID_FIELD" } });
  });

  it("handles every JSON value family and rejects hostile nested containers", () => {
    const valid = validate(telemetry({ kind: "object", fields: {
      rawNull: null,
      rawString: "text",
      rawNumber: 42,
      rawBoolean: false,
      array: { kind: "array", values: [{ kind: "null" }, { kind: "boolean", value: true }] },
      object: { kind: "object", fields: { value: { kind: "number", value: "1" } } },
    } }));
    expect(valid).toMatchObject({ ok: true });
    const unreadableKind = new Proxy({}, { get() { throw new Error("sensitive"); } });
    const unreadableFields = new Proxy({}, { ownKeys() { throw new Error("sensitive"); } });
    expect(validate(telemetry({ kind: "object", fields: { bad: unreadableKind } }))).toMatchObject({ ok: false, error: { code: "INVALID_FIELD" } });
    expect(validate(telemetry({ kind: "object", fields: unreadableFields }))).toMatchObject({ ok: false, error: { code: "INVALID_FIELD" } });
    expect(validate(telemetry({ kind: "array", values: [{ kind: "unknown" }] }))).toMatchObject({ ok: false, error: { code: "INVALID_JSON" } });
    expect(validate(telemetry({ kind: "object", fields: { long: "a".repeat(65_537) } }))).toMatchObject({ ok: false, error: { code: "INVALID_JSON" } });
  });

  it("covers parser arrays, numbers, incomplete strings, and object separators", () => {
    expect(RelayFrameCodec.decode(bytes("\""))).toMatchObject({ kind: "rejected", error: { code: "INVALID_JSON" } });
    expect(RelayFrameCodec.decode(bytes("-"))).toMatchObject({ kind: "rejected", error: { code: "INVALID_JSON" } });
    expect(RelayFrameCodec.decode(bytes("[1,2]"))).toMatchObject({ kind: "rejected", error: { code: "INVALID_JSON" } });
    expect(RelayFrameCodec.decode(bytes('{"type":"unknown","a":1,"b":2}'))).toMatchObject({ kind: "ignored" });
    expect(RelayFrameCodec.decode(bytes('{"type":"unknown","a":}'))).toMatchObject({ kind: "rejected", error: { code: "INVALID_JSON" } });
    expect(RelayFrameCodec.decode(bytes('{"type":"unknown",1:2}'))).toMatchObject({ kind: "rejected", error: { code: "INVALID_JSON" } });
    expect(RelayFrameCodec.decode(bytes('{"type":"unknown","a":[1;2]}'))).toMatchObject({ kind: "rejected", error: { code: "INVALID_JSON" } });
    expect(RelayFrameCodec.decode(bytes('{"type" "unknown"}'))).toMatchObject({ kind: "rejected", error: { code: "INVALID_JSON" } });
    const deeplyNested = "[".repeat(33) + "0" + "]".repeat(33);
    expect(RelayFrameCodec.decode(bytes(`{"type":"telemetry","payload":${deeplyNested},"capabilities":{}}`))).toMatchObject({ kind: "rejected", error: { code: "INVALID_JSON" } });
  });

  it("rejects null command containers, invalid chunk data, and result details with control characters", () => {
    expect(validate({ type: "command", id: "x", command: null } as never)).toMatchObject({ ok: false, error: { code: "INVALID_FIELD" } });
    expect(validate({ type: "command", id: "x", command: { name: "go", fields: new Proxy({}, { ownKeys() { throw new Error("sensitive"); } }) } } as never)).toMatchObject({ ok: false, error: { code: "INVALID_FIELD" } });
    expect(validate({ type: "mission-chunk", id: "x", data: {} } as never)).toMatchObject({ ok: false, error: { code: "INVALID_FIELD" } });
    expect(validate({ type: "mission-result", id: "x", ok: false, detail: "bad\ntext" })).toMatchObject({ ok: false, error: { code: "INVALID_RESULT_DETAIL" } });
    expect(RelayFrameCodec.decode(bytes('{"type":"command-result","id":"x","ok":true}'))).toMatchObject({ kind: "decoded", frame: { detail: "" } });
  });

  it("keeps secondary telemetry and command-field failures isolated", () => {
    expect(validate(telemetry({ kind: "object", fields: {} }, Symbol("unsupported")))).toMatchObject({ ok: false, error: { code: "INVALID_JSON" } });
    expect(validate({ type: "command", id: "x", command: { name: "go", fields: { bad: { kind: "unknown" } } } } as never)).toMatchObject({ ok: false, error: { code: "INVALID_JSON" } });
    const manyFields: Record<string, null> = {};
    for (let index = 0; index < 4_093; index += 1) manyFields[`f${index}`] = null;
    expect(validate({ type: "command", id: "x", command: { name: "go", fields: manyFields } } as never)).toMatchObject({ ok: false, error: { code: "INVALID_JSON" } });
  });

  it("handles omitted pairing versions and rejects each required decoder field", () => {
    expect(validate({ type: "paired", sessionId: "x", protocolVersion: undefined } as never)).toMatchObject({ ok: true, value: { protocolVersion: null } });
    expect(RelayFrameCodec.decode(bytes('{"type":1}'))).toMatchObject({ kind: "rejected", error: { code: "INVALID_FIELD" } });
    expect(RelayFrameCodec.decode(bytes('{"type":"\\n"}'))).toMatchObject({ kind: "rejected", error: { code: "INVALID_MESSAGE_TYPE" } });
    expect(RelayFrameCodec.decode(bytes('{"type":"telemetry","payload":{},"capabilities":[]}'))).toMatchObject({ kind: "rejected", error: { code: "INVALID_FIELD" } });
    expect(RelayFrameCodec.decode(bytes('{"type":"command","id":"x","command":[]}'))).toMatchObject({ kind: "rejected", error: { code: "INVALID_FIELD" } });
    expect(RelayFrameCodec.decode(bytes('{"type":"mission-chunk","id":"x","data":1}'))).toMatchObject({ kind: "rejected", error: { code: "INVALID_FIELD" } });
  });

  it("covers known command and result decoder error branches", () => {
    expect(RelayFrameCodec.decode(bytes('{"type":"command","id":"","command":{"name":"go"}}'))).toMatchObject({ kind: "rejected", error: { code: "INVALID_MESSAGE_ID" } });
    expect(RelayFrameCodec.decode(bytes('{"type":"command-result","id":"x","ok":true,"detail":7}'))).toMatchObject({ kind: "rejected", error: { code: "INVALID_FIELD" } });
    expect(RelayFrameCodec.decode(bytes('{"type":"command-result","id":"x","ok":true,"detail":"done"}'))).toMatchObject({ kind: "decoded", frame: { detail: "done" } });
    expect(RelayFrameCodec.decode(bytes('{"type":"command-result","id":"x","ok":true,"detail":"done","result":"not-an-object"}'))).toMatchObject({ kind: "rejected", error: { code: "INVALID_FIELD" } });
    expect(RelayFrameCodec.decode(bytes(`{"type":"mission-begin","id":"x","fileName":"route.kmz","size":9007199254740992,"sha256":"${"a".repeat(64)}"}`))).toMatchObject({ kind: "rejected", error: { code: "INVALID_FIELD" } });
  });

  it("rejects invalid frames before attempting to encode them", () => {
    expect(RelayFrameCodec.encode({ type: "hello", deviceId: "", protocolVersion: "1" })).toMatchObject({ ok: false, error: { code: "INVALID_DEVICE_ID" } });
  });

  it("returns a protocol error when the platform encoder fails", () => {
    const original = TextEncoder.prototype.encode;
    TextEncoder.prototype.encode = () => { throw new Error("encoder unavailable"); };
    try {
      expect(RelayFrameCodec.encode({ type: "hello", deviceId: "x", protocolVersion: "1" })).toMatchObject({ ok: false, error: { code: "INVALID_JSON" } });
    } finally {
      TextEncoder.prototype.encode = original;
    }
  });

  it("encodes every JSON value family and absorbs hostile typed-array traps", () => {
    const frame = {
      type: "telemetry" as const,
      payload: { kind: "object" as const, fields: { disabled: { kind: "boolean" as const, value: false }, list: { kind: "array" as const, values: [{ kind: "null" as const }] } } },
      capabilities: { kind: "object" as const, fields: {} },
    };
    expect(RelayFrameCodec.encode(frame)).toMatchObject({ ok: true });
    expect(RelayFrameCodec.encode({ type: "telemetry", payload: { kind: "object", fields: { raw: false } }, capabilities: { kind: "object", fields: {} } } as never)).toMatchObject({ ok: true });
    const hostileData = new Proxy(new Uint8Array([1]), { getPrototypeOf() { throw new Error("sensitive"); } });
    expect(validate({ type: "mission-chunk", id: "x", data: hostileData } as never)).toMatchObject({ ok: false, error: { code: "INVALID_FIELD" } });
  });

  it("reaches defensive JSON object, scalar, and nesting rejection paths", () => {
    let tooDeep: unknown = { kind: "null" };
    for (let index = 0; index < 33; index += 1) tooDeep = { kind: "object", fields: { child: tooDeep } };
    expect(validate(telemetry(tooDeep))).toMatchObject({ ok: false, error: { code: "INVALID_JSON" } });
    expect(validate(telemetry(undefined))).toMatchObject({ ok: false, error: { code: "INVALID_JSON" } });
    expect(validate(telemetry({ kind: "number", get value() { throw new Error("sensitive"); } }))).toMatchObject({ ok: false, error: { code: "INVALID_FIELD" } });
    expect(validate(telemetry({ kind: "object", get fields() { throw new Error("sensitive"); } }))).toMatchObject({ ok: false, error: { code: "INVALID_FIELD" } });
    expect(validate({ type: "paired", sessionId: "x", protocolVersion: "2" })).toMatchObject({ ok: false, error: { code: "PROTOCOL_VERSION_UNSUPPORTED" } });
  });

  it("never throws for generated untrusted frames or byte strings", () => {
    const values = fc.sample(fc.anything({ maxDepth: 5, withBigInt: false, withMap: false, withSet: false }), 250);
    for (const value of values) expect(() => validate(value as never)).not.toThrow();
    const sources = fc.sample(fc.string({ maxLength: 256 }), 250);
    for (const source of sources) expect(() => RelayFrameCodec.decode(new TextEncoder().encode(source))).not.toThrow();
  });

  it("preserves all JSON string escape meanings through a known wire frame", () => {
    const cases: readonly [string, string][] = [
      ['relay\\"quote', 'relay"quote'],
      ['relay\\\\slash', 'relay\\slash'],
      ['relay\\/solidus', 'relay/solidus'],
      ['relay\\u0061', 'relaya'],
      ['relay\\u0041', 'relayA'],
    ];
    for (const [escaped, expected] of cases) {
      const decoded = RelayFrameCodec.decode(bytes(`{"type":"hello","deviceId":"${escaped}","protocolVersion":"1"}`));
      expect(decoded).toEqual({ kind: "decoded", frame: { type: "hello", deviceId: expected, protocolVersion: "1" } });
    }
    for (const escape of ['\\q', '\\u0', '\\u000', '\\u000z', '\\x00']) {
      expect(RelayFrameCodec.decode(bytes(`{"type":"hello","deviceId":"relay${escape}","protocolVersion":"1"}`))).toEqual({ kind: "rejected", error: { code: "INVALID_JSON", message: "Frame is not valid JSON" } });
    }
  });

  it("preserves every accepted JSON number spelling and rejects near-miss lexemes", () => {
    const accepted: readonly [string, string][] = [
      ['0', '0'], ['-0', '-0'], ['1', '1'], ['-1', '-1'], ['1.5', '1.5'], ['-1.5', '-1.5'], ['1e2', '1e2'], ['1E+2', '1E+2'], ['-1.5e-2', '-1.5e-2'],
    ];
    for (const [source, expected] of accepted) {
      const decoded = RelayFrameCodec.decode(bytes(`{"type":"telemetry","payload":{"n":${source}},"capabilities":{}}`));
      expect(decoded).toEqual({ kind: "decoded", frame: { type: "telemetry", payload: { kind: "object", fields: { n: { kind: "number", value: expected } } }, capabilities: { kind: "object", fields: {} } } });
    }
    for (const source of ['01', '-01', '1.', '.1', '1e', '1e+', '--1']) {
      expect(RelayFrameCodec.decode(bytes(`{"type":"telemetry","payload":{"n":${source}},"capabilities":{}}`))).toEqual({ kind: "rejected", error: { code: "INVALID_JSON", message: "Frame is not valid JSON" } });
    }
  });

  it("preserves nested array and object values while rejecting malformed delimiters", () => {
    const valid = RelayFrameCodec.decode(bytes('{"type":"telemetry","payload":{"items":[1,{"enabled":true},null]},"capabilities":{}}'));
    expect(valid).toEqual({ kind: "decoded", frame: {
      type: "telemetry",
      payload: { kind: "object", fields: { items: { kind: "array", values: [{ kind: "number", value: "1" }, { kind: "object", fields: { enabled: { kind: "boolean", value: true } } }, { kind: "null" }] } } },
      capabilities: { kind: "object", fields: {} },
    } });
    for (const source of [
      '{"type":"telemetry","payload":{"items":[1,]},"capabilities":{}}',
      '{"type":"telemetry","payload":{"items":[,1]},"capabilities":{}}',
      '{"type":"telemetry","payload":{"items":[1 2]},"capabilities":{}}',
      '{"type":"telemetry","payload":{"items":{"a":1,}},"capabilities":{}}',
      '{"type":"telemetry","payload":{"items":{"a" 1}},"capabilities":{}}',
    ]) expect(RelayFrameCodec.decode(bytes(source))).toEqual({ kind: "rejected", error: { code: "INVALID_JSON", message: "Frame is not valid JSON" } });
  });

  it("round-trips every Base64 padding shape used for mission chunks", () => {
    for (const data of [new Uint8Array([0]), new Uint8Array([0, 1]), new Uint8Array([0, 1, 2]), new Uint8Array([0, 1, 2, 3])]) {
      const encoded = RelayFrameCodec.encode({ type: "mission-chunk", id: "mission-1", data });
      expect(encoded.ok).toBe(true);
      if (!encoded.ok) throw encoded.error;
      const decoded = RelayFrameCodec.decode(encoded.value);
      expect(decoded).toMatchObject({ kind: "decoded", frame: { type: "mission-chunk", id: "mission-1", data } });
    }
  });

  it("normalizes every JSON value family in compatible diagnostic-report extensions", () => {
    const source = '{"type":"diagnostic-report","runId":"run-1","events":[{"sequence":1,"timestampMillis":0,"level":"INFO","module":"relay","eventCode":"READY","operationId":null,"safeDetail":"ready","future":{"string":"value","number":1.5,"true":true,"false":false,"null":null,"array":[1,"two",false,{"nested":null}]}}]}';
    expect(RelayFrameCodec.decode(bytes(source))).toEqual({ kind: "decoded", frame: {
      type: "diagnostic-report",
      runId: "run-1",
      events: [{ sequence: 1, timestampMillis: 0, level: "INFO", module: "relay", eventCode: "READY", operationId: null, safeDetail: "ready" }],
    } });
  });
});
