import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import WebSocket from "ws";
import { AppShell } from "../src/modules/app-shell/index.js";
import { DesktopTestHost } from "../src/modules/cross-runtime-e2e/desktop-test-host/index.js";
import { DesktopSettings } from "../src/modules/desktop-settings/index.js";
import { makeKmz } from "./helpers/zip-fixture.js";
import { mobileProjectRoot } from "./helpers/mobile-project-root.js";

const text = (value: string) => ({ kind: "string" as const, value });
const bool = (value: boolean) => ({ kind: "boolean" as const, value });

const settleDji = async <T>(host: Awaited<ReturnType<typeof DesktopTestHost.start>>, operation: Promise<T>, deviceId?: string): Promise<T> => {
  const timer = setInterval(() => host.sendControl("ADVANCE 0", deviceId), 25);
  try { return await operation; } finally { clearInterval(timer); }
};

const waitUntil = async (predicate: () => boolean, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const stageRawMission = async (host: Awaited<ReturnType<typeof DesktopTestHost.start>>, deviceId: string): Promise<void> => {
  const bytes = new TextEncoder().encode(`mission-${deviceId}`);
  const staged = await host.relay.sendMission(deviceId, {
    missionId: `mission-${deviceId}`,
    fileName: `${deviceId}.kmz`,
    bytes,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  expect(staged.status).toBe("succeeded");
};

describe("跨运行时桌面测试宿主", () => {
  it("桌面设置和无 Electron 外壳通过正式公开接口完成生命周期", async () => {
    let stored: Uint8Array | null = null;
    const settings = DesktopSettings.create({
      read: async () => stored?.slice() ?? null,
      writeAtomically: async (bytes) => { stored = bytes.slice(); },
    });
    expect(await settings.load()).toMatchObject({ status: "recovered", reason: "missing" });
    expect(settings.updateNetwork({ listenPort: 19_350, manualHost: "192.168.50.10" })).toMatchObject({ ok: true });
    expect(settings.updateMap({ basemap: "tianditu-vector", credential: "e2e-credential" })).toMatchObject({ ok: true });
    expect(await settings.save()).toMatchObject({ ok: true });
    expect(stored).not.toBeNull();

    const events: string[] = [];
    const shell = AppShell.create({
      lifecycle: { acquire: () => { events.push("acquire"); return true; }, release: () => { events.push("release"); } },
      window: { create: () => { events.push("window"); }, focus: () => { events.push("focus"); }, close: () => { events.push("close"); } },
      renderer: { load: async () => { events.push("renderer"); }, clearCache: async () => undefined },
      paths: { userData: "D:/controlled-user-data", appRoot: "D:/controlled-app", rendererEntry: "file:///D:/controlled-app/index.html", packaged: true },
      ipc: { "verification-snapshot": async (input) => ({ input }) },
    }, { csp: "default-src 'self'" });
    expect(await shell.start()).toMatchObject({ ok: true });
    expect(shell.focusExisting()).toMatchObject({ ok: true });
    expect(await shell.invoke("verification-snapshot", { safe: true })).toMatchObject({ ok: true, value: { input: { safe: true } } });
    expect(await shell.invoke("unknown", null)).toMatchObject({ ok: false, code: "METHOD_NOT_ALLOWED" });
    await shell.dispose();
    expect(shell.snapshot().phase).toBe("disposed");
    expect(events).toEqual(["acquire", "window", "renderer", "focus", "close", "release"]);
  });

  it("运行时生成的合格 KMZ 经正式航线库和任务控制上传到手机", async () => {
    const host = await DesktopTestHost.start({
      mobileProjectRoot,
      deviceId: "e2e-route-library",
    });
    try {
      const device = await host.waitForDevice(30_000);
      const wpml = `<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wp="http://www.dji.com/wpmz/1.0.6"><Document><Folder>
        <Placemark><Point><coordinates>120.1,30.1</coordinates></Point><wp:index>0</wp:index><wp:executeHeight>40</wp:executeHeight></Placemark>
        <Placemark><Point><coordinates>120.2,30.2</coordinates></Point><wp:index>1</wp:index><wp:executeHeight>40</wp:executeHeight></Placemark>
      </Folder></Document></kml>`;
      const template = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>`;
      const bytes = await makeKmz({ "wpmz/template.kml": template, "wpmz/waylines.wpml": wpml });

      const imported = await host.workflow.importRoute({ fileName: "e2e-generated.kmz", bytes });
      expect(imported.ok).toBe(true);
      if (!imported.ok) throw new Error("route import failed");
      const routeImport = imported.value as { readonly status: string; readonly route: { readonly routeId: string; readonly classification: string } };
      expect(routeImport.status).toBe("imported");
      expect(routeImport.route.classification).toBe("upload-candidate");
      const preview = host.routeLibrary.getPreview(routeImport.route.routeId);
      expect(preview.ok).toBe(true);
      if (!preview.ok) throw new Error("route preview failed");
      expect(host.geoMap.initialize({ identity: "e2e-map-target" })).toMatchObject({ ok: true });
      expect(host.geoMap.focus(preview.value.cameraBounds)).toMatchObject({ ok: true });
      expect(host.snapshot().mapFocuses).toEqual([preview.value.cameraBounds]);

      expect(host.workflow.assignRoute(device.deviceId, routeImport.route.routeId).ok).toBe(true);
      expect((await host.workflow.stage(device.deviceId)).ok).toBe(true);
      expect((await settleDji(host, host.workflow.upload(device.deviceId))).ok).toBe(true);
      expect(host.missionControl.get(device.deviceId)).toMatchObject({
        routeId: routeImport.route.routeId,
        phase: "uploaded",
      });
      expect((await host.relay.sendCommand(device.deviceId, { name: "telemetry.read", fields: {} })).status).toBe("succeeded");
      await waitUntil(() => host.operations.telemetry(device.deviceId) !== null);
      const startedMission = await settleDji(host, host.workflow.start(device.deviceId));
      if (!startedMission.ok) throw new Error(JSON.stringify(startedMission));
      expect(startedMission).toMatchObject({
        ok: true,
        value: { state: { phase: "starting" } },
      });
      host.sendControl("SIGNAL EXECUTING");
      await waitUntil(() => host.missionControl.get(device.deviceId).phase === "running");
      expect(await settleDji(host, host.missionControl.pause(device.deviceId))).toMatchObject({ ok: true, state: { phase: "paused" } });
      expect(await settleDji(host, host.missionControl.resume(device.deviceId))).toMatchObject({ ok: true, state: { phase: "running" } });
      host.sendControl("SIGNAL COMPLETED");
      await waitUntil(() => host.missionControl.get(device.deviceId).phase === "completed");

      const secondBytes = await makeKmz({
        "wpmz/template.kml": template,
        "wpmz/waylines.wpml": wpml.replace("120.2,30.2", "120.3,30.3")
      });
      const secondRoute = await host.routeLibrary.importFile({ fileName: "e2e-second-terminal.kmz", bytes: secondBytes });
      expect(secondRoute.status).toBe("imported");
      if (secondRoute.status !== "imported") throw new Error("second route import failed");
      expect((await host.missionControl.stage(device.deviceId, secondRoute.route.routeId)).ok).toBe(true);
      const secondUpload = await settleDji(host, host.missionControl.upload(device.deviceId));
      if (!secondUpload.ok) throw new Error(JSON.stringify(secondUpload));
      expect((await settleDji(host, host.missionControl.start(device.deviceId))).ok).toBe(true);
      host.sendControl("SIGNAL INTERRUPTED");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(host.missionControl.get(device.deviceId).phase).toBe("starting");
      host.sendControl("SIGNAL EXECUTING");
      await waitUntil(() => host.missionControl.get(device.deviceId).phase === "running");
      host.sendControl("SIGNAL INTERRUPTED");
      await waitUntil(() => host.missionControl.get(device.deviceId).phase === "failed");
    } finally {
      await host.close();
    }
  }, 60_000);

  it("手机诊断事件经正式网关到达桌面并收到确认", async () => {
    const host = await DesktopTestHost.start({
      mobileProjectRoot,
      deviceId: "e2e-diagnostics",
    });
    try {
      await host.waitForDevice(30_000);
      host.sendControl("DIAGNOSTIC");
      await waitUntil(() => host.snapshot().diagnostics.length === 1);

      expect(host.snapshot().diagnostics[0]).toMatchObject({
        deviceId: "e2e-diagnostics",
        runId: "e2e-run",
        events: [expect.objectContaining({ eventCode: "HARNESS_EVENT", safeDetail: "controlled diagnostic" })],
      });
    } finally {
      await host.close();
    }
  }, 60_000);

  it("桌面设备设置面板通过正式适配器读取手机相机设置", async () => {
    const host = await DesktopTestHost.start({ mobileProjectRoot, deviceId: "e2e-device-console" });
    try {
      const device = await host.waitForDevice(30_000);
      const read = await settleDji(host, host.deviceSettings.readCamera(device.deviceId));

      expect(read).toMatchObject({ ok: true, domain: "camera" });
      expect(host.deviceSettings.snapshot(device.deviceId).camera).toMatchObject({ focusMode: "AUTO" });
      expect(host.operations.devices()).toEqual([expect.objectContaining({ deviceId: device.deviceId, sessionId: expect.any(String) })]);
    } finally {
      await host.close();
    }
  }, 60_000);
  it("两台中继并行工作时一个故障不会污染另一台", async () => {
    const host = await DesktopTestHost.start({
      mobileProjectRoot,
      deviceId: "e2e-isolated-a",
    });
    try {
      await host.startDevice({ deviceId: "e2e-isolated-b", harnessProfile: "flight-timeout" });
      const [first, second] = await Promise.all([
        host.waitForDevice(30_000, "e2e-isolated-a"),
        host.waitForDevice(30_000, "e2e-isolated-b"),
      ]);

      await Promise.all([
        stageRawMission(host, first.deviceId),
        stageRawMission(host, second.deviceId),
      ]);
      const [firstSettings, secondSettings] = await Promise.all([
        settleDji(host, host.relay.sendCommand(first.deviceId, { name: "device.settings.camera.read", fields: {} }), first.deviceId),
        settleDji(host, host.relay.sendCommand(second.deviceId, { name: "device.settings.camera.read", fields: {} }), second.deviceId),
      ]);
      expect(firstSettings.status).toBe("succeeded");
      expect(secondSettings.status).toBe("succeeded");
      expect((await settleDji(host, host.relay.sendCommand(first.deviceId, {
        name: "live-stream.start",
        fields: { rtmpUrl: text("rtmp://192.168.50.10:19350/live/e2e-isolated-a") },
      }), first.deviceId)).status).toBe("succeeded");

      const [healthy, secondTelemetry] = await Promise.all([
        host.relay.sendCommand(first.deviceId, { name: "telemetry.read", fields: {} }),
        host.relay.sendCommand(second.deviceId, { name: "telemetry.read", fields: {} }),
      ]);
      const failing = await host.relay.sendCommand(second.deviceId, {
        name: "flight.takeoff",
        fields: { confirm: bool(true) },
      });

      expect(healthy.status).toBe("succeeded");
      expect(secondTelemetry.status).toBe("succeeded");
      expect(failing.status).toBe("rejected");
      expect(host.relay.latestTelemetry(first.deviceId)?.payload.fields.aircraft).toEqual(text("CONNECTED"));
      expect(host.relay.latestTelemetry(second.deviceId)?.payload.fields.aircraft).toEqual(text("CONNECTED"));

      const oldSecondSession = second.sessionId;
      host.sendControl("RECONNECT", second.deviceId);
      await waitUntil(() => {
        const current = host.relay.devices().find(({ deviceId }) => deviceId === second.deviceId);
        return current !== undefined && current.sessionId !== oldSecondSession;
      });
      expect((await host.relay.sendCommand(first.deviceId, { name: "telemetry.read", fields: {} })).status).toBe("succeeded");
      expect((await settleDji(host, host.relay.sendCommand(first.deviceId, {
        name: "live-stream.stop",
        fields: {},
      }), first.deviceId)).status).toBe("succeeded");
    } finally {
      await host.close();
    }
  }, 60_000);

  it("手机断线重连更换会话并隔离旧会话迟到结果", async () => {
    const host = await DesktopTestHost.start({
      mobileProjectRoot,
      deviceId: "e2e-session-reconnect",
      harnessProfile: "flight-late",
    });
    try {
      const first = await host.waitForDevice(30_000);
      const pending = host.relay.sendCommand(first.deviceId, {
        name: "flight.takeoff",
        fields: { confirm: bool(true) },
      });

      host.sendControl("RECONNECT");
      await waitUntil(() => {
        const current = host.relay.devices().find(({ deviceId }) => deviceId === first.deviceId);
        return current !== undefined && current.sessionId !== first.sessionId;
      }, 10_000);

      await expect(pending).resolves.toMatchObject({ status: "disconnected" });
      host.sendControl("ADVANCE 2000");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect((await host.relay.sendCommand(first.deviceId, { name: "telemetry.read", fields: {} })).status).toBe("succeeded");
      expect(host.snapshot().childExited).toBe(false);
    } finally {
      await host.close();
    }
  }, 60_000);

  it("非法 WebSocket 帧被隔离且不影响合法手机会话", async () => {
    const host = await DesktopTestHost.start({ mobileProjectRoot, deviceId: "e2e-protocol-security" });
    try {
      const device = await host.waitForDevice(30_000);
      const sendInvalid = async (payload: string | Uint8Array): Promise<void> => {
        const socket = new WebSocket(host.relayEndpoint);
        await new Promise<void>((resolve, reject) => {
          socket.once("open", () => resolve());
          socket.once("error", reject);
        });
        socket.send(payload);
        await new Promise((resolve) => setTimeout(resolve, 50));
        socket.terminate();
      };
      await sendInvalid("text-frame");
      await sendInvalid(new Uint8Array([1, 2, 3]));
      await sendInvalid(new Uint8Array([255, 0, 0, 0, 0]));
      await sendInvalid(new Uint8Array(1_100_000));

      expect((await host.relay.sendCommand(device.deviceId, { name: "telemetry.read", fields: {} })).status).toBe("succeeded");
    } finally {
      await host.close();
    }
  }, 60_000);

  it("握手前断开和握手超时均被回收且不影响合法会话", async () => {
    const host = await DesktopTestHost.start({ mobileProjectRoot, deviceId: "e2e-handshake-boundaries" });
    try {
      const device = await host.waitForDevice(30_000);
      const openSocket = async (): Promise<WebSocket> => {
        const socket = new WebSocket(host.relayEndpoint);
        await new Promise<void>((resolve, reject) => {
          socket.once("open", resolve);
          socket.once("error", reject);
        });
        return socket;
      };

      const disconnectedBeforeHello = await openSocket();
      disconnectedBeforeHello.close();
      await new Promise<void>((resolve) => disconnectedBeforeHello.once("close", () => resolve()));

      const silent = await openSocket();
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("handshake timeout socket was not closed")), 12_000);
        silent.once("close", () => { clearTimeout(timeout); resolve(); });
        silent.once("error", () => undefined);
      });

      expect((await host.relay.sendCommand(device.deviceId, { name: "telemetry.read", fields: {} })).status).toBe("succeeded");
      expect(host.relay.devices()).toEqual([expect.objectContaining({ deviceId: device.deviceId })]);
    } finally {
      await host.close();
    }
  }, 60_000);

  it("固定种子动作序列隔离非法输入并保持正式会话可恢复", async () => {
    const host = await DesktopTestHost.start({ mobileProjectRoot, deviceId: "e2e-seed-20260813" });
    try {
      const device = await host.waitForDevice(30_000);
      const invalidCommands = [
        { name: "telemetry.read", fields: { extra: text("x") } },
        { name: "flight.takeoff", fields: {} },
        { name: "flight.takeoff", fields: { confirm: text("true") } },
        { name: "device.settings.camera.read", fields: { extra: text("x") } },
        { name: "live-stream.start", fields: { rtmpUrl: text("not-a-url") } },
        { name: "unknown.command", fields: {} },
      ];
      for (const request of invalidCommands) {
        expect((await host.relay.sendCommand(device.deviceId, request as never)).status).not.toBe("succeeded");
      }
      const bytes = new Uint8Array([1, 2, 3]);
      expect((await host.relay.sendMission(device.deviceId, {
        missionId: "bad-file",
        fileName: "../bad.kmz",
        bytes,
        size: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      })).status).not.toBe("succeeded");
      expect((await host.relay.sendMission(device.deviceId, {
        missionId: "bad-digest",
        fileName: "bad-digest.kmz",
        bytes,
        size: bytes.byteLength,
        sha256: "0".repeat(64),
      })).status).not.toBe("succeeded");

      let seed = 20_260_813;
      const next = (): number => {
        seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
        return seed;
      };
      const validCommands = [
        { name: "telemetry.read", fields: {} },
        { name: "pairing.status", fields: {} },
        { name: "device.settings.camera.read", fields: {} },
        { name: "device.settings.transmission.read", fields: {} },
      ] as const;
      for (let index = 0; index < 24; index += 1) {
        const request = validCommands[next() % validCommands.length]!;
        const outcome = await settleDji(host, host.relay.sendCommand(device.deviceId, request));
        expect(outcome.status, `seed=20260813 index=${index} command=${request.name}`).toBe("succeeded");
      }
      expect(host.snapshot().childExited).toBe(false);
    } finally {
      await host.close();
    }
  }, 60_000);

  it("全部正式中继命令跨真实 WebSocket 覆盖输入等价类与边界", async () => {
    const host = await DesktopTestHost.start({ mobileProjectRoot, deviceId: "e2e-command-equivalence" });
    try {
      const device = await host.waitForDevice(30_000);
      const send = (name: string, fields: Record<string, never> | Record<string, unknown>) =>
        host.relay.sendCommand(device.deviceId, { name, fields } as never);
      const settle = (name: string, fields: Record<string, unknown>) => settleDji(host, send(name, fields));

      expect((await send("telemetry.read", {})).status).toBe("succeeded");
      expect((await send("pairing.status", {})).status).toBe("succeeded");
      expect((await send("pairing.start", {})).status).toBe("rejected");
      expect((await settle("pairing.stop", {})).status).toBe("succeeded");
      expect((await settle("live-stream.start", { rtmpUrl: text("rtmp://192.168.50.10:19350/live/equivalence") })).status).toBe("succeeded");
      expect((await settle("live-stream.stop", {})).status).toBe("succeeded");
      for (const name of ["flight.takeoff", "flight.land", "flight.return-home"]) {
        expect((await settle(name, { confirm: bool(true) })).status).toBe("succeeded");
      }
      for (const name of ["device.settings.camera.read", "device.settings.transmission.read"]) {
        expect((await settle(name, {})).status).toBe("succeeded");
      }
      expect((await settle("device.settings.camera.write", { focusMode: text("AUTO") })).status).toBe("succeeded");
      expect((await settle("device.settings.transmission.write", { bandwidth: text("BANDWIDTH_20MHZ") })).status).toBe("succeeded");

      await stageRawMission(host, device.deviceId);
      expect((await settle("wayline.upload", { confirm: bool(true) })).status).toBe("succeeded");
      expect((await settle("wayline.start", { confirm: bool(true) })).status).toBe("succeeded");
      host.sendControl("SIGNAL EXECUTING");
      await waitUntil(() => host.relay.latestTelemetry(device.deviceId)?.payload.fields.missionExecution?.kind === "string"
        && host.relay.latestTelemetry(device.deviceId)?.payload.fields.missionExecution?.value === "EXECUTING");
      expect((await settle("wayline.pause", { confirm: bool(true) })).status).toBe("succeeded");
      expect((await settle("wayline.resume", { confirm: bool(true) })).status).toBe("succeeded");
      expect((await settle("wayline.stop", { confirm: bool(true) })).status).toBe("succeeded");

      const validFields: Record<string, Record<string, unknown>> = {
        "telemetry.read": {}, "pairing.start": {}, "pairing.stop": {}, "pairing.status": {},
        "live-stream.start": { rtmpUrl: text("rtmp://127.0.0.1/live/extra") }, "live-stream.stop": {},
        "flight.takeoff": { confirm: bool(true) }, "flight.land": { confirm: bool(true) }, "flight.return-home": { confirm: bool(true) },
        "device.settings.camera.read": {}, "device.settings.camera.write": { focusMode: text("AUTO") },
        "device.settings.transmission.read": {}, "device.settings.transmission.write": { bandwidth: text("BANDWIDTH_20MHZ") },
        "wayline.upload": { confirm: bool(true) }, "wayline.start": { confirm: bool(true) },
        "wayline.pause": { confirm: bool(true) }, "wayline.resume": { confirm: bool(true) }, "wayline.stop": { confirm: bool(true) },
      };
      for (const [name, fields] of Object.entries(validFields)) {
        expect((await send(name, { ...fields, unexpected: text("x") })).status, `${name} extra field`).toBe("rejected");
      }
      for (const name of ["live-stream.start", "flight.takeoff", "flight.land", "flight.return-home", "device.settings.camera.write", "device.settings.transmission.write", "wayline.upload", "wayline.start", "wayline.pause", "wayline.resume", "wayline.stop"]) {
        expect((await send(name, {})).status, `${name} missing field`).toBe("rejected");
      }
      expect((await send("live-stream.start", { rtmpUrl: bool(true) })).status).toBe("rejected");
      expect((await send("flight.takeoff", { confirm: text("true") })).status).toBe("rejected");
      expect((await send("device.settings.camera.write", { focusMode: bool(true) })).status).toBe("rejected");
      expect((await settle("device.settings.camera.write", { focusMode: text(`A${"1".repeat(63)}`) })).status).toBe("succeeded");
      expect((await send("device.settings.camera.write", { focusMode: text(`A${"1".repeat(64)}`) })).status).toBe("rejected");
      expect((await send("wayline.generate", {})).status).toBe("rejected");
      expect(host.snapshot().childExited).toBe(false);
    } finally {
      await host.close();
    }
  }, 60_000);

  it("DJI 拒绝相机设置写入时桌面收到失败且原设置不被污染", async () => {
    const host = await DesktopTestHost.start({
      mobileProjectRoot,
      deviceId: "e2e-settings-reject",
      harnessProfile: "settings-reject",
    });
    try {
      const device = await host.waitForDevice(30_000);
      const rejected = await settleDji(host, host.relay.sendCommand(device.deviceId, {
        name: "device.settings.camera.write",
        fields: { focusMode: text("MANUAL") },
      }));
      const readBack = await settleDji(host, host.relay.sendCommand(device.deviceId, {
        name: "device.settings.camera.read",
        fields: {},
      }));

      expect(rejected.status).toBe("rejected");
      expect(readBack.status).toBe("succeeded");
      expect(readBack.result?.fields.settings).toMatchObject({
        kind: "object",
        fields: { focusMode: text("AUTO") },
      });
    } finally {
      await host.close();
    }
  }, 60_000);

  it("航线上传等待 DJI 回调超时时不会把已暂存航线误报为已上传", async () => {
    const host = await DesktopTestHost.start({
      mobileProjectRoot,
      deviceId: "e2e-mission-upload-timeout",
      harnessProfile: "mission-upload-timeout",
    });
    try {
      const device = await host.waitForDevice(30_000);
      const bytes = new TextEncoder().encode("mission-upload-timeout");
      const staged = await host.relay.sendMission(device.deviceId, {
        missionId: "e2e-upload-timeout",
        fileName: "upload-timeout.kmz",
        bytes,
        size: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      const upload = await host.relay.sendCommand(device.deviceId, {
        name: "wayline.upload",
        fields: { confirm: bool(true) },
      });

      expect(staged.status).toBe("succeeded");
      expect(upload.status).toBe("rejected");
    } finally {
      await host.close();
    }
  }, 60_000);

  it("航线上传隔离拒绝抛出重复和迟到 DJI 回调", async () => {
    const profiles = ["mission-upload-reject", "mission-upload-throw", "mission-upload-duplicate", "mission-upload-late"] as const;
    const host = await DesktopTestHost.start({ mobileProjectRoot, deviceId: `e2e-${profiles[0]}`, harnessProfile: profiles[0] });
    try {
      for (const profile of profiles.slice(1)) await host.startDevice({ deviceId: `e2e-${profile}`, harnessProfile: profile });
      for (const profile of profiles) await host.waitForDevice(30_000, `e2e-${profile}`);
      for (const profile of profiles) {
        const deviceId = `e2e-${profile}`;
        await stageRawMission(host, deviceId);
        const pending = host.relay.sendCommand(deviceId, { name: "wayline.upload", fields: { confirm: bool(true) } });
        const outcome = profile === "mission-upload-duplicate" ? await settleDji(host, pending, deviceId) : await pending;
        expect(outcome.status).toBe(profile === "mission-upload-duplicate" ? "succeeded" : "rejected");
        if (profile === "mission-upload-late") {
          host.sendControl("ADVANCE 2000", deviceId);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        expect((await host.relay.sendCommand(deviceId, { name: "telemetry.read", fields: {} })).status).toBe("succeeded");
      }
    } finally { await host.close(); }
  }, 90_000);

  it("航线控制隔离拒绝抛出超时重复和迟到 DJI 回调", async () => {
    const profiles = ["mission-control-reject", "mission-control-throw", "mission-control-timeout", "mission-control-duplicate", "mission-control-late"] as const;
    const host = await DesktopTestHost.start({ mobileProjectRoot, deviceId: `e2e-${profiles[0]}`, harnessProfile: profiles[0] });
    try {
      for (const profile of profiles.slice(1)) await host.startDevice({ deviceId: `e2e-${profile}`, harnessProfile: profile });
      for (const profile of profiles) await host.waitForDevice(30_000, `e2e-${profile}`);
      for (const profile of profiles) {
        const deviceId = `e2e-${profile}`;
        await stageRawMission(host, deviceId);
        expect((await settleDji(host, host.relay.sendCommand(deviceId, { name: "wayline.upload", fields: { confirm: bool(true) } }), deviceId)).status).toBe("succeeded");
        const pending = host.relay.sendCommand(deviceId, { name: "wayline.start", fields: { confirm: bool(true) } });
        const outcome = profile === "mission-control-duplicate" ? await settleDji(host, pending, deviceId) : await pending;
        expect(outcome.status).toBe(profile === "mission-control-duplicate" ? "succeeded" : "rejected");
        if (profile === "mission-control-late") {
          host.sendControl("ADVANCE 2000", deviceId);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    } finally { await host.close(); }
  }, 120_000);

  it("设置接缝隔离抛出超时重复和迟到 DJI 回调", async () => {
    const profiles = ["settings-throw", "settings-timeout", "settings-duplicate", "settings-late"] as const;
    const host = await DesktopTestHost.start({ mobileProjectRoot, deviceId: `e2e-${profiles[0]}`, harnessProfile: profiles[0] });
    try {
      for (const profile of profiles.slice(1)) await host.startDevice({ deviceId: `e2e-${profile}`, harnessProfile: profile });
      for (const profile of profiles) await host.waitForDevice(30_000, `e2e-${profile}`);
      for (const profile of profiles) {
        const deviceId = `e2e-${profile}`;
        const pending = host.relay.sendCommand(deviceId, { name: "device.settings.camera.write", fields: { focusMode: text("MANUAL") } });
        const outcome = profile === "settings-duplicate" ? await settleDji(host, pending, deviceId) : await pending;
        expect(outcome.status).toBe(profile === "settings-duplicate" ? "succeeded" : "rejected");
        if (profile === "settings-late") {
          host.sendControl("ADVANCE 2000", deviceId);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        expect((await settleDji(host, host.relay.sendCommand(deviceId, { name: "device.settings.camera.read", fields: {} }), deviceId)).status)
          .toBe(profile === "settings-throw" || profile === "settings-timeout" ? "rejected" : "succeeded");
      }
    } finally { await host.close(); }
  }, 90_000);

  it("图传接缝隔离拒绝抛出重复和迟到 DJI 回调", async () => {
    const profiles = ["stream-reject", "stream-throw", "stream-duplicate", "stream-late"] as const;
    const host = await DesktopTestHost.start({ mobileProjectRoot, deviceId: `e2e-${profiles[0]}`, harnessProfile: profiles[0] });
    try {
      for (const profile of profiles.slice(1)) await host.startDevice({ deviceId: `e2e-${profile}`, harnessProfile: profile });
      for (const profile of profiles) await host.waitForDevice(30_000, `e2e-${profile}`);
      for (const profile of profiles) {
        const deviceId = `e2e-${profile}`;
        const pending = host.relay.sendCommand(deviceId, { name: "live-stream.start", fields: { rtmpUrl: text(`rtmp://192.168.50.10/live/${deviceId}`) } });
        const outcome = profile === "stream-duplicate" ? await settleDji(host, pending, deviceId) : await pending;
        expect(outcome.status).toBe(profile === "stream-duplicate" ? "succeeded" : "rejected");
        if (profile === "stream-late") {
          host.sendControl("ADVANCE 2000", deviceId);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        expect((await host.relay.sendCommand(deviceId, { name: "telemetry.read", fields: {} })).status).toBe("succeeded");
      }
    } finally { await host.close(); }
  }, 90_000);

  it("图传启动超时时桌面收到失败而不是媒体已就绪", async () => {
    const host = await DesktopTestHost.start({
      mobileProjectRoot,
      deviceId: "e2e-stream-timeout",
      harnessProfile: "stream-timeout",
    });
    try {
      const device = await host.waitForDevice(30_000);
      const start = await host.relay.sendCommand(device.deviceId, {
        name: "live-stream.start",
        fields: { rtmpUrl: text("rtmp://127.0.0.1/live/e2e-stream-timeout") },
      });
      const telemetry = await host.relay.sendCommand(device.deviceId, { name: "telemetry.read", fields: {} });

      expect(start.status).toBe("rejected");
      expect(telemetry.status).toBe("succeeded");
      expect(telemetry.result?.fields.liveStreaming).toEqual(bool(false));
    } finally {
      await host.close();
    }
  }, 60_000);

  it("正式媒体流水线为图传控制生成目标并驱动手机开始停止", async () => {
    const host = await DesktopTestHost.start({
      mobileProjectRoot,
      deviceId: "e2e-live-stream-control",
    });
    try {
      const device = await host.waitForDevice(30_000);
      expect((await host.operations.refreshTelemetry(device.deviceId)).status).toBe("succeeded");
      await waitUntil(() => host.operations.telemetry(device.deviceId) !== null);
      expect(host.operations.controlTelemetry(device.deviceId)).not.toBeNull();
      expect(host.mediaPipeline.snapshot()).toMatchObject({
        phase: "running",
        endpoint: { host: "192.168.50.10" },
      });
      expect(host.desktopRuntime.snapshot()).toMatchObject({ phase: "running" });

      expect(await settleDji(host, host.liveStreamControl.start(device.deviceId))).toMatchObject({
        ok: true,
        state: { phase: "streaming" },
      });
      expect(await settleDji(host, host.liveStreamControl.stop(device.deviceId))).toMatchObject({
        ok: true,
        state: { phase: "idle" },
      });
    } finally {
      await host.close();
    }
  }, 60_000);

  it("DJI 同步拒绝起飞时不会阻塞后续飞控命令", async () => {
    const host = await DesktopTestHost.start({
      mobileProjectRoot,
      deviceId: "e2e-flight-reject",
      harnessProfile: "flight-reject",
    });
    try {
      const device = await host.waitForDevice(30_000);
      const rejected = await host.relay.sendCommand(device.deviceId, {
        name: "flight.takeoff",
        fields: { confirm: bool(true) },
      });
      const land = await settleDji(host, host.relay.sendCommand(device.deviceId, {
        name: "flight.land",
        fields: { confirm: bool(true) },
      }));

      expect(rejected.status).toBe("rejected");
      expect(land.status).toBe("succeeded");
    } finally {
      await host.close();
    }
  }, 60_000);

  it("DJI 抛出重复和迟到回调均被隔离且不会污染后续命令", async () => {
    const host = await DesktopTestHost.start({
      mobileProjectRoot,
      deviceId: "e2e-flight-throw",
      harnessProfile: "flight-throw",
    });
    try {
      await host.startDevice({ deviceId: "e2e-flight-duplicate", harnessProfile: "flight-duplicate" });
      await host.startDevice({ deviceId: "e2e-flight-late", harnessProfile: "flight-late" });
      await Promise.all([
        host.waitForDevice(30_000, "e2e-flight-throw"),
        host.waitForDevice(30_000, "e2e-flight-duplicate"),
        host.waitForDevice(30_000, "e2e-flight-late"),
      ]);
      const takeoff = (deviceId: string) => host.relay.sendCommand(deviceId, { name: "flight.takeoff", fields: { confirm: bool(true) } });
      expect((await takeoff("e2e-flight-throw")).status).toBe("rejected");
      expect((await settleDji(host, takeoff("e2e-flight-duplicate"), "e2e-flight-duplicate")).status).toBe("succeeded");
      const late = await takeoff("e2e-flight-late");
      expect(late.status).toBe("rejected");
      host.sendControl("ADVANCE 2000", "e2e-flight-late");
      await new Promise((resolve) => setTimeout(resolve, 100));

      for (const deviceId of ["e2e-flight-throw", "e2e-flight-duplicate", "e2e-flight-late"]) {
        expect((await settleDji(host, host.relay.sendCommand(deviceId, { name: "flight.land", fields: { confirm: bool(true) } }), deviceId)).status)
          .toBe(deviceId === "e2e-flight-throw" ? "rejected" : "succeeded");
      }
    } finally {
      await host.close();
    }
  }, 60_000);

  it("桌面正式飞控必须显式确认后才经手机执行", async () => {
    const host = await DesktopTestHost.start({
      mobileProjectRoot,
      deviceId: "e2e-flight-control",
    });
    try {
      const device = await host.waitForDevice(30_000);
      expect((await host.operations.refreshTelemetry(device.deviceId)).status).toBe("succeeded");
      await waitUntil(() => host.operations.telemetry(device.deviceId) !== null);
      expect(host.operations.controlTelemetry(device.deviceId)).not.toBeNull();
      const requested = host.flightControl.request(device.deviceId, "takeoff");
      if (!requested.ok) throw new Error(JSON.stringify(requested));
      expect(requested).toMatchObject({ ok: true, code: "CONFIRMATION_REQUIRED" });
      expect(host.flightControl.get(device.deviceId)).toMatchObject({ action: "takeoff" });

      const confirmed = await settleDji(
        host,
        host.flightControl.confirm(device.deviceId, requested.confirmation.confirmationId),
      );
      expect(confirmed).toMatchObject({ ok: true, code: "SUCCEEDED", action: "takeoff" });
      expect(host.flightControl.get(device.deviceId)).toBeNull();
    } finally {
      await host.close();
    }
  }, 60_000);

  it("通过真实 WebSocket 发现 Kotlin 中继并读取正式遥测", async () => {
    const host = await DesktopTestHost.start({
      mobileProjectRoot,
      deviceId: "e2e-relay-1",
    });
    try {
      const device = await host.waitForDevice(30_000);
      expect(device.deviceId).toBe("e2e-relay-1");

      const result = await host.relay.sendCommand(device.deviceId, { name: "telemetry.read", fields: {} });
      expect(result.status, result.detail).toBe("succeeded");
      expect(result.result?.fields.sdkAvailability).toEqual({ kind: "string", value: "READY" });
      expect(host.relay.latestTelemetry(device.deviceId)?.payload.fields.aircraft).toEqual({
        kind: "string",
        value: "CONNECTED",
      });

      expect((await host.relay.sendCommand(device.deviceId, { name: "pairing.status", fields: {} })).status).toBe("succeeded");
      expect((await host.relay.sendCommand(device.deviceId, { name: "pairing.start", fields: {} })).status).toBe("rejected");
      expect((await settleDji(host, host.relay.sendCommand(device.deviceId, { name: "pairing.stop", fields: {} }))).status).toBe("succeeded");

      const camera = await settleDji(host, host.relay.sendCommand(device.deviceId, {
        name: "device.settings.camera.write",
        fields: { focusMode: text("AUTO") },
      }));
      expect(camera.status).toBe("succeeded");
      expect(camera.result?.fields.settings).toMatchObject({
        kind: "object",
        fields: { focusMode: text("AUTO") },
      });
      const transmission = await settleDji(host, host.relay.sendCommand(device.deviceId, {
        name: "device.settings.transmission.write",
        fields: { bandwidth: text("BANDWIDTH_20MHZ") },
      }));
      expect(transmission.status).toBe("succeeded");
      expect(transmission.result?.fields.settings).toMatchObject({
        kind: "object",
        fields: { bandwidth: text("BANDWIDTH_20MHZ") },
      });

      expect((await host.relay.sendCommand(device.deviceId, { name: "flight.takeoff", fields: {} })).status).toBe("rejected");
      for (const name of ["flight.takeoff", "flight.land", "flight.return-home"] as const) {
        expect((await settleDji(host, host.relay.sendCommand(device.deviceId, {
          name,
          fields: { confirm: bool(true) },
        }))).status).toBe("succeeded");
      }

      expect((await settleDji(host, host.relay.sendCommand(device.deviceId, {
        name: "live-stream.start",
        fields: { rtmpUrl: text("rtmp://192.168.50.10:19350/live/e2e-relay-1") },
      }))).status).toBe("succeeded");
      expect((await settleDji(host, host.relay.sendCommand(device.deviceId, {
        name: "live-stream.stop",
        fields: {},
      }))).status).toBe("succeeded");

      const bytes = new TextEncoder().encode("cross-runtime-e2e-kmz");
      const mission = await host.relay.sendMission(device.deviceId, {
        missionId: "e2e-mission-1",
        fileName: "e2e-route.kmz",
        bytes,
        size: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      expect(mission.status).toBe("succeeded");
      expect((await settleDji(host, host.relay.sendCommand(device.deviceId, {
        name: "wayline.upload",
        fields: { confirm: bool(true) },
      }))).status).toBe("succeeded");
      expect((await settleDji(host, host.relay.sendCommand(device.deviceId, {
        name: "wayline.start",
        fields: { confirm: bool(true) },
      }))).status).toBe("succeeded");
      host.sendControl("SIGNAL EXECUTING");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(host.relay.latestTelemetry(device.deviceId)?.payload.fields.missionExecution).toEqual(text("EXECUTING"));
      host.sendControl("SIGNAL COMPLETED");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(host.relay.latestTelemetry(device.deviceId)?.payload.fields.missionExecution).toEqual(text("FINISHED"));
    } finally {
      await host.close();
    }
  }, 60_000);

  it("DJI 无回调会有限超时且关闭操作幂等", async () => {
    const host = await DesktopTestHost.start({
      mobileProjectRoot,
      deviceId: "e2e-timeout-relay",
      harnessProfile: "flight-timeout",
    });
    try {
      const device = await host.waitForDevice(30_000);
      const outcome = await host.relay.sendCommand(device.deviceId, {
        name: "flight.takeoff",
        fields: { confirm: bool(true) },
      });
      expect(outcome.status).toBe("rejected");
      expect(host.snapshot().childExited).toBe(false);
    } finally {
      await host.close();
      await host.close();
      expect(host.snapshot().closed).toBe(true);
    }
  }, 60_000);

  it("桌面关闭会解除在途命令而不留下挂起 Promise", async () => {
    const host = await DesktopTestHost.start({
      mobileProjectRoot,
      deviceId: "e2e-disconnect-relay",
      harnessProfile: "flight-timeout",
    });
    const device = await host.waitForDevice(30_000);
    const pending = host.relay.sendCommand(device.deviceId, {
      name: "flight.takeoff",
      fields: { confirm: bool(true) },
    });

    await host.close();

    await expect(pending).resolves.toMatchObject({ status: "disconnected" });
  }, 60_000);

  it("手机进程先退出会移除设备并解除在途命令", async () => {
    const host = await DesktopTestHost.start({
      mobileProjectRoot,
      deviceId: "e2e-mobile-first-close",
      harnessProfile: "flight-timeout",
    });
    try {
      const device = await host.waitForDevice(30_000);
      const pending = host.relay.sendCommand(device.deviceId, {
        name: "flight.takeoff",
        fields: { confirm: bool(true) },
      });

      host.sendControl("EXIT");

      await expect(pending).resolves.toMatchObject({ status: "disconnected" });
      await waitUntil(() => host.relay.devices().length === 0);
      await waitUntil(() => host.snapshot().childExited);
      expect(host.desktopRuntime.snapshot().phase).toBe("running");
    } finally {
      await host.close();
    }
  }, 60_000);
});
