export type LifecyclePhase = "new" | "acquired" | "released";
export type LifecycleResult = Readonly<{ readonly ok: true; readonly value: undefined }> | Readonly<{ readonly ok: false; readonly code: "ALREADY_ACQUIRED" | "NOT_ACQUIRED" | "RELEASED" | "LOCK_UNAVAILABLE" | "ADAPTER_FAILED" }>;
export interface LifecyclePort {
  readonly acquire: () => boolean;
  readonly release: () => void;
}
export interface LifecycleSnapshot { readonly phase: LifecyclePhase; }
export interface ProcessLifecycleInstance {
  readonly acquire: () => LifecycleResult;
  readonly release: () => LifecycleResult;
  readonly snapshot: () => LifecycleSnapshot;
}

function freeze<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }
function success(): LifecycleResult { return freeze({ ok: true as const, value: undefined }); }
function failure(code: Extract<LifecycleResult, { ok: false }>['code']): LifecycleResult { return freeze({ ok: false as const, code }); }

function create(port: LifecyclePort): ProcessLifecycleInstance {
  let phase: LifecyclePhase = "new";
  return freeze({
    acquire: () => {
      if (phase === "released") return failure("RELEASED");
      if (phase === "acquired") return failure("ALREADY_ACQUIRED");
      try {
        if (!port.acquire()) return failure("LOCK_UNAVAILABLE");
        phase = "acquired";
        return success();
      } catch { return failure("ADAPTER_FAILED"); }
    },
    release: () => {
      if (phase === "released") return failure("RELEASED");
      if (phase === "new") return failure("NOT_ACQUIRED");
      try {
        port.release();
        phase = "released";
        return success();
      } catch { return failure("ADAPTER_FAILED"); }
    },
    snapshot: () => freeze({ phase })
  });
}

class ProcessLifecycleApi {
  readonly create = create;
}

export const ProcessLifecycle = freeze(new ProcessLifecycleApi());
