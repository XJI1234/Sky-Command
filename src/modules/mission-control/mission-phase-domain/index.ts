export type MissionPhase =
  | "idle"
  | "staging"
  | "staged"
  | "uploading"
  | "uploaded"
  | "starting"
  | "running"
  | "pausing"
  | "paused"
  | "resuming"
  | "stopping"
  | "completed"
  | "failed"
  | "disconnected";

export interface MissionPhaseState {
  readonly missionId: string | null;
  readonly phase: MissionPhase;
  readonly failureCode: string | null;
}

export type MissionPhaseEvent =
  | Readonly<{ type: "stage-requested"; missionId: string }>
  | Readonly<{ type: "stage-succeeded"; missionId: string }>
  | Readonly<{ type: "upload-requested" }>
  | Readonly<{ type: "upload-succeeded" }>
  | Readonly<{ type: "start-requested" }>
  | Readonly<{ type: "start-succeeded" }>
  | Readonly<{ type: "pause-requested" }>
  | Readonly<{ type: "pause-succeeded" }>
  | Readonly<{ type: "resume-requested" }>
  | Readonly<{ type: "resume-succeeded" }>
  | Readonly<{ type: "stop-requested" }>
  | Readonly<{ type: "stop-succeeded" }>
  | Readonly<{ type: "mission-completed" }>
  | Readonly<{ type: "operation-failed"; code: string }>
  | Readonly<{ type: "connection-lost" }>
  | Readonly<{ type: "reset" }>;

export type MissionPhaseErrorCode = "INVALID_EVENT" | "INVALID_MISSION_ID" | "MISSION_ID_MISMATCH" | "ILLEGAL_TRANSITION";

export interface MissionPhaseError {
  readonly code: MissionPhaseErrorCode;
  readonly currentPhase: MissionPhase;
  readonly message: string;
}

export type TransitionResult = Readonly<{ ok: true; state: MissionPhaseState }> | Readonly<{ ok: false; error: MissionPhaseError }>;

export interface MissionPhaseMachine {
  readonly state: () => MissionPhaseState;
  readonly transition: (event: MissionPhaseEvent) => TransitionResult;
  readonly reset: () => MissionPhaseState;
}

const PHASES: readonly MissionPhase[] = Object.freeze(["idle", "staging", "staged", "uploading", "uploaded", "starting", "running", "pausing", "paused", "resuming", "stopping", "completed", "failed", "disconnected"]);
const STAGEABLE: readonly MissionPhase[] = Object.freeze(["idle", "completed", "failed", "disconnected"]);
const DISCONNECTABLE: readonly MissionPhase[] = Object.freeze(["staging", "staged", "uploading", "uploaded", "starting", "running", "pausing", "paused", "resuming", "stopping"]);
const FAILUREABLE: readonly MissionPhase[] = Object.freeze(["staging", "uploading", "starting", "running", "pausing", "paused", "resuming", "stopping", "disconnected"]);
const STOPPABLE: readonly MissionPhase[] = Object.freeze(["starting", "running", "pausing", "paused", "resuming", "disconnected"]);
const EVENT_TYPES: readonly string[] = Object.freeze(["stage-requested", "stage-succeeded", "upload-requested", "upload-succeeded", "start-requested", "start-succeeded", "pause-requested", "pause-succeeded", "resume-requested", "resume-succeeded", "stop-requested", "stop-succeeded", "mission-completed", "operation-failed", "connection-lost", "reset", "__invalid__"]);

const idleState = (): MissionPhaseState => Object.freeze({ missionId: null, phase: "idle", failureCode: null });
const validText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= 128 && !/[\p{Cc}]/u.test(value);
const isPhase = (value: unknown): value is MissionPhase => typeof value === "string" && PHASES.includes(value as MissionPhase);
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";

type EventTypeReadResult = "invalid" | "unreadable" | Readonly<{ type: string }>;

const readEventType = (event: unknown): EventTypeReadResult => {
  if (!isObject(event)) return "invalid";

  let type: unknown;
  try {
    type = event.type;
  } catch {
    return "unreadable";
  }

  if (!EVENT_TYPES.includes(type as string)) return "invalid";
  return Object.freeze({ type: type as string });
};

const makeState = (missionId: string | null, phase: MissionPhase, failureCode: string | null): MissionPhaseState => Object.freeze({ missionId, phase, failureCode });
const validState = (value: unknown): value is MissionPhaseState => {
  if (!isObject(value) || !isPhase(value.phase)) return false;
  if (value.phase === "idle") return value.missionId === null && value.failureCode === null;
  if (!validText(value.missionId)) return false;
  return value.phase === "failed" ? validText(value.failureCode) : value.failureCode === null;
};

const error = (code: MissionPhaseErrorCode, phase: MissionPhase, message: string): TransitionResult => Object.freeze({ ok: false as const, error: Object.freeze({ code, currentPhase: phase, message }) });
const success = (state: MissionPhaseState): TransitionResult => Object.freeze({ ok: true as const, state });
const includes = (values: readonly MissionPhase[], value: MissionPhase): boolean => values.includes(value);

function create(initial?: MissionPhaseState): MissionPhaseMachine {
  let current = idleState();
  try {
    if (validState(initial)) current = makeState(initial.missionId, initial.phase, initial.failureCode);
  } catch {
    current = idleState();
  }

  const transition = (event: MissionPhaseEvent): TransitionResult => {
    const parsedType = readEventType(event);
    if (parsedType === "unreadable") return error("INVALID_EVENT", current.phase, "Mission event type cannot be read");
    if (parsedType === "invalid") return error("INVALID_EVENT", current.phase, "Mission event is invalid");
    const type = parsedType.type;

    try {
      if (type === "reset") { current = idleState(); return success(current); }
      if (type === "stage-requested") {
        const missionId = (event as unknown as { missionId?: unknown }).missionId;
        if (!validText(missionId)) return error("INVALID_MISSION_ID", current.phase, "Mission ID is invalid");
        if (!includes(STAGEABLE, current.phase)) return error("ILLEGAL_TRANSITION", current.phase, "Mission transition is not allowed");
        current = makeState(missionId, "staging", null); return success(current);
      }
      if (current.missionId === null) return error("ILLEGAL_TRANSITION", current.phase, "Mission transition is not allowed");
      if (type === "stage-succeeded") {
        const missionId = (event as unknown as { missionId?: unknown }).missionId;
        if (!validText(missionId)) return error("INVALID_MISSION_ID", current.phase, "Mission ID is invalid");
        if (missionId !== current.missionId) return error("MISSION_ID_MISMATCH", current.phase, "Mission ID does not match");
        if (current.phase !== "staging") return error("ILLEGAL_TRANSITION", current.phase, "Mission transition is not allowed");
        current = makeState(current.missionId, "staged", null); return success(current);
      }
      if (type === "upload-requested") {
        if (current.phase !== "staged") return error("ILLEGAL_TRANSITION", current.phase, "Mission transition is not allowed");
        current = makeState(current.missionId, "uploading", null); return success(current);
      }
      if (type === "upload-succeeded") {
        if (current.phase !== "uploading") return error("ILLEGAL_TRANSITION", current.phase, "Mission transition is not allowed");
        current = makeState(current.missionId, "uploaded", null); return success(current);
      }
      if (type === "start-requested") {
        if (current.phase !== "uploaded") return error("ILLEGAL_TRANSITION", current.phase, "Mission transition is not allowed");
        current = makeState(current.missionId, "starting", null); return success(current);
      }
      if (type === "start-succeeded") {
        if (current.phase !== "starting") return error("ILLEGAL_TRANSITION", current.phase, "Mission transition is not allowed");
        current = makeState(current.missionId, "running", null); return success(current);
      }
      if (type === "pause-requested") {
        if (current.phase !== "running") return error("ILLEGAL_TRANSITION", current.phase, "Mission transition is not allowed");
        current = makeState(current.missionId, "pausing", null); return success(current);
      }
      if (type === "pause-succeeded") {
        if (current.phase !== "pausing") return error("ILLEGAL_TRANSITION", current.phase, "Mission transition is not allowed");
        current = makeState(current.missionId, "paused", null); return success(current);
      }
      if (type === "resume-requested") {
        if (current.phase !== "paused") return error("ILLEGAL_TRANSITION", current.phase, "Mission transition is not allowed");
        current = makeState(current.missionId, "resuming", null); return success(current);
      }
      if (type === "resume-succeeded") {
        if (current.phase !== "resuming") return error("ILLEGAL_TRANSITION", current.phase, "Mission transition is not allowed");
        current = makeState(current.missionId, "running", null); return success(current);
      }
      if (type === "stop-requested") {
        if (!includes(STOPPABLE, current.phase)) return error("ILLEGAL_TRANSITION", current.phase, "Mission transition is not allowed");
        current = makeState(current.missionId, "stopping", null); return success(current);
      }
      if (type === "stop-succeeded") {
        if (current.phase !== "stopping") return error("ILLEGAL_TRANSITION", current.phase, "Mission transition is not allowed");
        current = idleState(); return success(current);
      }
      if (type === "mission-completed") {
        if (current.phase !== "starting" && current.phase !== "running" && current.phase !== "disconnected") return error("ILLEGAL_TRANSITION", current.phase, "Mission transition is not allowed");
        current = makeState(current.missionId, "completed", null); return success(current);
      }
      if (type === "operation-failed") {
        const code = (event as unknown as { code?: unknown }).code;
        if (!validText(code)) return error("INVALID_EVENT", current.phase, "Mission event is invalid");
        if (!includes(FAILUREABLE, current.phase)) return error("ILLEGAL_TRANSITION", current.phase, "Mission transition is not allowed");
        current = makeState(current.missionId, "failed", code); return success(current);
      }
      if (type === "connection-lost") {
        if (!includes(DISCONNECTABLE, current.phase)) return error("ILLEGAL_TRANSITION", current.phase, "Mission transition is not allowed");
        current = makeState(current.missionId, "disconnected", null); return success(current);
      }
      return error("INVALID_EVENT", current.phase, "Mission event is invalid");
    } catch {
      return error("INVALID_EVENT", current.phase, "Mission event is invalid");
    }
  };

  return Object.freeze({ state: () => current, transition, reset: () => { current = idleState(); return current; } });
}

export const MissionPhaseDomain = Object.freeze({ create });
