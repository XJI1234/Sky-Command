export type TranscodePhase = "idle" | "running" | "stopping" | "stopped" | "failed";

export interface TranscodeJob {
  readonly streamId: string;
  readonly executablePath: string;
  readonly inputUrl: string;
  readonly outputDirectory: string;
}

export interface ProcessExit { readonly kind: "exited" | "failed"; }
export interface ProcessHandle { readonly terminate: () => void; }
export interface TranscoderProcessPort {
  readonly launch: (job: TranscodeJob, onExit: (event: ProcessExit) => void) => ProcessHandle;
}

export interface TranscodeSnapshot {
  readonly streamId: string | null;
  readonly phase: TranscodePhase;
  readonly revision: number;
  readonly diagnostic: string | null;
}

export type StartResult =
  | Readonly<{ readonly ok: true; readonly value: TranscodeSnapshot }>
  | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" | "ALREADY_ACTIVE" | "LAUNCH_FAILED"; readonly value: TranscodeSnapshot }>;
export type StopResult =
  | Readonly<{ readonly ok: true; readonly value: TranscodeSnapshot }>
  | Readonly<{ readonly ok: false; readonly code: "NOT_RUNNING" | "STOP_FAILED"; readonly value: TranscodeSnapshot }>;

export interface TranscodeRunnerInstance {
  readonly start: (job: unknown) => StartResult;
  readonly stop: () => StopResult;
  readonly snapshot: () => TranscodeSnapshot;
}

interface State {
  readonly streamId: string | null;
  readonly phase: TranscodePhase;
  readonly revision: number;
  readonly diagnostic: string | null;
}

interface ActiveRun { readonly token: object; readonly handle: ProcessHandle; }

const LAUNCH_FAILED = "转码进程未能启动。请检查 FFmpeg 与输入流。";
const EXITED_UNEXPECTEDLY = "转码进程异常结束。请检查 FFmpeg 与输入流。";
const STOP_FAILED = "无法停止转码进程。请检查 FFmpeg 与输入流。";

function freeze<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }

function initial(): State { return { streamId: null, phase: "idle", revision: 0, diagnostic: null }; }

function snapshot(state: State): TranscodeSnapshot { return freeze({ ...state }); }

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validStreamId(value: unknown): value is string {
  return validText(value) && value.length <= 128 && !value.includes("\0");
}

function transcodeJob(value: unknown): TranscodeJob | null {
  if (value == null) return null;
  const raw = value as TranscodeJob;
  if (!validStreamId(raw.streamId)) return null;
  if (!validText(raw.executablePath)) return null;
  if (!validText(raw.inputUrl)) return null;
  if (!validText(raw.outputDirectory)) return null;
  return raw;
}

function processPort(value: unknown): value is TranscoderProcessPort {
  return value != null && typeof (value as TranscoderProcessPort).launch === "function";
}

function processHandle(value: unknown): value is ProcessHandle {
  return typeof (value as ProcessHandle).terminate === "function";
}

function create(port: TranscoderProcessPort): TranscodeRunnerInstance {
  if (!processPort(port)) throw new TypeError("Invalid transcoder process port");
  let state = initial();
  let active: ActiveRun | null = null;

  const transition = (next: Omit<State, "revision">): TranscodeSnapshot => {
    state = { ...next, revision: state.revision + 1 };
    return snapshot(state);
  };

  const unexpectedExit = (token: object): void => {
    if (active === null) return;
    if (active.token !== token) return;
    active = null;
    if (state.phase === "stopping") {
      transition({ streamId: state.streamId, phase: "stopped", diagnostic: null });
      return;
    }
    transition({ streamId: state.streamId, phase: "failed", diagnostic: EXITED_UNEXPECTEDLY });
  };

  return freeze({
    snapshot: () => snapshot(state),
    start: (input) => {
      const job = transcodeJob(input);
      if (job === null) return freeze({ ok: false as const, code: "INVALID_INPUT" as const, value: snapshot(state) });
      if (state.phase === "running" || state.phase === "stopping") return freeze({ ok: false as const, code: "ALREADY_ACTIVE" as const, value: snapshot(state) });

      const token = freeze({});
      let exitedDuringLaunch = false;
      let launching = true;
      state = { streamId: job.streamId, phase: "running", revision: state.revision + 1, diagnostic: null };
      try {
        const handle = port.launch(job, () => {
          if (launching) exitedDuringLaunch = true;
          else unexpectedExit(token);
        });
        launching = false;
        if (!processHandle(handle)) throw new TypeError("Invalid process handle");
        if (exitedDuringLaunch) {
          transition({ streamId: state.streamId, phase: "failed", diagnostic: EXITED_UNEXPECTEDLY });
          return freeze({ ok: true as const, value: snapshot(state) });
        }
        active = { token, handle };
        return freeze({ ok: true as const, value: snapshot(state) });
      } catch {
        if (exitedDuringLaunch) {
          transition({ streamId: state.streamId, phase: "failed", diagnostic: EXITED_UNEXPECTEDLY });
          return freeze({ ok: true as const, value: snapshot(state) });
        }
        state = { streamId: job.streamId, phase: "failed", revision: state.revision, diagnostic: LAUNCH_FAILED };
        return freeze({ ok: false as const, code: "LAUNCH_FAILED" as const, value: snapshot(state) });
      }
    },
    stop: () => {
      if (state.phase !== "running") return freeze({ ok: false as const, code: "NOT_RUNNING" as const, value: snapshot(state) });
      const run = active as ActiveRun;
      transition({ streamId: state.streamId, phase: "stopping", diagnostic: null });
      try {
        run.handle.terminate();
        return freeze({ ok: true as const, value: snapshot(state) });
      } catch {
        if (active === null) return freeze({ ok: true as const, value: snapshot(state) });
        transition({ streamId: state.streamId, phase: "running", diagnostic: STOP_FAILED });
        return freeze({ ok: false as const, code: "STOP_FAILED" as const, value: snapshot(state) });
      }
    }
  });
}

class TranscodeRunnerApi { readonly create = create; }
export const TranscodeRunner = freeze(new TranscodeRunnerApi());
