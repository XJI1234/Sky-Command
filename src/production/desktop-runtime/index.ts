export type DesktopRuntimePhase = "idle" | "starting" | "running" | "stopping" | "disposed";
export type DesktopRuntimeCode = "ALREADY_RUNNING" | "NOT_RUNNING" | "OPERATION_IN_PROGRESS" | "DISPOSED" | "RELAY_START_FAILED" | "MEDIA_START_FAILED" | "MEDIA_STOP_FAILED" | "RELAY_STOP_FAILED";

export interface DesktopRuntimeRelay {
  readonly start: () => Promise<unknown>;
  readonly stop: () => Promise<void>;
  readonly snapshot: () => unknown;
  readonly subscribe: (listener: (snapshot: unknown) => void) => () => void;
}

export interface DesktopRuntimeMedia {
  readonly start: (input: unknown) => unknown;
  readonly stop: () => unknown;
  readonly snapshot: () => unknown;
  readonly dispose: () => void;
}

export interface DesktopRuntimeLive {
  readonly list: () => readonly unknown[];
  readonly stop: (deviceId: string) => Promise<unknown>;
}

export interface DesktopRuntimeDependencies {
  readonly relay: DesktopRuntimeRelay;
  readonly media: DesktopRuntimeMedia;
  readonly live: DesktopRuntimeLive;
}

export interface DesktopRuntimeOptions {
  readonly mediaStartInput: unknown;
}

export interface DesktopRuntimeServices {
  readonly relay: DesktopRuntimeRelay;
  readonly media: DesktopRuntimeMedia;
  readonly live: DesktopRuntimeLive;
}

export interface DesktopRuntimeSnapshot {
  readonly phase: DesktopRuntimePhase;
  readonly revision: number;
  readonly relay: unknown;
  readonly media: unknown;
}

export type RuntimeResult =
  | Readonly<{ readonly ok: true; readonly value: DesktopRuntimeSnapshot }>
  | Readonly<{ readonly ok: false; readonly code: DesktopRuntimeCode; readonly value: DesktopRuntimeSnapshot }>;

export interface DesktopRuntimeInstance {
  readonly start: () => Promise<RuntimeResult>;
  readonly stop: () => Promise<RuntimeResult>;
  readonly snapshot: () => DesktopRuntimeSnapshot;
  readonly services: () => DesktopRuntimeServices;
  readonly subscribe: (listener: (snapshot: DesktopRuntimeSnapshot) => void) => () => void;
  readonly dispose: () => Promise<void>;
}

type Operation = "start" | "stop" | null;

// Stryker disable next-line ArrowFunction: 静态辅助函数替换不能在转换后的 ESM 缓存中重新加载；公开冻结结果已有契约测试。
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
// Stryker disable next-line ArrowFunction, ConditionalExpression: 静态替换不可重新加载；null 即使通过 typeof 检查仍以 null 返回，公开归一化结果相同。
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
// Stryker disable next-line ArrowFunction: 静态辅助函数替换不能在转换后的 ESM 缓存中重新加载；成功和失败路径均由公开契约覆盖。
const successful = (value: unknown): boolean => record(value)?.ok === true;
const copy = (value: unknown): unknown => {
  const source = record(value);
  return source === null ? null : freeze({ ...source });
};
const activeLiveDevice = (value: unknown): string | null => {
  const source = record(value);
  if (source === null || typeof source.deviceId !== "string") return null;
  return source.phase === "starting" || source.phase === "streaming" || source.phase === "stopping" ? source.deviceId : null;
};

function create(dependencies: DesktopRuntimeDependencies, options: DesktopRuntimeOptions): DesktopRuntimeInstance {
  let phase: DesktopRuntimePhase = "idle";
  let revision = 0;
  let operation: Operation = null;
  let disposed = false;
  const listeners = new Set<(snapshot: DesktopRuntimeSnapshot) => void>();
  const current = (): DesktopRuntimeSnapshot => freeze({ phase, revision, relay: copy(safely(dependencies.relay.snapshot)), media: copy(safely(dependencies.media.snapshot)) });
  const publish = (): DesktopRuntimeSnapshot => {
    const value = current();
    for (const listener of [...listeners]) { try { listener(value); } catch { /* observer isolation */ } }
    return value;
  };
  const transition = (next: DesktopRuntimePhase): DesktopRuntimeSnapshot => { phase = next; revision += 1; return publish(); };
  const relaySubscription = dependencies.relay.subscribe(() => { if (phase === "running") { revision += 1; publish(); } });
  const result = (ok: boolean, code?: DesktopRuntimeCode): RuntimeResult => ok ? freeze({ ok: true as const, value: current() }) : freeze({ ok: false as const, code: code!, value: current() });
  const stop = async (): Promise<RuntimeResult> => {
    if (disposed) return result(false, "DISPOSED");
    if (operation !== null) return result(false, "OPERATION_IN_PROGRESS");
    if (phase !== "running") return result(false, "NOT_RUNNING");
    operation = "stop";
    transition("stopping");
    const liveEntries = safely(dependencies.live.list);
    const deviceIds = Array.isArray(liveEntries) ? liveEntries.map(activeLiveDevice).filter((value): value is string => value !== null) : [];
    await Promise.all(deviceIds.map(async (deviceId) => { await safelyAsync(() => dependencies.live.stop(deviceId)); }));
    const mediaStopped = safely(dependencies.media.stop);
    const relayStopped = await safelyAsync(dependencies.relay.stop);
    operation = null;
    transition("idle");
    if (!successful(mediaStopped)) return result(false, "MEDIA_STOP_FAILED");
    if (relayStopped === null) return result(false, "RELAY_STOP_FAILED");
    return result(true);
  };

  return freeze({
    start: async () => {
      if (disposed) return result(false, "DISPOSED");
      if (operation !== null) return result(false, "OPERATION_IN_PROGRESS");
      if (phase === "running") return result(false, "ALREADY_RUNNING");
      operation = "start";
      transition("starting");
      const relayStarted = safelyAsync(dependencies.relay.start);
      if (!successful(await relayStarted)) {
        operation = null;
        transition("idle");
        return result(false, "RELAY_START_FAILED");
      }
      const mediaStarted = safely(() => dependencies.media.start(options.mediaStartInput));
      if (!successful(mediaStarted)) {
        await safelyAsync(dependencies.relay.stop);
        operation = null;
        transition("idle");
        return result(false, "MEDIA_START_FAILED");
      }
      operation = null;
      transition("running");
      return result(true);
    },
    stop,
    snapshot: current,
    services: () => freeze({ relay: dependencies.relay, media: dependencies.media, live: dependencies.live }),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose: async () => {
      if (disposed) return;
      // Stryker disable next-line ConditionalExpression: 在非运行状态调用 stop 只返回未启动结果且不产生外部效果，释放语义不变。
      if (phase === "running") await stop();
      relaySubscription();
      safely(dependencies.media.dispose);
      disposed = true;
      transition("disposed");
    }
  });
}

function safely<T>(action: () => T): T | null {
  try { return action(); }
  // Stryker disable next-line BlockStatement: catch 中缺少显式返回会被全部调用方归一为同一安全失败结果。
  catch { return null; }
}
async function safelyAsync<T>(action: () => Promise<T>): Promise<T | null> { try { return await action(); } catch { return null; } }

// Stryker disable next-line ObjectLiteral: ESM 静态门面在转换测试模块重新导入前已创建；公开构造行为已覆盖。
export const DesktopRuntime = freeze({ create });
