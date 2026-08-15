export type WindowPhase = "new" | "created" | "closed";
export type WindowResult = Readonly<{ readonly ok: true; readonly value: undefined }> | Readonly<{ readonly ok: false; readonly code: "ALREADY_CREATED" | "NOT_CREATED" | "CLOSED" | "ADAPTER_FAILED" | "INVALID_INPUT" }>;
export interface WindowPort {
  readonly create: (csp: string) => void;
  readonly focus: () => void;
  readonly close: () => void;
}
export interface WindowSnapshot { readonly phase: WindowPhase; }
export interface WindowManagerInstance {
  readonly create: () => WindowResult;
  readonly focus: () => WindowResult;
  readonly close: () => WindowResult;
  readonly snapshot: () => WindowSnapshot;
}
export interface WindowManagerOptions { readonly csp: string; }

function freeze<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }
function success(): WindowResult { return freeze({ ok: true as const, value: undefined }); }
function failure(code: Extract<WindowResult, { ok: false }>['code']): WindowResult { return freeze({ ok: false as const, code }); }

function create(port: WindowPort, options: WindowManagerOptions): WindowManagerInstance {
  const validCsp = typeof options.csp === "string" && options.csp.trim().length > 0;
  let phase: WindowPhase = "new";
  const blocked = (): WindowResult | null => phase === "closed" ? failure("CLOSED") : null;
  return freeze({
    create: () => {
      const state = blocked();
      if (state) return state;
      if (!validCsp) return failure("INVALID_INPUT");
      if (phase === "created") return failure("ALREADY_CREATED");
      try { port.create(options.csp); phase = "created"; return success(); } catch { return failure("ADAPTER_FAILED"); }
    },
    focus: () => {
      const state = blocked();
      if (state) return state;
      if (phase !== "created") return failure("NOT_CREATED");
      try { port.focus(); return success(); } catch { return failure("ADAPTER_FAILED"); }
    },
    close: () => {
      const state = blocked();
      if (state) return state;
      if (phase !== "created") return failure("NOT_CREATED");
      try { port.close(); phase = "closed"; return success(); } catch { return failure("ADAPTER_FAILED"); }
    },
    snapshot: () => freeze({ phase })
  });
}

class WindowManagerApi {
  readonly create = create;
}

export const WindowManager = freeze(new WindowManagerApi());
