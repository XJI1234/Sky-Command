export type RelayMissionPhase = "START_POINT_REACHED" | "ROUTE_EXECUTION_STARTED";

export interface RelayMissionPhaseSnapshot {
  readonly deviceId: string;
  readonly missionRevision: number;
  readonly deviceGeneration: number;
  readonly sequence: number;
  readonly phase: RelayMissionPhase;
  readonly fileName: string;
}
export interface RelayMissionTerminalState {
  readonly deviceId: string;
  readonly fileName: string;
  readonly outcome: "completed" | "failed";
  readonly missionRevision: number;
  readonly deviceGeneration: number;
}

const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
const validFileName = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && value.toLowerCase().endsWith(".kmz") && !value.includes("..") && !/[\\/\p{Cc}]/u.test(value);
const positiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const phase = (value: unknown): value is RelayMissionPhase => value === "START_POINT_REACHED" || value === "ROUTE_EXECUTION_STARTED";
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
const jsonText = (value: unknown): string | undefined => {
  const source = record(value);
  if (source === null) return undefined;
  try {
    if (source.kind !== "string") return undefined;
    const text = source.value;
    return typeof text === "string" ? text : undefined;
  } catch { return undefined; }
};
const jsonInteger = (value: unknown): number | undefined => {
  const source = record(value);
  if (source === null) return undefined;
  try {
    if (source.kind !== "number" || typeof source.value !== "string" || !/^-?(?:0|[1-9][0-9]*)$/u.test(source.value)) return undefined;
    const number = Number(source.value);
    return Number.isSafeInteger(number) ? number : undefined;
  } catch { return undefined; }
};
const payloadText = (payload: unknown, field: string): string | undefined => {
  const source = record(payload);
  if (source === null) return undefined;
  try {
    if (source.kind === "object") {
      const fields = record(source.fields);
      return fields === null ? undefined : jsonText(fields[field]);
    }
    const text = source[field];
    return typeof text === "string" ? text : undefined;
  } catch { return undefined; }
};
const payloadInteger = (payload: unknown, field: string): number | undefined => {
  const source = record(payload);
  if (source === null) return undefined;
  try {
    if (source.kind === "object") {
      const fields = record(source.fields);
      return fields === null ? undefined : jsonInteger(fields[field]);
    }
    const number = source[field];
    return typeof number === "number" && Number.isSafeInteger(number) ? number : undefined;
  } catch { return undefined; }
};

function read(value: unknown): readonly RelayMissionPhaseSnapshot[] | null {
  try {
    if (value === null || typeof value !== "object") return null;
    const rawFacts = (value as { readonly missionPhases?: unknown }).missionPhases;
    if (!Array.isArray(rawFacts)) return null;
    const facts: RelayMissionPhaseSnapshot[] = [];
    for (const raw of rawFacts) {
      if (raw === null || typeof raw !== "object") return null;
      const entry = raw as Record<string, unknown>;
      const deviceId = entry.deviceId;
      const missionRevision = entry.missionRevision;
      const deviceGeneration = entry.deviceGeneration;
      const sequence = entry.sequence;
      const currentPhase = entry.phase;
      const fileName = entry.fileName;
      if (!validId(deviceId) || !positiveInteger(missionRevision) || typeof deviceGeneration !== "number" || !Number.isSafeInteger(deviceGeneration) || deviceGeneration < 0 || !positiveInteger(sequence) || !phase(currentPhase) || !validFileName(fileName)) return null;
      facts.push(Object.freeze({ deviceId, missionRevision, deviceGeneration, sequence, phase: currentPhase, fileName }));
    }
    return Object.freeze(facts);
  } catch {
    return null;
  }
}

function readTerminalStates(value: unknown): readonly RelayMissionTerminalState[] | null {
  try {
    const root = record(value);
    const rawTelemetry = root?.telemetry;
    if (!Array.isArray(rawTelemetry)) return null;
    const facts: RelayMissionTerminalState[] = [];
    for (const raw of rawTelemetry) {
      const entry = record(raw);
      if (entry === null || !validId(entry.deviceId)) return null;
      const execution = payloadText(entry.payload, "missionExecution");
      if (execution !== "FINISHED" && execution !== "FAILED") continue;
      const fileName = payloadText(entry.payload, "missionFileName");
      const missionRevision = payloadInteger(entry.payload, "missionRevision");
      const deviceGeneration = payloadInteger(entry.payload, "missionDeviceGeneration");
      if (!validFileName(fileName) || !positiveInteger(missionRevision) || deviceGeneration === undefined || deviceGeneration < 0) return null;
      facts.push(Object.freeze({ deviceId: entry.deviceId, fileName, outcome: execution === "FINISHED" ? "completed" as const : "failed" as const, missionRevision, deviceGeneration }));
    }
    return Object.freeze(facts);
  } catch {
    return null;
  }
}

export const RelayMissionPhaseSnapshotReader = Object.freeze({ read, readTerminalStates });
