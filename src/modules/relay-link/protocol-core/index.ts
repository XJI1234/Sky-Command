export const ProtocolLimits = Object.freeze({
  maxFrameBytes: 96 * 1024,
  maxJsonNestingDepth: 32,
  maxJsonTokens: 8_192,
  maxJsonNumberChars: 128,
  maxJsonStringCodePoints: 65_536,
  maxJsonFieldNameCodePoints: 128,
  maxMessageTypeCodePoints: 64,
  maxIdCodePoints: 128,
  maxCommandNameCodePoints: 64,
  maxFileNameCodePoints: 128,
  maxResultDetailCodePoints: 1_024,
  maxDiagnosticEventsPerReport: 32,
  maxDiagnosticModuleCodePoints: 64,
  maxDiagnosticEventCodeCodePoints: 64,
  maxDiagnosticDetailCodePoints: 512,
  maxErrorMessageCodePoints: 256,
  maxMissionBytes: 100 * 1024 * 1024,
  maxMissionChunkBytes: 48 * 1024,
  maxMissionChunkBase64Chars: 65_536,
  protocolVersion: "1"
});

export const ProtocolErrorCodes = Object.freeze([
  "FRAME_TOO_LARGE", "INVALID_UTF8", "INVALID_JSON", "INVALID_FIELD", "INVALID_MESSAGE_TYPE", "INVALID_BASE64",
  "INVALID_DEVICE_ID", "INVALID_SESSION_ID", "INVALID_MESSAGE_ID", "PROTOCOL_VERSION_UNSUPPORTED", "INVALID_COMMAND_NAME",
  "INVALID_FILE_NAME", "INVALID_SHA256", "MISSION_SIZE_OUT_OF_RANGE", "EMPTY_CHUNK", "CHUNK_TOO_LARGE", "INVALID_RESULT_DETAIL",
  "INVALID_DIAGNOSTIC_REPORT", "INVALID_DIAGNOSTIC_ACKNOWLEDGEMENT"
] as const);

export type ProtocolErrorCode = typeof ProtocolErrorCodes[number];
export type JsonNull = Readonly<{ readonly kind: "null" }>;
export type JsonString = Readonly<{ readonly kind: "string"; readonly value: string }>;
export type JsonNumber = Readonly<{ readonly kind: "number"; readonly value: string }>;
export type JsonBoolean = Readonly<{ readonly kind: "boolean"; readonly value: boolean }>;
export type JsonArray = Readonly<{ readonly kind: "array"; readonly values: readonly JsonValue[] }>;
export type JsonObject = Readonly<{ readonly kind: "object"; readonly fields: Readonly<Record<string, JsonValue>> }>;
export type JsonValue = JsonNull | JsonString | JsonNumber | JsonBoolean | JsonArray | JsonObject;

export const JsonNull: JsonNull = Object.freeze({ kind: "null" });

export interface HelloFrame { readonly type: "hello"; readonly deviceId: string; readonly protocolVersion: string; }
export interface PairedFrame { readonly type: "paired"; readonly sessionId: string; readonly protocolVersion: string | null; }
export interface TelemetryFrame { readonly type: "telemetry"; readonly payload: JsonObject; readonly capabilities: JsonObject; }
export interface CommandFrame { readonly type: "command"; readonly id: string; readonly command: Readonly<{ readonly name: string; readonly fields: JsonObject["fields"] }>; }
export interface CommandResultFrame { readonly type: "command-result"; readonly id: string; readonly ok: boolean; readonly detail: string; readonly result?: JsonObject; }
export interface MissionBeginFrame { readonly type: "mission-begin"; readonly id: string; readonly fileName: string; readonly size: number; readonly sha256: string; }
export interface MissionChunkInput { readonly type: "mission-chunk"; readonly id: string; readonly data: Uint8Array; }
export interface MissionCompleteFrame { readonly type: "mission-complete"; readonly id: string; }
export interface MissionResultFrame { readonly type: "mission-result"; readonly id: string; readonly ok: boolean; readonly detail: string; }
export type MissionPhase = "START_POINT_REACHED" | "ROUTE_EXECUTION_STARTED";
export interface MissionPhaseFrame {
  readonly type: "mission-phase";
  readonly missionRevision: number;
  readonly deviceGeneration: number;
  readonly sequence: number;
  readonly phase: MissionPhase;
  readonly fileName: string;
}
export interface DiagnosticEventFrame {
  readonly sequence: number;
  readonly timestampMillis: number;
  readonly level: "DEBUG" | "INFO" | "WARN" | "ERROR";
  readonly module: string;
  readonly eventCode: string;
  readonly operationId: string | null;
  readonly safeDetail: string;
}
export interface DiagnosticReportFrame { readonly type: "diagnostic-report"; readonly runId: string; readonly events: readonly DiagnosticEventFrame[]; }
export interface DiagnosticAcknowledgementFrame { readonly type: "diagnostic-ack"; readonly runId: string; readonly acknowledgedSequence: number; }

export class MissionChunkFrame implements MissionChunkInput {
  readonly type = "mission-chunk" as const;
  readonly id: string;
  readonly #data: Uint8Array;

  constructor(id: string, data: Uint8Array) {
    this.id = id;
    this.#data = data.slice();
    Object.freeze(this);
  }

  get data(): Uint8Array { return this.#data.slice(); }
}

export type RelayFrame = HelloFrame | PairedFrame | TelemetryFrame | CommandFrame | CommandResultFrame | MissionBeginFrame | MissionChunkInput | MissionCompleteFrame | MissionResultFrame | MissionPhaseFrame | DiagnosticReportFrame | DiagnosticAcknowledgementFrame;
export interface ProtocolError { readonly code: ProtocolErrorCode; readonly message: string; }
export interface Accepted<T> { readonly ok: true; readonly value: T; }
export interface Rejected { readonly ok: false; readonly error: ProtocolError; }
export type ProtocolResult<T> = Accepted<T> | Rejected;
export type DecodeResult = Readonly<{ readonly kind: "decoded"; readonly frame: RelayFrame }> | Readonly<{ readonly kind: "rejected"; readonly error: ProtocolError }> | Readonly<{ readonly kind: "ignored"; readonly type: string }>;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const numberPattern = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

function error(code: ProtocolErrorCode, message: string): ProtocolError {
  return Object.freeze({ code, message });
}

function accepted<T>(value: T): ProtocolResult<T> { return Object.freeze({ ok: true as const, value }); }
function rejected<T = never>(code: ProtocolErrorCode, message: string): ProtocolResult<T> { return Object.freeze({ ok: false as const, error: error(code, message) }); }
function decoded(frame: RelayFrame): DecodeResult { return Object.freeze({ kind: "decoded" as const, frame }); }
function decodeRejected(code: ProtocolErrorCode, message: string): DecodeResult { return Object.freeze({ kind: "rejected" as const, error: error(code, message) }); }

function codePoints(value: string): number { return Array.from(value).length; }
function hasControl(value: string): boolean { return /[\p{Cc}]/u.test(value); }
function isSafeId(value: string): boolean { return value.trim().length > 0 && codePoints(value) <= ProtocolLimits.maxIdCodePoints && !hasControl(value); }
function safeString(value: unknown): value is string { return typeof value === "string"; }
function safeBoolean(value: unknown): value is boolean { return typeof value === "boolean"; }
const unreadable = Symbol("unreadable");
type ReadFailure = typeof unreadable;
function read(record: object, key: string): unknown | ReadFailure {
  try { return (record as Record<string, unknown>)[key]; } catch { return ReadFailure.unreadable; }
}
const ReadFailure = { unreadable } as const;

function clonedJson(value: unknown, depth = 1, budget = { tokens: 0 }): ProtocolResult<JsonValue> {
  const spend = (tokens: number): boolean => (budget.tokens += tokens) <= ProtocolLimits.maxJsonTokens;
  if (value === null) return spend(1) ? accepted(JsonNull) : rejected("INVALID_JSON", "JSON contains too many tokens");
  if (typeof value === "string") {
    if (!spend(1)) return rejected("INVALID_JSON", "JSON contains too many tokens");
    return codePoints(value) <= ProtocolLimits.maxJsonStringCodePoints ? accepted(Object.freeze({ kind: "string" as const, value })) : rejected("INVALID_JSON", "JSON string is too long");
  }
  if (typeof value === "boolean") return spend(1) ? accepted(Object.freeze({ kind: "boolean" as const, value })) : rejected("INVALID_JSON", "JSON contains too many tokens");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return rejected("INVALID_JSON", "JSON number is invalid");
    return clonedJson({ kind: "number", value: String(value) }, depth, budget);
  }
  if (value === null || typeof value !== "object") return rejected("INVALID_JSON", "Unsupported JSON value");
  const kind = read(value, "kind");
  if (kind === ReadFailure.unreadable || !safeString(kind)) return rejected("INVALID_FIELD", "JSON value is invalid");
  if (kind === "null") return spend(1) ? accepted(JsonNull) : rejected("INVALID_JSON", "JSON contains too many tokens");
  if (kind === "string" || kind === "number" || kind === "boolean") {
    const scalar = read(value, "value");
    if (scalar === ReadFailure.unreadable) return rejected("INVALID_FIELD", "JSON value is invalid");
    if (kind === "string" && safeString(scalar)) return clonedJson(scalar, depth, budget);
    if (kind === "boolean" && safeBoolean(scalar)) return clonedJson(scalar, depth, budget);
    if (kind === "number" && safeString(scalar)) {
      if (!spend(1)) return rejected("INVALID_JSON", "JSON contains too many tokens");
      return scalar.length <= ProtocolLimits.maxJsonNumberChars && numberPattern.test(scalar) ? accepted(Object.freeze({ kind: "number" as const, value: scalar })) : rejected("INVALID_JSON", "JSON number is invalid");
    }
    return rejected("INVALID_FIELD", "JSON value is invalid");
  }
  if ((kind !== "array" && kind !== "object") || depth > ProtocolLimits.maxJsonNestingDepth) return rejected("INVALID_JSON", kind === "array" || kind === "object" ? "JSON nesting is too deep" : "Unsupported JSON value");
  const memberName = kind === "array" ? "values" : "fields";
  const members = read(value, memberName);
  if (members === ReadFailure.unreadable) return rejected("INVALID_FIELD", "JSON value is invalid");
  if (!spend(2)) return rejected("INVALID_JSON", "JSON contains too many tokens");
  if (kind === "array") {
    if (!Array.isArray(members)) return rejected("INVALID_FIELD", "JSON array is invalid");
    const values: JsonValue[] = [];
    for (const member of members) {
      const result = clonedJson(member, depth + 1, budget);
      if (!result.ok) return result;
      values.push(result.value);
    }
    return accepted(Object.freeze({ kind: "array" as const, values: Object.freeze(values) }));
  }
  if (members === null || typeof members !== "object" || Array.isArray(members)) return rejected("INVALID_FIELD", "JSON object is invalid");
  let entries: [string, unknown][];
  try { entries = Object.entries(members); } catch { return rejected("INVALID_FIELD", "JSON object is invalid"); }
  const fields: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const [name, child] of entries) {
    if (!spend(1)) return rejected("INVALID_JSON", "JSON contains too many tokens");
    if (!name.trim().length || codePoints(name) > ProtocolLimits.maxJsonFieldNameCodePoints || hasControl(name)) return rejected("INVALID_FIELD", "JSON field name is invalid");
    const result = clonedJson(child, depth + 1, budget);
    if (!result.ok) return result;
    fields[name] = result.value;
  }
  return accepted(Object.freeze({ kind: "object" as const, fields: Object.freeze(fields) }));
}

function isJsonObject(value: JsonValue): value is JsonObject { return value.kind === "object"; }

/**
 * 校验并深拷贝可跨协议边界传递的结构化 JSON 对象。
 * 此接口不要求调用者构造完整中继帧，适用于命令结果等嵌入式对象。
 */
export function validateJsonObject(value: unknown): ProtocolResult<JsonObject> {
  const normalized = clonedJson(value);
  if (!normalized.ok) return normalized;
  return isJsonObject(normalized.value)
    ? accepted(normalized.value)
    : rejected("INVALID_FIELD", "JSON value must be an object");
}

function validateId(value: unknown, code: ProtocolErrorCode, label: string): ProtocolResult<string> {
  return safeString(value) && isSafeId(value) ? accepted(value) : rejected(code, `${label} is invalid`);
}
function validateVersion(value: unknown): ProtocolResult<string> { return value === ProtocolLimits.protocolVersion ? accepted(value) : rejected("PROTOCOL_VERSION_UNSUPPORTED", "Protocol version is unsupported"); }
function validateDetail(id: unknown, detail: unknown): ProtocolResult<readonly [string, string]> {
  const checkedId = validateId(id, "INVALID_MESSAGE_ID", "Message ID");
  if (!checkedId.ok) return checkedId;
  if (!safeString(detail) || codePoints(detail) > ProtocolLimits.maxResultDetailCodePoints || hasControl(detail)) return rejected("INVALID_RESULT_DETAIL", "Result detail is invalid");
  return accepted(Object.freeze([checkedId.value, detail]));
}
function validMissionFileName(value: unknown): value is string {
  return safeString(value) && value.trim().length > 0 && codePoints(value) <= ProtocolLimits.maxFileNameCodePoints && value.toLowerCase().endsWith(".kmz") && !value.includes("..") && !/[\\/]/u.test(value) && !hasControl(value);
}
function validMissionPhase(value: unknown): value is MissionPhase {
  return value === "START_POINT_REACHED" || value === "ROUTE_EXECUTION_STARTED";
}
function validPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function validDiagnosticIdentifier(value: unknown, maximum: number): value is string {
  return safeString(value) && value.length > 0 && codePoints(value) <= maximum && /^[A-Za-z][A-Za-z0-9._-]*$/u.test(value);
}
function validDiagnosticLevel(value: unknown): value is DiagnosticEventFrame["level"] {
  return value === "DEBUG" || value === "INFO" || value === "WARN" || value === "ERROR";
}
function normalizeDiagnosticEvent(input: unknown): ProtocolResult<DiagnosticEventFrame> {
  const source = record(input);
  if (!source.ok) return rejected("INVALID_FIELD", "Diagnostic event must be an object");
  const sequence = read(source.value, "sequence");
  const timestampMillis = read(source.value, "timestampMillis");
  const level = read(source.value, "level");
  const module = read(source.value, "module");
  const eventCode = read(source.value, "eventCode");
  const operationId = read(source.value, "operationId");
  const safeDetail = read(source.value, "safeDetail");
  if (sequence === ReadFailure.unreadable) return rejected("INVALID_FIELD", "Diagnostic event fields are invalid");
  if (timestampMillis === ReadFailure.unreadable) return rejected("INVALID_FIELD", "Diagnostic event fields are invalid");
  if (level === ReadFailure.unreadable) return rejected("INVALID_FIELD", "Diagnostic event fields are invalid");
  if (module === ReadFailure.unreadable) return rejected("INVALID_FIELD", "Diagnostic event fields are invalid");
  if (eventCode === ReadFailure.unreadable) return rejected("INVALID_FIELD", "Diagnostic event fields are invalid");
  if (operationId === ReadFailure.unreadable) return rejected("INVALID_FIELD", "Diagnostic event fields are invalid");
  if (safeDetail === ReadFailure.unreadable) return rejected("INVALID_FIELD", "Diagnostic event fields are invalid");
  if (typeof sequence !== "number" || !Number.isSafeInteger(sequence)) return rejected("INVALID_FIELD", "Diagnostic event fields are invalid");
  if (typeof timestampMillis !== "number" || !Number.isSafeInteger(timestampMillis)) return rejected("INVALID_FIELD", "Diagnostic event fields are invalid");
  if (!safeString(level) || !safeString(module) || !safeString(eventCode) || !safeString(safeDetail)) return rejected("INVALID_FIELD", "Diagnostic event fields are invalid");
  if (operationId !== undefined && operationId !== null && !safeString(operationId)) return rejected("INVALID_FIELD", "Diagnostic event fields are invalid");
  return accepted(Object.freeze({ sequence, timestampMillis, level: level as DiagnosticEventFrame["level"], module, eventCode, operationId: operationId === undefined || operationId === null ? null : operationId, safeDetail }));
}
function validateDiagnosticReport(runId: string, events: readonly DiagnosticEventFrame[]): ProtocolResult<readonly DiagnosticEventFrame[]> {
  if (events.length < 1 || events.length > ProtocolLimits.maxDiagnosticEventsPerReport) return rejected("INVALID_DIAGNOSTIC_REPORT", "Diagnostic event count is invalid");
  let previousSequence = 0;
  const copied: DiagnosticEventFrame[] = [];
  for (const event of events) {
    if (event.sequence <= previousSequence || event.timestampMillis < 0 || !validDiagnosticLevel(event.level) || !validDiagnosticIdentifier(event.module, ProtocolLimits.maxDiagnosticModuleCodePoints) || !validDiagnosticIdentifier(event.eventCode, ProtocolLimits.maxDiagnosticEventCodeCodePoints) || (event.operationId !== null && !isSafeId(event.operationId)) || codePoints(event.safeDetail) > ProtocolLimits.maxDiagnosticDetailCodePoints || hasControl(event.safeDetail)) return rejected("INVALID_DIAGNOSTIC_REPORT", "Diagnostic event is invalid");
    previousSequence = event.sequence;
    copied.push(Object.freeze({ ...event }));
  }
  return accepted(Object.freeze(copied));
}
function copyChunk(data: unknown): ProtocolResult<Uint8Array> {
  if (!(data instanceof Uint8Array)) return rejected("INVALID_FIELD", "Mission chunk is invalid");
  if (data.byteLength === 0) return rejected("EMPTY_CHUNK", "Mission chunk is empty");
  if (data.byteLength > ProtocolLimits.maxMissionChunkBytes) return rejected("CHUNK_TOO_LARGE", "Mission chunk is too large");
  return accepted(data.slice());
}
function record(value: unknown): ProtocolResult<object> { return value !== null && typeof value === "object" ? accepted(value) : rejected("INVALID_FIELD", "Frame is invalid"); }

function normalizeFrame(input: unknown): ProtocolResult<RelayFrame> {
  const root = record(input);
  if (!root.ok) return root;
  const type = read(root.value, "type");
  if (type === ReadFailure.unreadable || !safeString(type)) return rejected("INVALID_FIELD", "Frame type is invalid");
  if (!type.trim().length || codePoints(type) > ProtocolLimits.maxMessageTypeCodePoints || hasControl(type)) return rejected("INVALID_MESSAGE_TYPE", "Message type is invalid");
  const field = (name: string): unknown | ReadFailure => read(root.value, name);
  switch (type) {
    case "hello": {
      const deviceId = validateId(field("deviceId"), "INVALID_DEVICE_ID", "Device ID"); if (!deviceId.ok) return deviceId;
      const version = validateVersion(field("protocolVersion")); if (!version.ok) return version;
      return accepted(Object.freeze({ type, deviceId: deviceId.value, protocolVersion: version.value }));
    }
    case "paired": {
      const sessionId = validateId(field("sessionId"), "INVALID_SESSION_ID", "Session ID"); if (!sessionId.ok) return sessionId;
      const rawVersion = field("protocolVersion");
      if (rawVersion === ReadFailure.unreadable) return rejected("INVALID_FIELD", "Frame contains an invalid field");
      if (rawVersion !== undefined && rawVersion !== null) { const version = validateVersion(rawVersion); if (!version.ok) return version; }
      return accepted(Object.freeze({ type, sessionId: sessionId.value, protocolVersion: rawVersion === undefined || rawVersion === null ? null : rawVersion as string }));
    }
    case "telemetry": {
      const budget = { tokens: 6 };
      const payload = clonedJson(field("payload"), 2, budget); if (!payload.ok) return payload;
      const capabilities = clonedJson(field("capabilities"), 2, budget); if (!capabilities.ok) return capabilities;
      if (!isJsonObject(payload.value) || !isJsonObject(capabilities.value)) return rejected("INVALID_FIELD", "Telemetry fields must be objects");
      return accepted(Object.freeze({ type, payload: payload.value, capabilities: capabilities.value }));
    }
    case "command": {
      const id = validateId(field("id"), "INVALID_MESSAGE_ID", "Command ID"); if (!id.ok) return id;
      const command = record(field("command")); if (!command.ok) return rejected("INVALID_FIELD", "Command must be an object");
      const name = read(command.value, "name");
      if (!safeString(name) || !name.trim().length || codePoints(name) > ProtocolLimits.maxCommandNameCodePoints || hasControl(name)) return rejected("INVALID_COMMAND_NAME", "Command name is invalid");
      const rawFields = read(command.value, "fields");
      if (rawFields === ReadFailure.unreadable || rawFields === null || typeof rawFields !== "object" || Array.isArray(rawFields)) return rejected("INVALID_FIELD", "Command fields must be an object");
      let entries: [string, unknown][]; try { entries = Object.entries(rawFields); } catch { return rejected("INVALID_FIELD", "Command is invalid"); }
      const fields: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
      const budget = { tokens: 9 };
      for (const [key, raw] of entries) {
        if (key === "name") return rejected("INVALID_FIELD", "Command fields contain a reserved name");
        if (!key.trim().length || codePoints(key) > ProtocolLimits.maxJsonFieldNameCodePoints || hasControl(key)) return rejected("INVALID_FIELD", "JSON field name is invalid");
        budget.tokens += 1;
        const json = clonedJson(raw, 3, budget); if (!json.ok) return json;
        fields[key] = json.value;
      }
      return accepted(Object.freeze({ type, id: id.value, command: Object.freeze({ name, fields: Object.freeze(fields) }) }));
    }
    case "command-result": {
      const detail = validateDetail(field("id"), field("detail")); if (!detail.ok) return detail;
      const ok = field("ok"); if (!safeBoolean(ok)) return rejected("INVALID_FIELD", "Field ok must be boolean");
      const rawResult = field("result");
      if (rawResult === ReadFailure.unreadable) return rejected("INVALID_FIELD", "Command result is invalid");
      if (rawResult === undefined) return accepted(Object.freeze({ type, id: detail.value[0], ok, detail: detail.value[1] }));
      const result = clonedJson(rawResult);
      if (!result.ok) return result;
      if (!isJsonObject(result.value)) return rejected("INVALID_FIELD", "Command result must be an object");
      return accepted(Object.freeze({ type, id: detail.value[0], ok, detail: detail.value[1], result: result.value }));
    }
    case "mission-result": {
      const detail = validateDetail(field("id"), field("detail")); if (!detail.ok) return detail;
      const ok = field("ok"); if (!safeBoolean(ok)) return rejected("INVALID_FIELD", "Field ok must be boolean");
      return accepted(Object.freeze({ type, id: detail.value[0], ok, detail: detail.value[1] }));
    }
    case "mission-begin": {
      const id = validateId(field("id"), "INVALID_MESSAGE_ID", "Mission ID"); if (!id.ok) return id;
      const fileName = field("fileName");
      if (!validMissionFileName(fileName)) return rejected("INVALID_FILE_NAME", "Mission file name is invalid");
      const size = field("size"); if (typeof size !== "number" || !Number.isSafeInteger(size)) return rejected("INVALID_FIELD", "Field size must be an integer");
      if (size < 1 || size > ProtocolLimits.maxMissionBytes) return rejected("MISSION_SIZE_OUT_OF_RANGE", "Mission size is outside the allowed range");
      const sha256 = field("sha256"); if (!safeString(sha256) || !sha256Pattern.test(sha256)) return rejected("INVALID_SHA256", "Mission SHA-256 is invalid");
      return accepted(Object.freeze({ type, id: id.value, fileName, size, sha256 }));
    }
    case "mission-chunk": {
      const id = validateId(field("id"), "INVALID_MESSAGE_ID", "Mission ID"); if (!id.ok) return id;
      const data = copyChunk(field("data")); if (!data.ok) return data;
      return accepted(new MissionChunkFrame(id.value, data.value));
    }
    case "mission-complete": {
      const id = validateId(field("id"), "INVALID_MESSAGE_ID", "Mission ID"); if (!id.ok) return id;
      return accepted(Object.freeze({ type, id: id.value }));
    }
    case "mission-phase": {
      const missionRevision = field("missionRevision");
      const deviceGeneration = field("deviceGeneration");
      const sequence = field("sequence");
      const phase = field("phase");
      const fileName = field("fileName");
      if (!validPositiveInteger(missionRevision) || typeof deviceGeneration !== "number" || !Number.isSafeInteger(deviceGeneration) || deviceGeneration < 0 || !validPositiveInteger(sequence) || !validMissionPhase(phase) || !validMissionFileName(fileName)) return rejected("INVALID_FIELD", "Mission phase is invalid");
      return accepted(Object.freeze({ type, missionRevision, deviceGeneration, sequence, phase, fileName }));
    }
    case "diagnostic-report": {
      const runId = validateId(field("runId"), "INVALID_MESSAGE_ID", "Diagnostic run ID"); if (!runId.ok) return runId;
      const events = field("events");
      if (!Array.isArray(events)) return rejected("INVALID_FIELD", "Diagnostic events must be an array");
      const normalizedEvents: DiagnosticEventFrame[] = [];
      for (const value of events) {
        const event = normalizeDiagnosticEvent(value); if (!event.ok) return event;
        normalizedEvents.push(event.value);
      }
      const checkedEvents = validateDiagnosticReport(runId.value, normalizedEvents); if (!checkedEvents.ok) return checkedEvents;
      return accepted(Object.freeze({ type, runId: runId.value, events: checkedEvents.value }));
    }
    case "diagnostic-ack": {
      const runId = validateId(field("runId"), "INVALID_MESSAGE_ID", "Diagnostic run ID"); if (!runId.ok) return runId;
      const acknowledgedSequence = field("acknowledgedSequence");
      if (typeof acknowledgedSequence !== "number" || !Number.isSafeInteger(acknowledgedSequence)) return rejected("INVALID_FIELD", "Diagnostic acknowledgement sequence must be an integer");
      if (acknowledgedSequence < 0) return rejected("INVALID_DIAGNOSTIC_ACKNOWLEDGEMENT", "Diagnostic acknowledgement sequence is invalid");
      return accepted(Object.freeze({ type, runId: runId.value, acknowledgedSequence }));
    }
    default: return rejected("INVALID_MESSAGE_TYPE", "Message type is invalid");
  }
}

export function validate(frame: RelayFrame): ProtocolResult<RelayFrame> {
  try { return normalizeFrame(frame); } catch { return rejected("INVALID_FIELD", "Frame contains an invalid field"); }
}

function jsonText(value: JsonValue): string {
  switch (value.kind) {
    case "null": return "null";
    case "string": return JSON.stringify(value.value);
    case "number": return value.value;
    case "boolean": return String(value.value);
    case "array": return `[${value.values.map(jsonText).join(",")}]`;
    case "object": return `{${Object.entries(value.fields).map(([key, child]) => `${JSON.stringify(key)}:${jsonText(child)}`).join(",")}}`;
  }
}
function base64Encode(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] as number, b = bytes[index + 1], c = bytes[index + 2];
    result += alphabet[a >>> 2] as string;
    result += alphabet[((a & 3) << 4) | ((b ?? 0) >>> 4)] as string;
    result += b === undefined ? "=" : alphabet[((b & 15) << 2) | ((c ?? 0) >>> 6)] as string;
    result += c === undefined ? "=" : alphabet[c & 63] as string;
  }
  return result;
}
function encodeText(frame: RelayFrame): string {
  switch (frame.type) {
    case "hello": return `{\"type\":\"hello\",\"deviceId\":${JSON.stringify(frame.deviceId)},\"protocolVersion\":${JSON.stringify(frame.protocolVersion)}}`;
    case "paired": return `{\"type\":\"paired\",\"sessionId\":${JSON.stringify(frame.sessionId)}${frame.protocolVersion === null ? "" : `,\"protocolVersion\":${JSON.stringify(frame.protocolVersion)}`}}`;
    case "telemetry": return `{\"type\":\"telemetry\",\"payload\":${jsonText(frame.payload)},\"capabilities\":${jsonText(frame.capabilities)}}`;
    case "command": return `{\"type\":\"command\",\"id\":${JSON.stringify(frame.id)},\"command\":{${Object.entries(frame.command.fields).map(([key, value]) => `${JSON.stringify(key)}:${jsonText(value)}`).concat(`\"name\":${JSON.stringify(frame.command.name)}`).join(",")}}}`;
    case "command-result": return `{\"type\":\"command-result\",\"id\":${JSON.stringify(frame.id)},\"ok\":${frame.ok},\"detail\":${JSON.stringify(frame.detail)}${frame.result === undefined ? "" : `,\"result\":${jsonText(frame.result)}`}}`;
    case "mission-begin": return `{\"type\":\"mission-begin\",\"id\":${JSON.stringify(frame.id)},\"fileName\":${JSON.stringify(frame.fileName)},\"size\":${frame.size},\"sha256\":${JSON.stringify(frame.sha256)}}`;
    case "mission-chunk": return `{\"type\":\"mission-chunk\",\"id\":${JSON.stringify(frame.id)},\"data\":${JSON.stringify(base64Encode(frame.data))}}`;
    case "mission-complete": return `{\"type\":\"mission-complete\",\"id\":${JSON.stringify(frame.id)}}`;
    case "mission-result": return `{\"type\":\"mission-result\",\"id\":${JSON.stringify(frame.id)},\"ok\":${frame.ok},\"detail\":${JSON.stringify(frame.detail)}}`;
    case "mission-phase": return `{\"type\":\"mission-phase\",\"missionRevision\":${frame.missionRevision},\"deviceGeneration\":${frame.deviceGeneration},\"sequence\":${frame.sequence},\"phase\":${JSON.stringify(frame.phase)},\"fileName\":${JSON.stringify(frame.fileName)}}`;
    case "diagnostic-report": return `{\"type\":\"diagnostic-report\",\"runId\":${JSON.stringify(frame.runId)},\"events\":[${frame.events.map((event) => `{\"sequence\":${event.sequence},\"timestampMillis\":${event.timestampMillis},\"level\":${JSON.stringify(event.level)},\"module\":${JSON.stringify(event.module)},\"eventCode\":${JSON.stringify(event.eventCode)}${event.operationId === null ? "" : `,\"operationId\":${JSON.stringify(event.operationId)}`},\"safeDetail\":${JSON.stringify(event.safeDetail)}}`).join(",")}]}`;
    case "diagnostic-ack": return `{\"type\":\"diagnostic-ack\",\"runId\":${JSON.stringify(frame.runId)},\"acknowledgedSequence\":${frame.acknowledgedSequence}}`;
  }
}

class JsonParseError extends Error {}
class StrictJsonParser {
  #index = 0;
  #tokens = 0;
  constructor(private readonly source: string) {}
  parse(): JsonValue {
    this.skip(); const value = this.value(1); this.skip();
    if (this.#index !== this.source.length) throw new JsonParseError();
    return value;
  }
  private consume(count = 1): void { this.#tokens += count; if (this.#tokens > ProtocolLimits.maxJsonTokens) throw new JsonParseError(); }
  private skip(): void { while (/[ \t\n\r]/u.test(this.source[this.#index] ?? "")) this.#index += 1; }
  private value(depth: number): JsonValue {
    const character = this.source[this.#index];
    if (character === "\"") { this.consume(); return Object.freeze({ kind: "string" as const, value: this.string() }); }
    if (character === "{") return this.object(depth);
    if (character === "[") return this.array(depth);
    if (this.source.startsWith("true", this.#index)) { this.#index += 4; this.consume(); return Object.freeze({ kind: "boolean" as const, value: true }); }
    if (this.source.startsWith("false", this.#index)) { this.#index += 5; this.consume(); return Object.freeze({ kind: "boolean" as const, value: false }); }
    if (this.source.startsWith("null", this.#index)) { this.#index += 4; this.consume(); return JsonNull; }
    return this.number();
  }
  private string(): string {
    this.#index += 1;
    let result = "";
    while (this.#index < this.source.length) {
      const character = this.source[this.#index++] as string;
      if (character === "\"") {
        return result;
      }
      if (character < " ") throw new JsonParseError();
      if (character !== "\\") { result += character; continue; }
      const escape = this.source[this.#index++];
      if (escape === "\"" || escape === "\\" || escape === "/") result += escape;
      else if (escape === "b") result += "\b";
      else if (escape === "f") result += "\f";
      else if (escape === "n") result += "\n";
      else if (escape === "r") result += "\r";
      else if (escape === "t") result += "\t";
      else if (escape === "u") {
        const digits = this.source.slice(this.#index, this.#index + 4);
        if (!/^[0-9a-fA-F]{4}$/u.test(digits)) throw new JsonParseError();
        result += String.fromCharCode(Number.parseInt(digits, 16)); this.#index += 4;
      } else throw new JsonParseError();
    }
    throw new JsonParseError();
  }
  private number(): JsonNumber {
    const rest = this.source.slice(this.#index);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(rest);
    if (match === null || match[0] === undefined || match[0].length > ProtocolLimits.maxJsonNumberChars) throw new JsonParseError();
    this.#index += match[0].length; this.consume();
    return Object.freeze({ kind: "number" as const, value: match[0] });
  }
  private array(depth: number): JsonArray {
    if (depth > ProtocolLimits.maxJsonNestingDepth) throw new JsonParseError();
    this.#index += 1; this.consume(2); this.skip(); const values: JsonValue[] = [];
    if (this.source[this.#index] === "]") { this.#index += 1; return Object.freeze({ kind: "array" as const, values: Object.freeze(values) }); }
    while (true) {
      values.push(this.value(depth + 1)); this.skip();
      if (this.source[this.#index] === "]") { this.#index += 1; return Object.freeze({ kind: "array" as const, values: Object.freeze(values) }); }
      if (this.source[this.#index++] !== ",") throw new JsonParseError(); this.skip();
    }
  }
  private object(depth: number): JsonObject {
    if (depth > ProtocolLimits.maxJsonNestingDepth) throw new JsonParseError();
    this.#index += 1; this.consume(2); this.skip(); const fields: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>; const names = new Set<string>();
    if (this.source[this.#index] === "}") { this.#index += 1; return Object.freeze({ kind: "object" as const, fields: Object.freeze(fields) }); }
    while (true) {
      if (this.source[this.#index] !== "\"") throw new JsonParseError();
      const name = this.string(); this.consume();
      if (!name.trim().length || codePoints(name) > ProtocolLimits.maxJsonFieldNameCodePoints || hasControl(name) || names.has(name)) throw new JsonParseError();
      names.add(name); this.skip(); if (this.source[this.#index++] !== ":") throw new JsonParseError(); this.skip(); fields[name] = this.value(depth + 1); this.skip();
      if (this.source[this.#index] === "}") { this.#index += 1; return Object.freeze({ kind: "object" as const, fields: Object.freeze(fields) }); }
      if (this.source[this.#index++] !== ",") throw new JsonParseError(); this.skip();
    }
  }
}

function base64Decode(value: string): ProtocolResult<Uint8Array> {
  if (value.length > ProtocolLimits.maxMissionChunkBase64Chars) return rejected("CHUNK_TOO_LARGE", "Mission chunk is too large");
  if (!base64Pattern.test(value)) return rejected("INVALID_BASE64", "Mission chunk is not valid Base64");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array(value.length / 4 * 3 - padding); let target = 0;
  for (let index = 0; index < value.length; index += 4) {
    const a = alphabet.indexOf(value[index] as string), b = alphabet.indexOf(value[index + 1] as string), c = value[index + 2] === "=" ? 0 : alphabet.indexOf(value[index + 2] as string), d = value[index + 3] === "=" ? 0 : alphabet.indexOf(value[index + 3] as string);
    bytes[target++] = (a << 2) | (b >>> 4); if (target < bytes.length) bytes[target++] = ((b & 15) << 4) | (c >>> 2); if (target < bytes.length) bytes[target++] = ((c & 3) << 6) | d;
  }
  return base64Encode(bytes) === value ? accepted(bytes) : rejected("INVALID_BASE64", "Mission chunk is not valid Base64");
}

function nativeJsonValue(value: JsonValue): unknown {
  switch (value.kind) {
    case "null": return null;
    case "string": return value.value;
    case "number": return Number(value.value);
    case "boolean": return value.value;
    case "array": return value.values.map(nativeJsonValue);
    case "object": {
      const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const [key, child] of Object.entries(value.fields)) result[key] = nativeJsonValue(child);
      return result;
    }
  }
}

function decodeKnown(root: JsonObject): DecodeResult {
  const type = root.fields.type;
  if (type === undefined || type.kind !== "string") return decodeRejected("INVALID_FIELD", "Field type must be text");
  if (!type.value.trim().length || codePoints(type.value) > ProtocolLimits.maxMessageTypeCodePoints || hasControl(type.value)) return decodeRejected("INVALID_MESSAGE_TYPE", "Message type is invalid");
  if (!new Set(["hello", "paired", "telemetry", "command", "command-result", "mission-begin", "mission-chunk", "mission-complete", "mission-result", "mission-phase", "diagnostic-report", "diagnostic-ack"]).has(type.value)) return Object.freeze({ kind: "ignored" as const, type: type.value });
  const text = (name: string): string | undefined => {
    const value = root.fields[name]; return value?.kind === "string" ? value.value : undefined;
  };
  const boolean = (name: string): boolean | undefined => {
    const value = root.fields[name]; return value?.kind === "boolean" ? value.value : undefined;
  };
  const integer = (name: string): number | undefined => {
    const value = root.fields[name];
    if (value?.kind !== "number" || !/^-?(?:0|[1-9][0-9]*)$/u.test(value.value)) return undefined;
    const parsed = Number(value.value); return Number.isSafeInteger(parsed) ? parsed : undefined;
  };
  const requireText = (...names: readonly string[]): DecodeResult | null => {
    for (const name of names) if (text(name) === undefined) return decodeRejected("INVALID_FIELD", `Field ${name} must be text`);
    return null;
  };
  const requireBoolean = (...names: readonly string[]): DecodeResult | null => {
    for (const name of names) if (boolean(name) === undefined) return decodeRejected("INVALID_FIELD", `Field ${name} must be boolean`);
    return null;
  };
  const textRequirements: Readonly<Record<string, readonly string[]>> = {
    hello: ["deviceId", "protocolVersion"], paired: ["sessionId"], "command-result": ["id"], "mission-begin": ["id", "fileName", "sha256"], "mission-chunk": ["id", "data"], "mission-complete": ["id"], "mission-result": ["id"], "mission-phase": ["phase", "fileName"], "diagnostic-report": ["runId"], "diagnostic-ack": ["runId"]
  };
  const requiredTextResult = requireText(...(textRequirements[type.value] ?? []));
  if (requiredTextResult !== null) return requiredTextResult;
  if ((type.value === "paired" && root.fields.protocolVersion !== undefined && text("protocolVersion") === undefined) ||
      ((type.value === "command-result" || type.value === "mission-result") && root.fields.detail !== undefined && text("detail") === undefined) ||
      (type.value === "command-result" && root.fields.result !== undefined && root.fields.result.kind !== "object")) return decodeRejected("INVALID_FIELD", "Frame contains an invalid field");
  if (type.value === "command-result" || type.value === "mission-result") {
    const requiredBooleanResult = requireBoolean("ok"); if (requiredBooleanResult !== null) return requiredBooleanResult;
  }
  if (type.value === "mission-begin" && integer("size") === undefined) return decodeRejected("INVALID_FIELD", "Field size must be an integer");
  if (type.value === "mission-phase" && (integer("missionRevision") === undefined || integer("deviceGeneration") === undefined || integer("sequence") === undefined)) return decodeRejected("INVALID_FIELD", "Mission phase fields must be integers");
  if (type.value === "diagnostic-report") {
    const result = validate({ type: "diagnostic-report", runId: text("runId") as string, events: nativeJsonValue(root.fields.events as JsonValue) } as RelayFrame);
    return result.ok ? decoded(result.value) : Object.freeze({ kind: "rejected" as const, error: result.error });
  }
  if (type.value === "diagnostic-ack") {
    const acknowledgedSequence = integer("acknowledgedSequence");
    if (acknowledgedSequence === undefined) return decodeRejected("INVALID_FIELD", "Diagnostic acknowledgement sequence must be an integer");
    const result = validate({ type: "diagnostic-ack", runId: text("runId") as string, acknowledgedSequence });
    return result.ok ? decoded(result.value) : Object.freeze({ kind: "rejected" as const, error: result.error });
  }
  if (type.value === "mission-chunk") {
    const id = text("id"), data = text("data");
    const decodedData = base64Decode(data as string); if (!decodedData.ok) return Object.freeze({ kind: "rejected" as const, error: decodedData.error });
    const result = validate({ type: "mission-chunk", id: id as string, data: decodedData.value });
    return result.ok ? decoded(result.value) : Object.freeze({ kind: "rejected" as const, error: result.error });
  }
  if (type.value === "telemetry") {
    const payload = root.fields.payload, capabilities = root.fields.capabilities;
    const result = validate({ type: "telemetry", payload: payload as JsonObject, capabilities: capabilities as JsonObject });
    return result.ok ? decoded(result.value) : Object.freeze({ kind: "rejected" as const, error: result.error });
  }
  if (type.value === "command") {
    const command = root.fields.command;
    if (command === undefined || command.kind !== "object") return decodeRejected("INVALID_FIELD", "Command must be an object");
    const name = command.fields.name;
    if (name?.kind !== "string") return decodeRejected("INVALID_FIELD", "Field name must be text");
    const fields: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const [key, value] of Object.entries(command.fields)) if (key !== "name") fields[key] = value;
    const result = validate({ type: "command", id: text("id") as string, command: { name: name.value, fields } });
    return result.ok ? decoded(result.value) : Object.freeze({ kind: "rejected" as const, error: result.error });
  }
  const detail = (name: string): string | undefined => {
    const value = root.fields[name];
    // Result detail types are checked before this helper is called. Keeping the
    // optional field normalization here avoids a second, unreachable type branch.
    return value === undefined ? "" : (value as JsonString).value;
  };
  const candidate: unknown = type.value === "hello" ? { type: "hello", deviceId: text("deviceId"), protocolVersion: text("protocolVersion") }
    : type.value === "paired" ? { type: "paired", sessionId: text("sessionId"), protocolVersion: root.fields.protocolVersion === undefined ? null : text("protocolVersion") }
    : type.value === "command-result" ? { type: "command-result", id: text("id"), ok: boolean("ok"), detail: detail("detail"), ...(root.fields.result === undefined ? {} : { result: root.fields.result }) }
    : type.value === "mission-result" ? { type: "mission-result", id: text("id"), ok: boolean("ok"), detail: detail("detail") }
    : type.value === "mission-begin" ? { type: "mission-begin", id: text("id"), fileName: text("fileName"), size: integer("size"), sha256: text("sha256") }
    : type.value === "mission-phase" ? { type: "mission-phase", missionRevision: integer("missionRevision"), deviceGeneration: integer("deviceGeneration"), sequence: integer("sequence"), phase: text("phase"), fileName: text("fileName") }
    : { type: "mission-complete", id: text("id") };
  const result = validate(candidate as RelayFrame);
  return result.ok ? decoded(result.value) : Object.freeze({ kind: "rejected" as const, error: result.error });
}

function encode(frame: RelayFrame): ProtocolResult<Uint8Array> {
  const normalized = validate(frame); if (!normalized.ok) return normalized;
  try {
    const bytes = encoder.encode(encodeText(normalized.value));
    return bytes.byteLength > ProtocolLimits.maxFrameBytes ? rejected("FRAME_TOO_LARGE", "Frame exceeds the allowed size") : accepted(bytes);
  } catch { return rejected("INVALID_JSON", "Frame cannot be encoded"); }
}

function decode(bytes: Uint8Array): DecodeResult {
  if (!(bytes instanceof Uint8Array)) return decodeRejected("INVALID_FIELD", "Frame bytes are invalid");
  if (bytes.byteLength === 0) return decodeRejected("INVALID_JSON", "Frame is empty");
  if (bytes.byteLength > ProtocolLimits.maxFrameBytes) return decodeRejected("FRAME_TOO_LARGE", "Frame exceeds the allowed size");
  let source: string; try { source = decoder.decode(bytes); } catch { return decodeRejected("INVALID_UTF8", "Frame is not valid UTF-8"); }
  try { const root = new StrictJsonParser(source).parse(); return root.kind === "object" ? decodeKnown(root) : decodeRejected("INVALID_JSON", "Frame must be a JSON object"); } catch { return decodeRejected("INVALID_JSON", "Frame is not valid JSON"); }
}

export const RelayFrameCodec = Object.freeze({ encode, decode });
