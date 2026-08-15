import { describe, expect, it } from "vitest";
import { DesktopShell } from "../src/production/desktop-shell/index.js";
import { DesktopUiGateway } from "../src/production/desktop-ui-gateway/index.js";

const ports = () => ({
  lifecycle: { acquire: () => true, release: () => undefined },
  window: { create: () => undefined, focus: () => undefined, close: () => undefined },
  renderer: { load: async () => undefined, clearCache: async () => undefined },
  paths: { userData: "C:/data", appRoot: "C:/app", rendererEntry: "file:///C:/app/index.html", packaged: true },
});

describe("桌面外壳 IPC", () => {
  it("只把白名单短名转给网关同名方法，并拒绝未知通道", async () => {
    const calls: string[] = [];
    const gateway = DesktopUiGateway.create({
      application: {
        snapshot: () => ({ phase: "running" }),
        subscribe: () => () => undefined,
        workflow: () => ({
          snapshot: () => ({}),
          start: async (deviceId: string) => { calls.push(deviceId); return { ok: true }; },
        }),
      },
    });
    const shell = DesktopShell.create({ applicationGateway: gateway, ...ports() }, { csp: "default-src 'self'" });
    await shell.start();

    await expect(shell.invoke("mission-start", { deviceId: "phone-1" })).resolves.toMatchObject({ ok: true, value: { ok: true, value: { ok: true } } });
    await expect(shell.invoke("state-snapshot", undefined)).resolves.toMatchObject({ ok: true, value: { ok: true, value: { phase: "running" } } });
    await expect(shell.invoke("gateway-invoke", { method: "mission.start", input: { deviceId: "phone-1" } })).resolves.toEqual({ ok: false, code: "METHOD_NOT_ALLOWED" });
    expect(calls).toEqual(["phone-1"]);
    expect(shell.snapshot().ipcMethods).toContain("mission-start");
    expect(shell.snapshot().ipcMethods).not.toContain("gateway-invoke");
    await shell.dispose();
  });

  it("网关释放后外壳调用稳定失败，且不把业务方法暴露成通用转发", async () => {
    const gateway = DesktopUiGateway.create({
      application: { snapshot: () => ({ phase: "idle" }), subscribe: () => () => undefined, workflow: () => ({}) },
    });
    const shell = DesktopShell.create({ applicationGateway: gateway, ...ports() }, { csp: "default-src 'self'" });
    gateway.dispose();
    await expect(shell.invoke("state-snapshot", undefined)).resolves.toMatchObject({ ok: true, value: { ok: false, code: "DISPOSED" } });
    await shell.dispose();
  });
});
