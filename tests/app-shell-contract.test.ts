import { describe, expect, it } from "vitest";
import { AppShell } from "../src/modules/app-shell/index.js";

describe("应用外壳一级模块契约", () => {
  it("按生命周期、窗口、渲染的顺序启动，并返回 ready 快照", async () => {
    const events: string[] = [];
    const shell = AppShell.create({
      lifecycle: { acquire: () => { events.push("acquire"); return true; }, release: () => { events.push("release"); } },
      window: { create: (csp: string) => { events.push(`window:${csp}`); }, focus: () => { events.push("focus"); }, close: () => { events.push("close"); } },
      renderer: { load: async (entry: string) => { events.push(`load:${entry}`); }, clearCache: async () => { events.push("clear"); } },
      paths: { userData: "C:/data", appRoot: "C:/app", rendererEntry: "http://localhost:5173", packaged: false },
      ipc: { "select-file": async () => ({ fileName: "route.kmz" }) }
    }, { csp: "default-src 'self'" });

    await expect(shell.start()).resolves.toEqual({ ok: true, value: undefined });
    expect(events).toEqual(["acquire", "window:default-src 'self'", "load:http://localhost:5173"]);
    expect(shell.snapshot()).toMatchObject({ phase: "ready", paths: { appRoot: "C:/app" }, ipcMethods: ["select-file"] });
    expect(Object.isFrozen(AppShell)).toBe(true);
  });

  it("第二次启动只聚焦既有窗口，不重复创建或装载", async () => {
    const events: string[] = [];
    const shell = AppShell.create({
      lifecycle: { acquire: () => true, release: () => undefined },
      window: { create: () => events.push("create"), focus: () => events.push("focus"), close: () => undefined },
      renderer: { load: async () => events.push("load"), clearCache: async () => undefined },
      paths: { userData: "C:/data", appRoot: "C:/app", rendererEntry: "file:///app/index.html", packaged: true },
      ipc: {}
    }, { csp: "default-src 'self'" });
    await shell.start();
    expect(shell.focusExisting()).toEqual({ ok: true, value: undefined });
    expect(events).toEqual(["create", "load", "focus"]);
  });

  it("锁失败时不创建窗口，释放后调用稳定返回 disposed", async () => {
    const events: string[] = [];
    const shell = AppShell.create({
      lifecycle: { acquire: () => false, release: () => events.push("release") },
      window: { create: () => events.push("create"), focus: () => undefined, close: () => events.push("close") },
      renderer: { load: async () => events.push("load"), clearCache: async () => undefined },
      paths: { userData: "C:/data", appRoot: "C:/app", rendererEntry: "file:///app/index.html", packaged: true },
      ipc: {}
    }, { csp: "default-src 'self'" });
    await expect(shell.start()).resolves.toEqual({ ok: false, code: "ALREADY_RUNNING" });
    expect(events).toEqual([]);
    await shell.dispose();
    await shell.dispose();
    expect(shell.snapshot().phase).toBe("disposed");
    expect(shell.focusExisting()).toEqual({ ok: false, code: "DISPOSED" });
    await expect(shell.invoke("unknown", null)).resolves.toEqual({ ok: false, code: "DISPOSED" });
  });

  it("渲染失败时清缓存后只重试一次并回滚窗口和锁", async () => {
    const events: string[] = [];
    let attempts = 0;
    const shell = AppShell.create({
      lifecycle: { acquire: () => { events.push("acquire"); return true; }, release: () => events.push("release") },
      window: { create: () => events.push("create"), focus: () => undefined, close: () => events.push("close") },
      renderer: { load: async () => { attempts += 1; events.push(`load:${attempts}`); throw new Error("secret"); }, clearCache: async () => events.push("clear") },
      paths: { userData: "C:/data", appRoot: "C:/app", rendererEntry: "file:///app/index.html", packaged: true },
      ipc: {}
    }, { csp: "default-src 'self'", retryCount: 1 });
    await expect(shell.start()).resolves.toEqual({ ok: false, code: "RENDERER_FAILED" });
    expect(events).toEqual(["acquire", "create", "load:1", "clear", "load:2", "close", "release"]);
    expect(shell.snapshot().phase).toBe("new");
  });

  it("冻结快照并拒绝任意 IPC 通道", async () => {
    const shell = AppShell.create({
      lifecycle: { acquire: () => true, release: () => undefined },
      window: { create: () => undefined, focus: () => undefined, close: () => undefined },
      renderer: { load: async () => undefined, clearCache: async () => undefined },
      paths: { userData: "C:/data", appRoot: "C:/app", rendererEntry: "file:///app/index.html", packaged: true },
      ipc: { "select-file": async (input: unknown) => ({ input }) }
    }, { csp: "default-src 'self'" });
    await shell.start();
    const snapshot = shell.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.paths)).toBe(true);
    await expect(shell.invoke("select-file", "ok")).resolves.toEqual({ ok: true, value: { input: "ok" } });
    await expect(shell.invoke("invoke", {})).resolves.toEqual({ ok: false, code: "METHOD_NOT_ALLOWED" });
  });

  it("覆盖外壳的未启动、输入、窗口、生命周期和聚焦失败路径", async () => {
    const invalid = AppShell.create({
      lifecycle: { acquire: () => true, release: () => undefined },
      window: { create: () => undefined, focus: () => undefined, close: () => undefined },
      renderer: { load: async () => undefined, clearCache: async () => undefined },
      paths: { userData: "relative", appRoot: "C:/app", rendererEntry: "file:///app/index.html", packaged: true },
      ipc: {}
    }, { csp: "default-src 'self'" });
    expect(invalid.focusExisting()).toEqual({ ok: false, code: "NOT_STARTED" });
    expect(invalid.snapshot().paths).toBeNull();
    await expect(invalid.start()).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    await invalid.dispose();
    expect(invalid.snapshot().phase).toBe("disposed");
    await expect(invalid.start()).resolves.toEqual({ ok: false, code: "DISPOSED" });

    const invalidWithRetry = AppShell.create({
      lifecycle: { acquire: () => true, release: () => undefined },
      window: { create: () => undefined, focus: () => undefined, close: () => undefined },
      renderer: { load: async () => undefined, clearCache: async () => undefined },
      paths: { userData: "relative", appRoot: "C:/app", rendererEntry: "file:///app/index.html", packaged: true },
      ipc: {}
    }, { csp: "default-src 'self'", retryCount: 1 });
    await expect(invalidWithRetry.start()).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });

    const lifecycleFailure = AppShell.create({
      lifecycle: { acquire: () => { throw new Error("secret"); }, release: () => undefined },
      window: { create: () => undefined, focus: () => undefined, close: () => undefined },
      renderer: { load: async () => undefined, clearCache: async () => undefined },
      paths: { userData: "C:/data", appRoot: "C:/app", rendererEntry: "file:///app/index.html", packaged: true },
      ipc: {}
    }, { csp: "default-src 'self'" });
    await expect(lifecycleFailure.start()).resolves.toEqual({ ok: false, code: "LIFECYCLE_FAILED" });

    const windowFailure = AppShell.create({
      lifecycle: { acquire: () => true, release: () => undefined },
      window: { create: () => { throw new Error("secret"); }, focus: () => undefined, close: () => undefined },
      renderer: { load: async () => undefined, clearCache: async () => undefined },
      paths: { userData: "C:/data", appRoot: "C:/app", rendererEntry: "file:///app/index.html", packaged: true },
      ipc: {}
    }, { csp: "default-src 'self'" });
    await expect(windowFailure.start()).resolves.toEqual({ ok: false, code: "WINDOW_FAILED" });

    const events: string[] = [];
    const focusFailure = AppShell.create({
      lifecycle: { acquire: () => true, release: () => undefined },
      window: { create: () => events.push("create"), focus: () => { throw new Error("secret"); }, close: () => events.push("close") },
      renderer: { load: async () => undefined, clearCache: async () => undefined },
      paths: { userData: "C:/data", appRoot: "C:/app", rendererEntry: "file:///app/index.html", packaged: true },
      ipc: {}
    }, { csp: "default-src 'self'" });
    await focusFailure.start();
    await expect(focusFailure.start()).resolves.toEqual({ ok: false, code: "ALREADY_STARTED" });
    expect(focusFailure.focusExisting()).toEqual({ ok: false, code: "WINDOW_FAILED" });
    await focusFailure.dispose();
    expect(events).toEqual(["create", "close"]);
    await expect(focusFailure.invoke("anything", null)).resolves.toEqual({ ok: false, code: "DISPOSED" });
  });
});
