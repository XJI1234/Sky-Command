import { describe, expect, it } from "vitest";
import { DesktopRuntime } from "../src/production/desktop-runtime/index.js";

describe("desktop-runtime 性能契约", () => {
  it("可同步创建一万个独立运行时而不启动系统服务", () => {
    let created = 0;
    for (let index = 0; index < 10_000; index += 1) {
      const runtime = DesktopRuntime.create({
        relay: { start: async () => ({ ok: true }), stop: async () => undefined, snapshot: () => ({}), subscribe: () => () => undefined },
        media: { start: () => ({ ok: true }), stop: () => ({ ok: true }), snapshot: () => ({}), dispose: () => undefined },
        live: { list: () => [], stop: async () => ({ ok: true }) }
      }, { mediaStartInput: { index } });
      if (runtime.snapshot().phase === "idle") created += 1;
    }
    expect(created).toBe(10_000);
  });
});
