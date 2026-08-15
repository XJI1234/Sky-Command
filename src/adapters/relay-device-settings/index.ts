import type { CameraSettings, CameraSettingsPatch, DeviceSettingsPort, PortResult, TransmissionSettings, TransmissionSettingsPatch } from "../../modules/device-console/device-settings-panel/index.js";
import type { JsonObject, JsonValue } from "../../modules/relay-link/protocol-core/index.js";

export interface RelaySettingsGateway {
  readonly sendCommand: (deviceId: string, request: Readonly<{ readonly name: string; readonly fields: JsonObject["fields"] }>) => Promise<unknown>;
}

type SettingsOutcome = "rejected" | "timed-out" | "transport-failed";
type UnknownRecord = Record<string, unknown>;

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
const token = (value: unknown): value is string => typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(value);
const record = (value: unknown): UnknownRecord | null => value !== null && typeof value === "object" ? value as UnknownRecord : null;
const failed = <T>(reason: SettingsOutcome): PortResult<T> => freeze({ ok: false as const, reason });
const succeeded = <T>(value: T): PortResult<T> => freeze({ ok: true as const, value });
const jsonString = (value: string): JsonValue => freeze({ kind: "string" as const, value });
const jsonBoolean = (value: boolean): JsonValue => freeze({ kind: "boolean" as const, value });
const fields = (value: Record<string, JsonValue>): JsonObject["fields"] => freeze({ ...value });

function property(value: unknown, name: string): unknown {
  const source = record(value);
  if (source === null) return undefined;
  /* c8 ignore next -- hostile getter behavior is externally covered by the stable transport failure path. */
  try { return source[name]; } catch { return undefined; }
}

function objectField(value: JsonObject, name: string): JsonObject | null {
  const field = property(value.fields, name);
  return record(field)?.kind === "object" && record(field)?.fields !== undefined ? field as JsonObject : null;
}

function stringField(value: JsonObject, name: string): string | null {
  const field = property(value.fields, name);
  return record(field)?.kind === "string" && typeof record(field)?.value === "string" ? record(field)?.value as string : null;
}

function booleanField(value: JsonObject, name: string): boolean | null {
  const field = property(value.fields, name);
  return record(field)?.kind === "boolean" && typeof record(field)?.value === "boolean" ? record(field)?.value as boolean : null;
}

function rateField(value: JsonObject, name: string): number | null | undefined {
  const field = property(value.fields, name);
  const source = record(field);
  if (source?.kind === "null") return null;
  if (source?.kind !== "number" || typeof source.value !== "string" || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u.test(source.value)) return undefined;
  const parsed = Number(source.value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function cameraSnapshot(value: unknown): CameraSettings | null {
  const source = record(value);
  if (source?.kind !== "object" || stringField(value as JsonObject, "domain") !== "camera") return null;
  const settings = objectField(value as JsonObject, "settings");
  if (settings === null) return null;
  const autoExposureLockEnabled = booleanField(settings, "autoExposureLockEnabled");
  const focusMode = stringField(settings, "focusMode");
  const cameraIndex = stringField(settings, "cameraIndex");
  return autoExposureLockEnabled === null || !token(focusMode) || !token(cameraIndex) ? null : freeze({ autoExposureLockEnabled, focusMode, cameraIndex });
}

function transmissionSnapshot(value: unknown): TransmissionSettings | null {
  const source = record(value);
  if (source === null || source.kind !== "object" || stringField(value as JsonObject, "domain") !== "transmission") return null;
  const settings = objectField(value as JsonObject, "settings");
  if (settings === null) return null;
  const frequencyBand = stringField(settings, "frequencyBand");
  const channelSelectionMode = stringField(settings, "channelSelectionMode");
  const bandwidth = stringField(settings, "bandwidth");
  const dynamicDataRateMbps = rateField(settings, "dynamicDataRateMbps");
  return !token(frequencyBand) || !token(channelSelectionMode) || !token(bandwidth) || dynamicDataRateMbps === undefined ? null : freeze({ frequencyBand, channelSelectionMode, bandwidth, dynamicDataRateMbps });
}

function cameraPatch(value: unknown): JsonObject["fields"] | null {
  const source = record(value);
  if (source === null) return null;
  try {
    const keys = Object.keys(source);
    if (keys.length === 0 || keys.some((key) => key !== "autoExposureLockEnabled" && key !== "focusMode")) return null;
    const next: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    if (source.autoExposureLockEnabled !== undefined) { if (typeof source.autoExposureLockEnabled !== "boolean") return null; next.autoExposureLockEnabled = jsonBoolean(source.autoExposureLockEnabled); }
    if (source.focusMode !== undefined) { if (!token(source.focusMode)) return null; next.focusMode = jsonString(source.focusMode); }
    return fields(next);
  } catch { return null; }
}

function transmissionPatch(value: unknown): JsonObject["fields"] | null {
  const source = record(value);
  if (source === null) return null;
  try {
    const keys = Object.keys(source);
    if (keys.length === 0 || keys.some((key) => key !== "frequencyBand" && key !== "channelSelectionMode" && key !== "bandwidth")) return null;
    const next: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const key of keys) { const current = source[key]; if (!token(current)) return null; next[key] = jsonString(current); }
    return fields(next);
  } catch { return null; }
}

async function request<T>(relay: RelaySettingsGateway, deviceId: string, name: string, commandFields: JsonObject["fields"], decode: (value: unknown) => T | null): Promise<PortResult<T>> {
  try {
    const outcome = record(await relay.sendCommand(deviceId, freeze({ name, fields: commandFields })));
    const status = property(outcome, "status");
    if (status === "timed-out") return failed("timed-out");
    if (status === "disconnected") return failed("transport-failed");
    if (status !== "succeeded") return failed("rejected");
    const value = decode(property(outcome, "result"));
    return value === null ? failed("rejected") : succeeded(value);
  } catch { return failed("transport-failed"); }
}

function create(dependencies: Readonly<{ readonly relay: RelaySettingsGateway }>): DeviceSettingsPort {
  const empty = fields(Object.create(null) as Record<string, JsonValue>);
  return freeze({
    readTransmission: (deviceId: string) => request(dependencies.relay, deviceId, "device.settings.transmission.read", empty, transmissionSnapshot),
    writeTransmission: (deviceId: string, patch: TransmissionSettingsPatch) => { const value = transmissionPatch(patch); return value === null ? Promise.resolve(failed("rejected")) : request(dependencies.relay, deviceId, "device.settings.transmission.write", value, transmissionSnapshot); },
    readCamera: (deviceId: string) => request(dependencies.relay, deviceId, "device.settings.camera.read", empty, cameraSnapshot),
    writeCamera: (deviceId: string, patch: CameraSettingsPatch) => { const value = cameraPatch(patch); return value === null ? Promise.resolve(failed("rejected")) : request(dependencies.relay, deviceId, "device.settings.camera.write", value, cameraSnapshot); }
  });
}

export const RelayDeviceSettings = freeze({ create });
