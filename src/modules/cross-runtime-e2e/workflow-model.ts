export type MissionModelPhase =
  | "idle" | "staging" | "staged" | "uploading" | "uploaded" | "starting" | "running"
  | "pausing" | "paused" | "resuming" | "stopping" | "completed" | "failed" | "disconnected";

export type MissionModelEvent =
  | "stage-requested" | "stage-succeeded" | "upload-requested" | "upload-succeeded"
  | "start-requested" | "start-succeeded" | "pause-requested" | "pause-succeeded"
  | "resume-requested" | "resume-succeeded" | "stop-requested" | "stop-succeeded"
  | "mission-completed" | "operation-failed" | "connection-lost" | "reset";

export type ModelTransition<S extends string> = Readonly<
  { readonly accepted: true; readonly next: S } | { readonly accepted: false; readonly next: S }
>;

const states = Object.freeze([
  "idle", "staging", "staged", "uploading", "uploaded", "starting", "running",
  "pausing", "paused", "resuming", "stopping", "completed", "failed", "disconnected",
] as const satisfies readonly MissionModelPhase[]);

const events = Object.freeze([
  "stage-requested", "stage-succeeded", "upload-requested", "upload-succeeded",
  "start-requested", "start-succeeded", "pause-requested", "pause-succeeded",
  "resume-requested", "resume-succeeded", "stop-requested", "stop-succeeded",
  "mission-completed", "operation-failed", "connection-lost", "reset",
] as const satisfies readonly MissionModelEvent[]);

const direct: Readonly<Partial<Record<MissionModelEvent, Readonly<Partial<Record<MissionModelPhase, MissionModelPhase>>>>>> = Object.freeze({
  "stage-requested": Object.freeze({ idle: "staging", completed: "staging", failed: "staging", disconnected: "staging" }),
  "stage-succeeded": Object.freeze({ staging: "staged" }),
  "upload-requested": Object.freeze({ staged: "uploading" }),
  "upload-succeeded": Object.freeze({ uploading: "uploaded" }),
  "start-requested": Object.freeze({ uploaded: "starting" }),
  "start-succeeded": Object.freeze({ starting: "running" }),
  "pause-requested": Object.freeze({ running: "pausing" }),
  "pause-succeeded": Object.freeze({ pausing: "paused" }),
  "resume-requested": Object.freeze({ paused: "resuming" }),
  "resume-succeeded": Object.freeze({ resuming: "running" }),
  "stop-requested": Object.freeze({ starting: "stopping", running: "stopping", pausing: "stopping", paused: "stopping", resuming: "stopping", disconnected: "stopping" }),
  "stop-succeeded": Object.freeze({ stopping: "idle" }),
  "mission-completed": Object.freeze({ starting: "completed", running: "completed", disconnected: "completed" }),
  "operation-failed": Object.freeze({
    staging: "failed", uploading: "failed", starting: "failed", running: "failed",
    pausing: "failed", paused: "failed", resuming: "failed", stopping: "failed", disconnected: "failed",
  }),
  "connection-lost": Object.freeze({
    staging: "disconnected", staged: "disconnected", uploading: "disconnected", uploaded: "disconnected",
    starting: "disconnected", running: "disconnected", pausing: "disconnected", paused: "disconnected",
    resuming: "disconnected", stopping: "disconnected",
  }),
});

const evaluate = (state: MissionModelPhase, event: MissionModelEvent): ModelTransition<MissionModelPhase> => {
  if (event === "reset") return Object.freeze({ accepted: true as const, next: "idle" as const });
  const next = direct[event]![state];
  return next === undefined
    ? Object.freeze({ accepted: false as const, next: state })
    : Object.freeze({ accepted: true as const, next });
};

const audit = (): Readonly<{
  readonly states: number;
  readonly events: number;
  readonly total: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly reachableStates: number;
}> => {
  let accepted = 0;
  const reachable = new Set<MissionModelPhase>(["idle"]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const state of [...reachable]) for (const event of Object.keys(direct) as Exclude<MissionModelEvent, "reset">[]) {
      const result = evaluate(state, event);
      if (result.accepted && !reachable.has(result.next)) { reachable.add(result.next); changed = true; }
    }
  }
  for (const state of states) for (const event of events) if (evaluate(state, event).accepted) accepted += 1;
  const total = states.length * events.length;
  return Object.freeze({
    states: states.length,
    events: events.length,
    total,
    accepted,
    rejected: total - accepted,
    reachableStates: reachable.size,
  });
};

const generate = <T>(seed: number, length: number, values: readonly T[]): readonly T[] => {
  if (!Number.isInteger(seed) || !Number.isInteger(length) || length < 0 || values.length === 0) throw new Error("Invalid deterministic sequence configuration");
  let state = seed >>> 0;
  const output: T[] = [];
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    output.push(values[state % values.length]!);
  }
  return Object.freeze(output);
};

const minimize = async <T>(
  sequence: readonly T[],
  stillFails: (candidate: readonly T[]) => Promise<boolean>,
): Promise<readonly T[]> => {
  let current = [...sequence];
  if (!(await stillFails(current))) throw new Error("Initial sequence does not reproduce the failure");
  let granularity = 2;
  while (current.length >= 2) {
    const chunkSize = Math.ceil(current.length / granularity);
    let reduced = false;
    for (let start = 0; start < current.length; start += chunkSize) {
      const candidate = [...current.slice(0, start), ...current.slice(start + chunkSize)];
      if (await stillFails(candidate)) {
        current = candidate;
        granularity = 2;
        reduced = true;
        break;
      }
    }
    if (!reduced) {
      if (granularity >= current.length) break;
      granularity = Math.min(current.length, granularity * 2);
    }
  }
  return Object.freeze(current);
};

export const WorkflowModel = Object.freeze({
  mission: Object.freeze({ states, events, evaluate, audit }),
  generate,
  minimize,
});
