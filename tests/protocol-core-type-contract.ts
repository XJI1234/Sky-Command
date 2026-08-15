import { JsonNull, type DecodeResult, type JsonObject, type ProtocolResult, type RelayFrame } from "../src/modules/relay-link/protocol-core/index.js";

const frame: RelayFrame = { type: "telemetry", payload: { kind: "object", fields: { absent: JsonNull } }, capabilities: { kind: "object", fields: {} } };
const object: JsonObject = { kind: "object", fields: {} };
declare const decoded: DecodeResult;
declare const result: ProtocolResult<RelayFrame>;

// @ts-expect-error Mission chunks require bytes, not a Base64 string.
const invalidChunk: RelayFrame = { type: "mission-chunk", id: "x", data: "YWJj" };
// @ts-expect-error A telemetry payload is always a JSON object.
const invalidTelemetry: RelayFrame = { type: "telemetry", payload: JsonNull, capabilities: object };

void frame;
void object;
void decoded;
void result;
void invalidChunk;
void invalidTelemetry;
