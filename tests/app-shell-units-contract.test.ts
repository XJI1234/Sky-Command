import { describe, expect, it } from "vitest";
import { IpcBridge } from "../src/modules/app-shell/ipc-bridge/index.js";
import { ProcessLifecycle } from "../src/modules/app-shell/process-lifecycle/index.js";
import { RendererHost } from "../src/modules/app-shell/renderer-host/index.js";
import { RuntimePaths } from "../src/modules/app-shell/runtime-paths/index.js";
import { WindowManager } from "../src/modules/app-shell/window-manager/index.js";

describe("应用外壳二级模块契约", () => {
  it("生命周期严格区分锁被占用、适配器失败、重复获取和幂等释放", () => {
    const unavailable = ProcessLifecycle.create({ acquire: () => false, release: () => undefined });
    expect(unavailable.acquire()).toEqual({ ok: false, code: "LOCK_UNAVAILABLE" });
    expect(unavailable.release()).toEqual({ ok: false, code: "NOT_ACQUIRED" });

    let releases = 0;
    const lifecycle = ProcessLifecycle.create({ acquire: () => true, release: () => { releases += 1; } });
    expect(lifecycle.acquire()).toEqual({ ok: true, value: undefined });
    expect(lifecycle.snapshot()).toEqual({ phase: "acquired" });
    expect(lifecycle.acquire()).toEqual({ ok: false, code: "ALREADY_ACQUIRED" });
    expect(lifecycle.release()).toEqual({ ok: true, value: undefined });
    expect(lifecycle.release()).toEqual({ ok: false, code: "RELEASED" });
    expect(releases).toBe(1);
    expect(lifecycle.acquire()).toEqual({ ok: false, code: "RELEASED" });

    const broken = ProcessLifecycle.create({ acquire: () => { throw new Error("secret"); }, release: () => undefined });
    expect(broken.acquire()).toEqual({ ok: false, code: "ADAPTER_FAILED" });
    const releaseFailure = ProcessLifecycle.create({ acquire: () => true, release: () => { throw new Error("secret"); } });
    releaseFailure.acquire();
    expect(releaseFailure.release()).toEqual({ ok: false, code: "ADAPTER_FAILED" });
  });

  it("窗口管理器只创建一次并在错误时保留原状态", () => {
    const events: string[] = [];
    const manager = WindowManager.create({ create: (csp) => events.push(`create:${csp}`), focus: () => events.push("focus"), close: () => events.push("close") }, { csp: "default-src 'self'" });
    expect(manager.focus()).toEqual({ ok: false, code: "NOT_CREATED" });
    expect(manager.close()).toEqual({ ok: false, code: "NOT_CREATED" });
    expect(manager.create()).toEqual({ ok: true, value: undefined });
    expect(manager.create()).toEqual({ ok: false, code: "ALREADY_CREATED" });
    expect(manager.focus()).toEqual({ ok: true, value: undefined });
    expect(manager.close()).toEqual({ ok: true, value: undefined });
    expect(manager.focus()).toEqual({ ok: false, code: "CLOSED" });
    expect(manager.create()).toEqual({ ok: false, code: "CLOSED" });
    expect(manager.close()).toEqual({ ok: false, code: "CLOSED" });
    expect(events).toEqual(["create:default-src 'self'", "focus", "close"]);

    const broken = WindowManager.create({ create: () => { throw new Error("secret"); }, focus: () => undefined, close: () => undefined }, { csp: "default-src 'self'" });
    expect(broken.create()).toEqual({ ok: false, code: "ADAPTER_FAILED" });
    expect(broken.snapshot()).toEqual({ phase: "new" });
    const noCsp = WindowManager.create({ create: () => undefined, focus: () => undefined, close: () => undefined }, { csp: " " });
    expect(noCsp.create()).toEqual({ ok: false, code: "INVALID_INPUT" });
    const nonStringCsp = WindowManager.create({ create: () => undefined, focus: () => undefined, close: () => undefined }, { csp: 7 } as never);
    expect(nonStringCsp.create()).toEqual({ ok: false, code: "INVALID_INPUT" });

    const focusFailure = WindowManager.create({ create: () => undefined, focus: () => { throw new Error("secret"); }, close: () => undefined }, { csp: "default-src 'self'" });
    focusFailure.create();
    expect(focusFailure.focus()).toEqual({ ok: false, code: "ADAPTER_FAILED" });
    const closeFailure = WindowManager.create({ create: () => undefined, focus: () => undefined, close: () => { throw new Error("secret"); } }, { csp: "default-src 'self'" });
    closeFailure.create();
    expect(closeFailure.close()).toEqual({ ok: false, code: "ADAPTER_FAILED" });
  });

  it("渲染主机限定重试次数并在清缓存失败时终止", async () => {
    const events: string[] = [];
    let attempts = 0;
    const host = RendererHost.create({
      load: async () => { attempts += 1; events.push(`load:${attempts}`); if (attempts < 3) throw new Error("secret"); },
      clearCache: async () => events.push("clear")
    }, { entry: "file:///app/index.html", retryCount: 2 });
    await expect(host.load()).resolves.toEqual({ ok: true, value: { attempts: 3 } });
    expect(host.snapshot()).toEqual({ phase: "loaded" });
    expect(events).toEqual(["load:1", "clear", "load:2", "clear", "load:3"]);
    await expect(host.load()).resolves.toEqual({ ok: false, code: "ALREADY_LOADED" });
    host.dispose();
    await expect(host.load()).resolves.toEqual({ ok: false, code: "DISPOSED" });

    const cacheFailure = RendererHost.create({ load: async () => { throw new Error("load"); }, clearCache: async () => { throw new Error("cache"); } }, { entry: "file:///app/index.html", retryCount: 1 });
    await expect(cacheFailure.load()).resolves.toEqual({ ok: false, code: "RENDERER_FAILED" });
    const invalid = RendererHost.create({ load: async () => undefined, clearCache: async () => undefined }, { entry: "", retryCount: 4 });
    await expect(invalid.load()).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    const whitespaceEntry = RendererHost.create({ load: async () => undefined, clearCache: async () => undefined }, { entry: " ", retryCount: 0 });
    await expect(whitespaceEntry.load()).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    const fractionalRetry = RendererHost.create({ load: async () => undefined, clearCache: async () => undefined }, { entry: "file:///app/index.html", retryCount: 1.5 });
    await expect(fractionalRetry.load()).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    const negativeRetry = RendererHost.create({ load: async () => undefined, clearCache: async () => undefined }, { entry: "file:///app/index.html", retryCount: -1 });
    await expect(negativeRetry.load()).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    const maximumRetry = RendererHost.create({ load: async () => undefined, clearCache: async () => undefined }, { entry: "file:///app/index.html", retryCount: 3 });
    await expect(maximumRetry.load()).resolves.toEqual({ ok: true, value: { attempts: 1 } });
  });

  it("渲染主机拒绝非字符串入口和超出上限的重试次数，并在清缓存失败后立即停止", async () => {
    const malformedEntry = RendererHost.create(
      { load: async () => undefined, clearCache: async () => undefined },
      { entry: 7, retryCount: 0 } as never
    );
    await expect(malformedEntry.load()).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });

    const excessiveRetry = RendererHost.create(
      { load: async () => undefined, clearCache: async () => undefined },
      { entry: "file:///app/index.html", retryCount: 4 }
    );
    await expect(excessiveRetry.load()).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });

    let loads = 0;
    let clears = 0;
    const cacheFailure = RendererHost.create({
      load: async () => { loads += 1; throw new Error("load"); },
      clearCache: async () => { clears += 1; throw new Error("cache"); }
    }, { entry: "file:///app/index.html", retryCount: 3 });
    await expect(cacheFailure.load()).resolves.toEqual({ ok: false, code: "RENDERER_FAILED" });
    expect({ loads, clears }).toEqual({ loads: 1, clears: 1 });
  });

  it("运行路径拒绝相对路径、非 URL 渲染入口和恶意 getter", () => {
    expect(RuntimePaths.resolve({ userData: "C:/data", appRoot: "C:/app", rendererEntry: "file:///app/index.html", packaged: true })).toEqual({ ok: true, value: { userData: "C:/data", appRoot: "C:/app", rendererEntry: "file:///app/index.html", packaged: true } });
    expect(RuntimePaths.resolve({ userData: "data", appRoot: "C:/app", rendererEntry: "file:///app/index.html", packaged: true })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(RuntimePaths.resolve({ userData: "C:/data", appRoot: "app", rendererEntry: "file:///app/index.html", packaged: true })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(RuntimePaths.resolve({ userData: "C:/data", appRoot: "C:/app", rendererEntry: "file:///app/index.html", packaged: "yes" })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(RuntimePaths.resolve({ userData: "C:/", appRoot: "C:/app", rendererEntry: "file:///app/index.html", packaged: true })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(RuntimePaths.resolve({ userData: "x/C:/data", appRoot: "C:/app", rendererEntry: "file:///app/index.html", packaged: true })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(RuntimePaths.resolve({ userData: "C:/data", appRoot: "C:/app", rendererEntry: "ftp://example", packaged: true })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(RuntimePaths.resolve({ userData: "C:/data", appRoot: "C:/app", rendererEntry: "index.html", packaged: true })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(RuntimePaths.resolve(new Proxy({}, { get() { throw new Error("secret"); } }))).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(RuntimePaths.resolve(null)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(RuntimePaths.resolve(7)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(RuntimePaths.resolve(null)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(RuntimePaths.resolve(7)).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("运行路径严格区分字段类型、前缀锚点和去除空白后的最短长度", () => {
    const valid = { userData: "C:/data", appRoot: "C:/app", rendererEntry: "file:///app/index.html", packaged: true };
    expect(RuntimePaths.resolve({ ...valid, userData: 7 })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(RuntimePaths.resolve({ ...valid, appRoot: false })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(RuntimePaths.resolve({ ...valid, rendererEntry: null })).toEqual({ ok: false, code: "INVALID_INPUT" });
    const callable = Object.assign(() => undefined, valid);
    expect(RuntimePaths.resolve(callable)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(RuntimePaths.resolve({ ...valid, userData: "C:/ " })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(RuntimePaths.resolve({ ...valid, rendererEntry: "file:///   " })).toEqual({ ok: false, code: "INVALID_INPUT" });
    const pathLikeObject = { toString: () => "C:/data", trim: () => "C:/data" };
    expect(RuntimePaths.resolve({ ...valid, userData: pathLikeObject })).toEqual({ ok: false, code: "INVALID_INPUT" });
    const rendererLikeObject = { toString: () => "file:///app/index.html", trim: () => "file:///app/index.html" };
    expect(RuntimePaths.resolve({ ...valid, rendererEntry: rendererLikeObject })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(RuntimePaths.resolve({ ...valid, rendererEntry: "file:///ab" })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(RuntimePaths.resolve({ ...valid, rendererEntry: "xfile:///app/index.html" })).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("IPC 桥接复制输入输出、隔离处理器异常并在释放后拒绝调用", async () => {
    const bridge = IpcBridge.create({
      "select-file": async (input) => ({ input }),
      broken: async () => { throw new Error("secret"); },
      "Invalid Name": async () => "never"
    });
    expect(bridge.names()).toEqual(["select-file", "broken"]);
    const input = { nested: { value: 1 } };
    await expect(bridge.invoke("select-file", input)).resolves.toEqual({ ok: true, value: { input } });
    input.nested.value = 2;
    await expect(bridge.invoke("select-file", { nested: { value: 3 } })).resolves.toEqual({ ok: true, value: { input: { nested: { value: 3 } } } });
    await expect(bridge.invoke("broken", null)).resolves.toEqual({ ok: false, code: "HANDLER_FAILED" });
    await expect(bridge.invoke("unknown", null)).resolves.toEqual({ ok: false, code: "METHOD_NOT_ALLOWED" });
    await expect(bridge.invoke(7, null)).resolves.toEqual({ ok: false, code: "METHOD_NOT_ALLOWED" });
    bridge.dispose();
    await expect(bridge.invoke("select-file", null)).resolves.toEqual({ ok: false, code: "DISPOSED" });
    const hostileRegistry = new Proxy({}, { ownKeys() { throw new Error("secret"); } }) as never;
    expect(IpcBridge.create(hostileRegistry).names()).toEqual([]);
    const unboundedName = "a".repeat(65);
    expect(IpcBridge.create({ [unboundedName]: async () => "never", "valid-name": async () => "ok" }).names()).toEqual(["valid-name"]);
    expect(IpcBridge.create({ "valid-name": "not-a-handler" } as never).names()).toEqual([]);
  });
});
