import { describe, expect, it } from "vitest";
import { DesktopTestHost } from "../src/modules/cross-runtime-e2e/desktop-test-host/index.js";
import { mobileProjectRoot } from "./helpers/mobile-project-root.js";

describe("跨运行时资源恢复", () => {
  it("成功关闭会回收子进程定时器和 WebSocket，且同一套件可连续运行两次", async () => {
    for (const run of [1, 2]) {
      const host = await DesktopTestHost.start({
        mobileProjectRoot,
        deviceId: `e2e-resource-${run}`,
      });
      await host.waitForDevice(30_000);
      await host.close();
      expect(host.snapshot()).toMatchObject({ closed: true, childExited: true });
    }
  }, 60_000);
});
