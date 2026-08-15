export type RendererPhase = "new" | "loaded" | "disposed";
export type RendererResult = Readonly<{ readonly ok: true; readonly value: Readonly<{ readonly attempts: number }> }> | Readonly<{ readonly ok: false; readonly code: "ALREADY_LOADED" | "DISPOSED" | "INVALID_INPUT" | "RENDERER_FAILED" }>;
export interface RendererPort {
  readonly load: (entry: string) => Promise<void>;
  readonly clearCache: () => Promise<void>;
}
export interface RendererSnapshot { readonly phase: RendererPhase; }
export interface RendererHostOptions { readonly entry: string; readonly retryCount?: number | undefined; }
export interface RendererHostInstance {
  readonly load: () => Promise<RendererResult>;
  readonly snapshot: () => RendererSnapshot;
  readonly dispose: () => void;
}

function freeze<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }
function failure(code: Extract<RendererResult, { ok: false }>['code']): RendererResult { return freeze({ ok: false as const, code }); }

function create(port: RendererPort, options: RendererHostOptions): RendererHostInstance {
  const retryCount = options.retryCount ?? 0;
  const valid = typeof options.entry === "string" && options.entry.trim().length > 0 && Number.isInteger(retryCount) && retryCount >= 0 && retryCount <= 3;
  let phase: RendererPhase = "new";
  return freeze({
    load: async () => {
      if (phase === "disposed") return failure("DISPOSED");
      if (phase === "loaded") return failure("ALREADY_LOADED");
      if (!valid) return failure("INVALID_INPUT");
      let attempt = 1;
      while (true) {
        try {
          await port.load(options.entry);
          phase = "loaded";
          return freeze({ ok: true as const, value: freeze({ attempts: attempt }) });
        } catch {
          if (attempt > retryCount) return failure("RENDERER_FAILED");
          try { await port.clearCache(); } catch { return failure("RENDERER_FAILED"); }
          attempt += 1;
        }
      }
    },
    snapshot: () => freeze({ phase }),
    dispose: () => { phase = "disposed"; }
  });
}

class RendererHostApi {
  readonly create = create;
}

export const RendererHost = freeze(new RendererHostApi());
