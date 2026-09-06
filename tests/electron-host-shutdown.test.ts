import { describe, expect, it } from "vitest";
import { shutdownDesktopHost } from "../src/production/electron-host/shutdown-sequence.js";

describe("Electron 宿主关闭序列", () => {
  it("先释放外壳和应用，再刷出日志，最后退出", async () => {
    const calls: string[] = [];

    await shutdownDesktopHost({
      disposeShell: async () => { calls.push("shell"); },
      disposeApplication: async () => { calls.push("application"); },
      flushJournal: async () => { calls.push("journal"); },
      quit: () => { calls.push("quit"); },
    });

    expect(calls).toEqual(["shell", "application", "journal", "quit"]);
  });

  it("外壳释放失败时仍释放应用、刷出日志并退出", async () => {
    const calls: string[] = [];

    await expect(shutdownDesktopHost({
      disposeShell: async () => { calls.push("shell"); throw new Error("shell failure"); },
      disposeApplication: async () => { calls.push("application"); },
      flushJournal: async () => { calls.push("journal"); },
      quit: () => { calls.push("quit"); },
    })).rejects.toThrow("shell failure");

    expect(calls).toEqual(["shell", "application", "journal", "quit"]);
  });

  it("关闭阶段永久不返回时仍继续后续清理并退出", async () => {
    const calls: string[] = [];

    await expect(shutdownDesktopHost({
      disposeShell: () => new Promise<void>(() => { calls.push("shell"); }),
      disposeApplication: async () => { calls.push("application"); },
      flushJournal: async () => { calls.push("journal"); },
      quit: () => { calls.push("quit"); },
      stageTimeoutMs: 10,
    })).rejects.toThrow("Shutdown stage timed out");

    expect(calls).toEqual(["shell", "application", "journal", "quit"]);
  });
});
