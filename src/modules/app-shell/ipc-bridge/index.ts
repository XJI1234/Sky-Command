export type IpcHandler = (input: unknown) => unknown | Promise<unknown>;
export type IpcHandlers = Readonly<Record<string, IpcHandler>>;
export type BridgeResult = Readonly<{ readonly ok: true; readonly value: unknown }> | Readonly<{ readonly ok: false; readonly code: "METHOD_NOT_ALLOWED" | "HANDLER_FAILED" | "DISPOSED" }>;
export interface IpcBridgeInstance {
  readonly invoke: (name: unknown, input: unknown) => Promise<BridgeResult>;
  readonly names: () => readonly string[];
  readonly dispose: () => void;
}

function freeze<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }
function failure(code: Extract<BridgeResult, { ok: false }>['code']): BridgeResult { return freeze({ ok: false as const, code }); }
function clone(value: unknown): unknown { return structuredClone(value); }
function validName(value: string): boolean { return /^[a-z][a-z0-9-]{0,63}$/.test(value); }

function create(methods: IpcHandlers): IpcBridgeInstance {
  const handlers = new Map<string, IpcHandler>();
  try {
    for (const [name, handler] of Object.entries(methods)) if (validName(name) && typeof handler === "function") handlers.set(name, handler);
  } catch { /* Invalid registries safely expose no methods. */ }
  const names = freeze([...handlers.keys()]);
  let disposed = false;
  return freeze({
    invoke: async (name, input) => {
      if (disposed) return failure("DISPOSED");
      const handler = handlers.get(name as string);
      if (!handler) return failure("METHOD_NOT_ALLOWED");
      try { return freeze({ ok: true as const, value: clone(await handler(clone(input))) }); } catch { return failure("HANDLER_FAILED"); }
    },
    names: () => freeze([...names]),
    dispose: () => { disposed = true; }
  });
}

class IpcBridgeApi {
  readonly create = create;
}

export const IpcBridge = freeze(new IpcBridgeApi());
