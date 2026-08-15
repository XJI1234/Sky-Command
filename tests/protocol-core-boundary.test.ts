import { describe, expect, it } from "vitest";
import { ProtocolLimits, RelayFrameCodec, type JsonValue, validate } from "../src/modules/relay-link/protocol-core/index.js";

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
const nested = (depth: number): unknown => {
  let value: unknown = 0;
  for (let index = 0; index < depth; index += 1) value = { value };
  return value;
};

describe("relay-link/protocol-core defensive boundaries", () => {
  it.each([
    ["control identifier", { type: "mission-complete", id: "x\u0000" }, "INVALID_MESSAGE_ID"],
    ["long identifier", { type: "mission-complete", id: "x".repeat(129) }, "INVALID_MESSAGE_ID"],
    ["long type", { type: "x".repeat(65) }, "INVALID_MESSAGE_TYPE"],
    ["unsafe file slash", { type: "mission-begin", id: "x", fileName: "folder/route.kmz", size: 1, sha256: "a".repeat(64) }, "INVALID_FILE_NAME"],
    ["unsafe file backslash", { type: "mission-begin", id: "x", fileName: "folder\\route.kmz", size: 1, sha256: "a".repeat(64) }, "INVALID_FILE_NAME"],
    ["wrong extension", { type: "mission-begin", id: "x", fileName: "route.kml", size: 1, sha256: "a".repeat(64) }, "INVALID_FILE_NAME"],
    ["too large chunk", { type: "mission-chunk", id: "x", data: new Uint8Array(ProtocolLimits.maxMissionChunkBytes + 1) }, "CHUNK_TOO_LARGE"],
    ["nonfinite numeric JSON", { type: "telemetry", payload: { kind: "object", fields: { n: Number.NaN } }, capabilities: { kind: "object", fields: {} } }, "INVALID_JSON"],
    ["invalid numeric spelling", { type: "telemetry", payload: { kind: "object", fields: { n: { kind: "number", value: "01" } } }, capabilities: { kind: "object", fields: {} } }, "INVALID_JSON"],
    ["unsafe JSON field", { type: "telemetry", payload: { kind: "object", fields: { "\n": { kind: "null" } } }, capabilities: { kind: "object", fields: {} } }, "INVALID_FIELD"],
  ] as const)("rejects %s", (_, frame, code) => {
    expect(validate(frame as never)).toMatchObject({ ok: false, error: { code } });
  });

  it("rejects JSON depth, token, string, and field-name limit violations", () => {
    expect(RelayFrameCodec.decode(encode({ type: "telemetry", payload: nested(33), capabilities: {} }))).toMatchObject({ kind: "rejected", error: { code: "INVALID_JSON" } });
    expect(RelayFrameCodec.decode(encode({ type: "telemetry", payload: { ["a".repeat(129)]: 1 }, capabilities: {} }))).toMatchObject({ kind: "rejected", error: { code: "INVALID_JSON" } });
    expect(RelayFrameCodec.decode(encode({ type: "telemetry", payload: { value: "a".repeat(ProtocolLimits.maxJsonStringCodePoints + 1) }, capabilities: {} }))).toMatchObject({ kind: "rejected", error: { code: "INVALID_JSON" } });
    const tokenHeavy: Record<string, number> = {};
    for (let index = 0; index < 4_097; index += 1) tokenHeavy[`n${index}`] = index;
    expect(RelayFrameCodec.decode(encode({ type: "telemetry", payload: tokenHeavy, capabilities: {} }))).toMatchObject({ kind: "rejected", error: { code: "INVALID_JSON" } });
    expect(validate({ type: "telemetry", payload: { kind: "object", fields: tokenHeavy }, capabilities: { kind: "object", fields: {} } })).toMatchObject({ ok: false, error: { code: "INVALID_JSON" } });
    const exactBudgetThenNull = Array.from({ length: 8_182 }, () => null);
    expect(validate({ type: "telemetry", payload: { kind: "object", fields: { values: { kind: "array", values: exactBudgetThenNull } } }, capabilities: { kind: "object", fields: {} } })).toMatchObject({ ok: false, error: { code: "INVALID_JSON" } });
    const exactBudgetThenString = [...Array.from({ length: 8_181 }, () => null), "x"];
    expect(validate({ type: "telemetry", payload: { kind: "object", fields: { values: { kind: "array", values: exactBudgetThenString } } }, capabilities: { kind: "object", fields: {} } })).toMatchObject({ ok: false, error: { code: "INVALID_JSON" } });
    const exactBudgetThenBoolean = [...Array.from({ length: 8_181 }, () => null), true];
    expect(validate({ type: "telemetry", payload: { kind: "object", fields: { values: { kind: "array", values: exactBudgetThenBoolean } } }, capabilities: { kind: "object", fields: {} } })).toMatchObject({ ok: false, error: { code: "INVALID_JSON" } });
    const exactBudgetThenTypedNull = [...Array.from({ length: 8_181 }, () => null), { kind: "null" }];
    expect(validate({ type: "telemetry", payload: { kind: "object", fields: { values: { kind: "array", values: exactBudgetThenTypedNull } } }, capabilities: { kind: "object", fields: {} } })).toMatchObject({ ok: false, error: { code: "INVALID_JSON" } });
    const exactBudgetThenNumber = [...Array.from({ length: 8_181 }, () => null), { kind: "number", value: "1" }];
    expect(validate({ type: "telemetry", payload: { kind: "object", fields: { values: { kind: "array", values: exactBudgetThenNumber } } }, capabilities: { kind: "object", fields: {} } })).toMatchObject({ ok: false, error: { code: "INVALID_JSON" } });
    const exactBudgetThenObject = [...Array.from({ length: 8_180 }, () => null), { kind: "object", fields: {} }];
    expect(validate({ type: "telemetry", payload: { kind: "object", fields: { values: { kind: "array", values: exactBudgetThenObject } } }, capabilities: { kind: "object", fields: {} } })).toMatchObject({ ok: false, error: { code: "INVALID_JSON" } });
  });

  it("rejects every unsafe mission file-name form", () => {
    const base = { type: "mission-begin" as const, id: "x", size: 1, sha256: "a".repeat(64) };
    for (const fileName of ["", " ", "x".repeat(125) + ".kmz", "route.kml", "../route.kmz", "folder/route.kmz", "route\u0000.kmz"]) {
      expect(validate({ ...base, fileName })).toMatchObject({ ok: false, error: { code: "INVALID_FILE_NAME" } });
    }
  });

  it("rejects missing and mismatched known-frame fields", () => {
    const fixtures = [
      { type: "hello", deviceId: "x" },
      { type: "paired", sessionId: "x", protocolVersion: false },
      { type: "telemetry", payload: [], capabilities: {} },
      { type: "command", id: "x", command: { name: 1 } },
      { type: "command-result", id: "x", ok: "true", detail: "" },
      { type: "mission-begin", id: "x", fileName: "route.kmz", size: 1.2, sha256: "a".repeat(64) },
    ];
    for (const fixture of fixtures) expect(RelayFrameCodec.decode(encode(fixture))).toMatchObject({ kind: "rejected", error: { code: "INVALID_FIELD" } });
  });

  it("rejects empty, noncanonical, oversized, and oversized-frame Base64 input", () => {
    expect(RelayFrameCodec.decode(encode({ type: "mission-chunk", id: "x", data: "" }))).toMatchObject({ kind: "rejected", error: { code: "EMPTY_CHUNK" } });
    expect(RelayFrameCodec.decode(encode({ type: "mission-chunk", id: "x", data: "YQ=" }))).toMatchObject({ kind: "rejected", error: { code: "INVALID_BASE64" } });
    expect(RelayFrameCodec.decode(encode({ type: "mission-chunk", id: "x", data: "YR==" }))).toMatchObject({ kind: "rejected", error: { code: "INVALID_BASE64" } });
    expect(RelayFrameCodec.decode(encode({ type: "mission-chunk", id: "x", data: "a".repeat(ProtocolLimits.maxMissionChunkBase64Chars + 1) }))).toMatchObject({ kind: "rejected", error: { code: "CHUNK_TOO_LARGE" } });
    expect(RelayFrameCodec.decode(new Uint8Array(ProtocolLimits.maxFrameBytes + 1))).toMatchObject({ kind: "rejected", error: { code: "FRAME_TOO_LARGE" } });
    expect(validate({ type: "mission-chunk", id: "", data: new Uint8Array([1]) })).toMatchObject({ ok: false, error: { code: "INVALID_MESSAGE_ID" } });
  });

  it("does not accept frames that encode beyond the configured byte size", () => {
    const fields: Record<string, JsonValue> = {};
    for (let index = 0; index < 4_091; index += 1) fields[`k${index}`.padEnd(128, "x")] = { kind: "null" };
    const payload: JsonValue = { kind: "object", fields };
    expect(RelayFrameCodec.encode({ type: "telemetry", payload, capabilities: { kind: "object", fields: {} } })).toMatchObject({ ok: false, error: { code: "FRAME_TOO_LARGE" } });
  });

  it("keeps decoded number representations and nested objects detached", () => {
    const result = RelayFrameCodec.decode(encode({ type: "telemetry", payload: { signed: -3.5e2, nested: [true, null, { label: "x" }] }, capabilities: {} }));
    expect(result).toMatchObject({ kind: "decoded", frame: { type: "telemetry", payload: { kind: "object" } } });
    if (result.kind !== "decoded" || result.frame.type !== "telemetry") throw new Error("expected telemetry");
    expect(result.frame.payload.fields.signed).toEqual({ kind: "number", value: "-350" });
    expect(Object.isFrozen(result.frame.payload.fields)).toBe(true);
  });
});
