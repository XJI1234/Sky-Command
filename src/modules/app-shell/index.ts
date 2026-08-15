import { IpcBridge, type BridgeResult, type IpcHandlers } from "./ipc-bridge/index.js";
import { ProcessLifecycle, type LifecyclePort } from "./process-lifecycle/index.js";
import { RendererHost, type RendererPort } from "./renderer-host/index.js";
import { RuntimePaths, type RuntimePathsInput, type RuntimePathsSnapshot } from "./runtime-paths/index.js";
import { WindowManager, type WindowPort } from "./window-manager/index.js";

export type ShellPhase = "new" | "ready" | "disposed";
export type ShellResult = Readonly<{ readonly ok: true; readonly value: undefined }> | Readonly<{ readonly ok: false; readonly code: "ALREADY_RUNNING" | "ALREADY_STARTED" | "NOT_STARTED" | "RENDERER_FAILED" | "WINDOW_FAILED" | "LIFECYCLE_FAILED" | "DISPOSED" | "INVALID_INPUT" }>;
export interface AppShellDependencies {
  readonly lifecycle: LifecyclePort;
  readonly window: WindowPort;
  readonly renderer: RendererPort;
  readonly paths: RuntimePathsInput;
  readonly ipc: IpcHandlers;
}
export interface AppShellOptions { readonly csp: string; readonly retryCount?: number; }
export interface ShellSnapshot { readonly phase: ShellPhase; readonly paths: RuntimePathsSnapshot | null; readonly ipcMethods: readonly string[]; }
export interface AppShellInstance {
  readonly start: () => Promise<ShellResult>;
  readonly focusExisting: () => ShellResult;
  readonly invoke: (name: unknown, input: unknown) => Promise<BridgeResult>;
  readonly snapshot: () => ShellSnapshot;
  readonly dispose: () => Promise<void>;
}

function freeze<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }
function success(): ShellResult { return freeze({ ok: true as const, value: undefined }); }
function failure(code: Extract<ShellResult, { ok: false }>['code']): ShellResult { return freeze({ ok: false as const, code }); }

function create(dependencies: AppShellDependencies, options: AppShellOptions): AppShellInstance {
  const paths = RuntimePaths.resolve(dependencies.paths);
  const lifecycle = ProcessLifecycle.create(dependencies.lifecycle);
  const window = WindowManager.create(dependencies.window, { csp: options.csp });
  const renderer = RendererHost.create(dependencies.renderer, { entry: paths.ok ? paths.value.rendererEntry : "", retryCount: options.retryCount });
  const bridge = IpcBridge.create(dependencies.ipc);
  let phase: ShellPhase = "new";
  const rollback = async (): Promise<void> => {
    window.close();
    lifecycle.release();
  };
  return freeze({
    start: async () => {
      if (phase === "disposed") return failure("DISPOSED");
      if (phase === "ready") return failure("ALREADY_STARTED");
      if (!paths.ok) return failure("INVALID_INPUT");
      const acquired = lifecycle.acquire();
      if (!acquired.ok) return acquired.code === "LOCK_UNAVAILABLE" ? failure("ALREADY_RUNNING") : failure("LIFECYCLE_FAILED");
      const created = window.create();
      if (!created.ok) { lifecycle.release(); return failure("WINDOW_FAILED"); }
      const loaded = await renderer.load();
      if (!loaded.ok) { await rollback(); return failure("RENDERER_FAILED"); }
      phase = "ready";
      return success();
    },
    focusExisting: () => {
      if (phase === "disposed") return failure("DISPOSED");
      if (phase !== "ready") return failure("NOT_STARTED");
      const result = window.focus();
      return result.ok ? success() : failure("WINDOW_FAILED");
    },
    invoke: (name, input) => bridge.invoke(name, input),
    snapshot: () => freeze({ phase, paths: paths.ok ? freeze({ ...paths.value }) : null, ipcMethods: bridge.names() }),
    dispose: async () => {
      bridge.dispose();
      renderer.dispose();
      window.close();
      lifecycle.release();
      phase = "disposed";
    }
  });
}

class AppShellApi {
  readonly create = create;
}

export const AppShell = freeze(new AppShellApi());
export type { BridgeResult } from "./ipc-bridge/index.js";
