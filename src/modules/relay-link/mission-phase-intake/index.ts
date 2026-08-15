export type MissionPhase = "START_POINT_REACHED" | "ROUTE_EXECUTION_STARTED";

export interface MissionPhaseInput {
  readonly connectionId: string;
  readonly missionRevision: number;
  readonly deviceGeneration: number;
  readonly sequence: number;
  readonly phase: MissionPhase;
  readonly fileName: string;
}

export interface MissionPhaseFact extends MissionPhaseInput {}
export interface MissionPhaseIntakeError { readonly code: "INVALID_MISSION_PHASE" | "STALE_MISSION_PHASE"; }
export type MissionPhaseIntakeResult = Readonly<{ readonly ok: true; readonly value: MissionPhaseFact }> | Readonly<{ readonly ok: false; readonly error: MissionPhaseIntakeError }>;
export interface MissionPhaseIntakeInstance {
  readonly accept: (input: MissionPhaseInput) => MissionPhaseIntakeResult;
  readonly get: (connectionId: string) => MissionPhaseFact | null;
  readonly remove: (connectionId: string) => void;
  readonly snapshot: () => readonly MissionPhaseFact[];
}

const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
const validFileName = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && value.toLowerCase().endsWith(".kmz") && !value.includes("..") && !/[\\/\p{Cc}]/u.test(value);
const validPhase = (value: unknown): value is MissionPhase => value === "START_POINT_REACHED" || value === "ROUTE_EXECUTION_STARTED";
const validPositiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const invalid = (): MissionPhaseIntakeResult => Object.freeze({ ok: false as const, error: Object.freeze({ code: "INVALID_MISSION_PHASE" as const }) });
const stale = (): MissionPhaseIntakeResult => Object.freeze({ ok: false as const, error: Object.freeze({ code: "STALE_MISSION_PHASE" as const }) });

function read(input: unknown): MissionPhaseInput | null {
  try {
    if (input === null || typeof input !== "object") return null;
    const value = input as Record<string, unknown>;
    const connectionId = value.connectionId;
    const missionRevision = value.missionRevision;
    const deviceGeneration = value.deviceGeneration;
    const sequence = value.sequence;
    const phase = value.phase;
    const fileName = value.fileName;
    if (!validId(connectionId) || !validPositiveInteger(missionRevision) || typeof deviceGeneration !== "number" || !Number.isSafeInteger(deviceGeneration) || deviceGeneration < 0 || !validPositiveInteger(sequence) || !validPhase(phase) || !validFileName(fileName)) return null;
    return Object.freeze({ connectionId, missionRevision, deviceGeneration, sequence, phase, fileName });
  } catch {
    return null;
  }
}

function create(): MissionPhaseIntakeInstance {
  const facts = new Map<string, MissionPhaseFact>();
  const accept = (input: MissionPhaseInput): MissionPhaseIntakeResult => {
    const parsed = read(input);
    if (parsed === null) return invalid();
    const previous = facts.get(parsed.connectionId);
    if (previous !== undefined) {
      if (parsed.deviceGeneration < previous.deviceGeneration) return stale();
      if (parsed.deviceGeneration === previous.deviceGeneration && parsed.missionRevision < previous.missionRevision) return stale();
      if (
        parsed.deviceGeneration === previous.deviceGeneration &&
        parsed.missionRevision === previous.missionRevision &&
        parsed.sequence <= previous.sequence
      ) return stale();
    }
    const value = Object.freeze({ ...parsed });
    facts.set(value.connectionId, value);
    return Object.freeze({ ok: true as const, value });
  };
  const get = (connectionId: string): MissionPhaseFact | null => validId(connectionId) ? facts.get(connectionId) ?? null : null;
  const remove = (connectionId: string): void => { if (validId(connectionId)) facts.delete(connectionId); };
  const snapshot = (): readonly MissionPhaseFact[] => Object.freeze([...facts.values()].map((value) => Object.freeze({ ...value })));
  return Object.freeze({ accept, get, remove, snapshot });
}

export const MissionPhaseIntake = Object.freeze({ create });
