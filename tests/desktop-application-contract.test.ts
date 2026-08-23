import { describe, expect, it } from "vitest";
import { once } from "node:events";
import { createServer } from "node:net";
import { WebSocket } from "ws";
import { DesktopApplication } from "../src/production/desktop-application/index.js";
import { DesktopUiGateway } from "../src/production/desktop-ui-gateway/index.js";
import { RelayFrameCodec } from "../src/modules/relay-link/protocol-core/index.js";

const reservePort = async (): Promise<number> => new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address === null || typeof address === "string") {
      server.close(() => reject(new Error("无法分配测试端口")));
      return;
    }
    server.close((error) => error === undefined ? resolve(address.port) : reject(error));
  });
});

const nextMessage = async (socket: WebSocket): Promise<Uint8Array> => {
  const [payload] = await once(socket, "message");
  return payload instanceof Uint8Array ? payload : new Uint8Array(payload as ArrayBuffer);
};
const text = (value: string) => ({ kind: "string" as const, value });
const bool = (value: boolean) => ({ kind: "boolean" as const, value });
const object = (fields: Record<string, unknown>) => ({ kind: "object" as const, fields });

const options = (relayPort: number, calls: string[], behavior: Readonly<{ readonly failRtmpStart?: boolean; readonly failHlsStop?: boolean }> = {}) => ({
  network: { listenPort: 19_350, relayPort, manualHost: null as string | null },
  relay: {
    address: { host: "127.0.0.1", port: relayPort },
    handshakeTimeoutMs: 1_000,
    maxConnections: 4,
    commandTimeoutMs: 1_000,
    missionTimeoutMs: 1_000,
  },
  media: {
    dependencies: {
      rtmp: { listen: () => { calls.push("rtmp-listen"); if (behavior.failRtmpStart) throw new Error("受控 RTMP 启动失败"); }, close: () => { calls.push("rtmp-close"); } },
      hls: { listen: () => { calls.push("hls-listen"); }, close: () => { calls.push("hls-close"); if (behavior.failHlsStop) throw new Error("受控 HLS 停止失败"); } },
      fileFacts: { isExecutableFile: () => true },
      processFactory: () => ({ launch: () => ({ terminate: () => undefined }) }),
      player: { setSource: () => undefined, clear: () => { calls.push("player-clear"); } },
      clock: () => 100,
    },
    options: { rtmpPort: 19_350, hlsPort: 18_080, health: { ingestTimeoutMs: 1_000, playlistTimeoutMs: 1_000 } },
    startInput: {
      interfaces: [{ name: "test-wifi", enabled: true, internal: false, kind: "wifi", ipv4: "192.168.1.8" }],
      manualHost: null,
      hlsRootDirectory: "D:/controlled-hls",
      ffmpegCandidates: [{ source: "bundled", executablePath: "D:/controlled-ffmpeg.exe" }],
    },
  },
  mission: { createMissionId: (deviceId: string, routeId: string) => `mission-${deviceId}-${routeId}` },
  flight: { now: () => 100, confirmation: { ttlMs: 1_000, createConfirmationId: () => "confirmation-1" } },
  now: () => 100,
});

describe("DesktopApplication", () => {
  it("拒绝不完整配置且不创建任何运行时资源", () => {
    const result = DesktopApplication.create({} as never);

    expect(result).toEqual({ ok: false, code: "INVALID_CONFIGURATION" });
  });

  it("covers invalid configuration containers, dependencies and callbacks", async () => {
    const base = options(await reservePort(), []);
    const invalid = [
      null, 1, "options", [],
      { ...base, relay: null },
      { ...base, media: null },
      { ...base, media: { ...base.media, dependencies: null } },
      { ...base, media: { ...base.media, options: null } },
      { ...base, media: { ...base.media, startInput: null } },
      { ...base, mission: null },
      { ...base, flight: null },
      { ...base, now: null },
      { ...base, mission: { ...base.mission, createMissionId: null } },
      { ...base, flight: { ...base.flight, now: null } },
      { ...base, flight: { ...base.flight, confirmation: null } },
      { ...base, legacyMediaRequired: "yes" },
      { ...base, routeLibrary: null },
      { ...base, network: null },
    ];
    for (const value of invalid) expect(DesktopApplication.create(value as never)).toEqual({ ok: false, code: "INVALID_CONFIGURATION" });
  });

  it("maps construction exceptions to dependency failure", async () => {
    const raw = options(await reservePort(), []);
    Object.defineProperty(raw, "routeLibrary", { enumerable: true, get: () => { throw new Error("route configuration"); } });
    expect(DesktopApplication.create(raw)).toEqual({ ok: false, code: "DEPENDENCY_FAILURE" });
  });

  it("用真实中继和受控媒体按既定顺序启动、停止并释放", async () => {
    const calls: string[] = [];
    const created = DesktopApplication.create(options(await reservePort(), calls));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const observed: string[] = [];
    const unsubscribe = created.value.subscribe((snapshot) => { observed.push(snapshot.phase); });
    expect(await created.value.start()).toMatchObject({ ok: true, value: { phase: "running" } });
    expect(JSON.stringify(created.value.snapshot())).not.toContain("192.168.1.8");
    expect(created.value.workflow().snapshot()).toMatchObject({ phase: "ready", devices: [], routes: [] });
    expect(await created.value.stop()).toMatchObject({ ok: true, value: { phase: "idle" } });
    unsubscribe();
    await created.value.dispose();

    expect(calls).toEqual(["hls-listen", "rtmp-listen", "player-clear", "rtmp-close", "hls-close", "player-clear"]);
    expect([...new Set(observed)]).toEqual(["starting", "running", "stopping", "idle"]);
    await expect(created.value.start()).resolves.toMatchObject({ ok: false, code: "DISPOSED" });
  });

  it("保留旧链路默认对象图，并在启用旁路时先停止低延迟媒体", async () => {
    const calls: string[] = [];
    const base = options(await reservePort(), calls);
    const defaultCreated = DesktopApplication.create(base);
    expect(defaultCreated.ok).toBe(true);
    if (!defaultCreated.ok) return;
    expect(defaultCreated.value.lowLatency()).toBeNull();
    await defaultCreated.value.dispose();
    calls.length = 0;

    let exit: ((event: { readonly kind: "exited" | "failed" }) => void) | null = null;
    const created = DesktopApplication.create({
      ...base,
      lowLatency: {
        media: {
          dependencies: {
            process: {
              launch: (_input: unknown, onExit: (event: { readonly kind: "exited" | "failed" }) => void) => {
                calls.push("webrtc-launch");
                exit = onExit;
                return { terminate: () => { calls.push("webrtc-terminate"); exit?.({ kind: "exited" }); } };
              },
            },
            paths: {
              listPaths: async () => [],
            },
            player: {
              setTarget: () => undefined,
              clear: () => { calls.push("webrtc-player-clear"); },
            },
          },
          options: { httpPort: 18_890, webRtcUdpPort: 18_189, apiPort: 19_997, pathPrefix: "/live", mode: "whip-whep", publisherTimeoutMs: 5_000 },
          startInput: {
            interfaces: [{ name: "test-wifi", enabled: true, internal: false, kind: "wifi", ipv4: "192.168.1.8" }],
            manualHost: "192.168.1.8",
            executablePath: "D:/mediamtx.exe",
          },
        },
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const lowLatency = created.value.lowLatency();
    expect(lowLatency).not.toBeNull();
    if (lowLatency === null) return;

    await expect(created.value.start()).resolves.toMatchObject({ ok: true });
    await expect(lowLatency.start()).resolves.toMatchObject({ ok: true });
    await expect(created.value.stop()).resolves.toMatchObject({ ok: true });
    expect(calls.indexOf("webrtc-terminate")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("webrtc-terminate")).toBeLessThan(calls.indexOf("player-clear"));
    await created.value.dispose();
  });

  it("媒体启动失败时回收已启动中继并回到可重试空闲态", async () => {
    const calls: string[] = [];
    const created = DesktopApplication.create(options(await reservePort(), calls, { failRtmpStart: true }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(created.value.start()).resolves.toMatchObject({ ok: false, code: "MEDIA_START_FAILED", value: { phase: "idle" } });
    expect(created.value.snapshot()).toMatchObject({ phase: "idle", runtime: { phase: "idle" } });
    expect(calls).toEqual(["hls-listen", "rtmp-listen", "hls-close"]);
    await expect(created.value.stop()).resolves.toMatchObject({ ok: false, code: "NOT_RUNNING" });
    await created.value.dispose();
  });

  it("显式允许旧媒体失败时仍保持应用和控制面运行", async () => {
    const calls: string[] = [];
    const created = DesktopApplication.create({
      ...options(await reservePort(), calls, { failRtmpStart: true }),
      legacyMediaRequired: false,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(created.value.start()).resolves.toMatchObject({ ok: true, value: { phase: "running", runtime: { phase: "running" } } });
    expect(calls).not.toContain("relay-close");
    await expect(created.value.stop()).resolves.toMatchObject({ ok: true, value: { phase: "idle" } });
    await created.value.dispose();
  });

  it("旧媒体失败后仍可独立启动并停止 WebRTC 旁路", async () => {
    const calls: string[] = [];
    let exit: ((event: { readonly kind: "exited" | "failed" }) => void) | null = null;
    const created = DesktopApplication.create({
      ...options(await reservePort(), calls, { failRtmpStart: true }),
      legacyMediaRequired: false,
      lowLatency: {
        media: {
          dependencies: {
            process: {
              launch: (_input: unknown, onExit: (event: { readonly kind: "exited" | "failed" }) => void) => {
                calls.push("webrtc-launch");
                exit = onExit;
                return { terminate: () => { calls.push("webrtc-terminate"); exit?.({ kind: "exited" }); } };
              },
            },
            paths: { listPaths: async () => [] },
            player: { setTarget: () => undefined, clear: () => { calls.push("webrtc-player-clear"); } },
          },
          options: { httpPort: 18_890, webRtcUdpPort: 18_189, apiPort: 19_997, pathPrefix: "/live", mode: "whip-whep", publisherTimeoutMs: 5_000 },
          startInput: {
            interfaces: [{ name: "test-wifi", enabled: true, internal: false, kind: "wifi", ipv4: "192.168.1.8" }],
            manualHost: "192.168.1.8",
            executablePath: "D:/mediamtx.exe",
          },
        },
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const lowLatency = created.value.lowLatency();
    expect(lowLatency).not.toBeNull();
    if (lowLatency === null) return;

    await expect(created.value.start()).resolves.toMatchObject({ ok: true, value: { phase: "running" } });
    await expect(lowLatency.start()).resolves.toMatchObject({ ok: true });
    expect(calls).toContain("webrtc-launch");
    await expect(created.value.stop()).resolves.toMatchObject({ ok: true, value: { phase: "idle" } });
    expect(calls).toContain("webrtc-terminate");
    expect(calls).toContain("hls-close");
    await created.value.dispose();
  });

  it("WebRTC 停止失败时仍继续清理旧 RTMP/HLS", async () => {
    const calls: string[] = [];
    const created = DesktopApplication.create({
      ...options(await reservePort(), calls),
      lowLatency: {
        media: {
          dependencies: {
            process: {
              launch: () => ({ terminate: () => { calls.push("webrtc-terminate"); throw new Error("受控 WebRTC 停止失败"); } }),
            },
            paths: { listPaths: async () => [] },
            player: { setTarget: () => undefined, clear: () => { calls.push("webrtc-player-clear"); } },
          },
          options: { httpPort: 18_890, webRtcUdpPort: 18_189, apiPort: 19_997, pathPrefix: "/live", mode: "whip-whep", publisherTimeoutMs: 5_000 },
          startInput: {
            interfaces: [{ name: "test-wifi", enabled: true, internal: false, kind: "wifi", ipv4: "192.168.1.8" }],
            manualHost: "192.168.1.8",
            executablePath: "D:/mediamtx.exe",
          },
        },
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const lowLatency = created.value.lowLatency();
    expect(lowLatency).not.toBeNull();
    if (lowLatency === null) return;

    await created.value.start();
    await lowLatency.start();
    await expect(created.value.stop()).resolves.toMatchObject({ ok: false, code: "DEPENDENCY_FAILURE", value: { phase: "idle" } });
    expect(calls).toContain("webrtc-terminate");
    expect(calls).toContain("rtmp-close");
    expect(calls).toContain("hls-close");
    await created.value.dispose();
  });

  it("只通过 UI 网关向未来页面交付脱敏的真实装配快照", async () => {
    const created = DesktopApplication.create(options(await reservePort(), []));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await expect(created.value.start()).resolves.toMatchObject({ ok: true });
    const gateway = DesktopUiGateway.create({ application: created.value });

    await expect(gateway.invoke("state.snapshot", undefined)).resolves.toMatchObject({ ok: true, value: { phase: "running" } });
    expect(JSON.stringify(gateway.snapshot())).not.toContain("192.168.1.8");
    await expect(gateway.invoke("video.playback", { deviceId: "device-a" })).resolves.toEqual({ ok: true, value: { ok: false, code: "VIDEO_NOT_READY" } });

    gateway.dispose();
    await created.value.dispose();
  });

  it("串行化并发启停，并在媒体停止失败后仍释放中继", async () => {
    const calls: string[] = [];
    const created = DesktopApplication.create(options(await reservePort(), calls, { failHlsStop: true }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const starting = created.value.start();
    await expect(created.value.start()).resolves.toMatchObject({ ok: false, code: "OPERATION_IN_PROGRESS" });
    await expect(starting).resolves.toMatchObject({ ok: true, value: { phase: "running" } });
    const stopping = created.value.stop();
    await expect(created.value.stop()).resolves.toMatchObject({ ok: false, code: "OPERATION_IN_PROGRESS" });
    await expect(stopping).resolves.toMatchObject({ ok: false, code: "MEDIA_STOP_FAILED", value: { phase: "idle" } });
    expect(created.value.snapshot()).toMatchObject({ phase: "idle", runtime: { relay: { devices: [] } } });
    await created.value.dispose();
    expect(calls).toContain("hls-close");
  });

  it("returns stable results for duplicate lifecycle calls and release", async () => {
    const created = DesktopApplication.create(options(await reservePort(), []));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const unsubscribe = created.value.subscribe(() => undefined);
    await expect(created.value.start()).resolves.toMatchObject({ ok: true });
    await expect(created.value.start()).resolves.toMatchObject({ ok: false, code: "ALREADY_RUNNING" });
    await expect(created.value.stop()).resolves.toMatchObject({ ok: true });
    await expect(created.value.stop()).resolves.toMatchObject({ ok: false, code: "NOT_RUNNING" });
    unsubscribe();
    unsubscribe();
    await created.value.dispose();
    await created.value.dispose();
    expect(created.value.snapshot().phase).toBe("disposed");
    await expect(created.value.stop()).resolves.toMatchObject({ ok: false, code: "DISPOSED" });
    const disposedUnsubscribe = created.value.subscribe(() => undefined);
    expect(disposedUnsubscribe).toEqual(expect.any(Function));
    disposedUnsubscribe();
  });

  it("isolates observer failures and invokes the flight preflight bridge", async () => {
    const created = DesktopApplication.create(options(await reservePort(), []));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const unsubscribe = created.value.subscribe(() => { throw new Error("observer"); });
    await expect(created.value.start()).resolves.toMatchObject({ ok: true });
    expect(created.value.workflow().requestFlightAction("offline-device", "takeoff")).toMatchObject({ ok: false });
    unsubscribe();
    await created.value.dispose();
  });

  it("releases an application that was never started", async () => {
    const created = DesktopApplication.create(options(await reservePort(), []));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await expect(created.value.dispose()).resolves.toBeUndefined();
    expect(created.value.snapshot().phase).toBe("disposed");
  });

  it("rejects invalid network settings used to bind listen ports", async () => {
    const base = options(await reservePort(), []);
    expect(DesktopApplication.create({
      ...base,
      network: { listenPort: 80, relayPort: 8080, manualHost: null }
    } as never)).toEqual({ ok: false, code: "INVALID_CONFIGURATION" });
  });

  it("binds WebSocket and RTMP from network settings even when create options disagree", async () => {
    const relayPort = await reservePort();
    const ignoredRelayPort = await reservePort();
    const rtmpPorts: number[] = [];
    const base = options(ignoredRelayPort, []);
    const created = DesktopApplication.create({
      ...base,
      network: { listenPort: 19_351, relayPort, manualHost: null },
      media: {
        ...base.media,
        options: { ...base.media.options, rtmpPort: 19_350 },
        dependencies: {
          ...base.media.dependencies,
          rtmp: {
            listen: (port: number) => { rtmpPorts.push(port); },
            close: () => { rtmpPorts.push(-1); },
          },
        },
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await expect(created.value.start()).resolves.toMatchObject({ ok: true });
    const socket = new WebSocket(`ws://127.0.0.1:${relayPort}/relay`);
    try {
      await once(socket, "open");
      expect(rtmpPorts[0]).toBe(19_351);
    } finally {
      socket.close();
      await once(socket, "close");
      await created.value.dispose();
    }
  });

  it("通过真实中继会话桥接四类设置命令和结构化快照", async () => {
    const relayPort = await reservePort();
    const created = DesktopApplication.create(options(relayPort, []));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await expect(created.value.start()).resolves.toMatchObject({ ok: true });
    const socket = new WebSocket(`ws://127.0.0.1:${relayPort}/relay`);
    try {
      await once(socket, "open");
      const hello = RelayFrameCodec.encode({ type: "hello", deviceId: "settings-device", protocolVersion: "1" });
      if (!hello.ok) throw new Error("hello encoding failed");
      socket.send(hello.value);
      expect(RelayFrameCodec.decode(await nextMessage(socket))).toMatchObject({ kind: "decoded", frame: { type: "paired" } });
      const telemetry = RelayFrameCodec.encode({ type: "telemetry", payload: object({
        sdkAvailability: text("READY"), remoteController: text("CONNECTED"), flightController: text("CONNECTED"), aircraft: text("CONNECTED"), connected: bool(true), isFlying: bool(false), motorsOn: bool(false), batteryPercent: { kind: "number" as const, value: "80" },
      }) as never, capabilities: object({ liveVideo: bool(true), waypointMission: bool(true), waypointMissionSupport: text("SUPPORTED") }) as never });
      if (!telemetry.ok) throw new Error("telemetry encoding failed");
      socket.send(telemetry.value);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const workflow = created.value.workflow();
      expect(workflow.requestFlightAction("settings-device", "takeoff")).toMatchObject({ ok: true, value: { ok: true, code: "CONFIRMATION_REQUIRED" } });
      const commands = [
        ["device.settings.camera.read", undefined],
        ["device.settings.camera.write", { focusMode: text("AUTO") }],
        ["device.settings.transmission.read", undefined],
        ["device.settings.transmission.write", { bandwidth: text("BANDWIDTH_20MHZ") }],
      ] as const;
      for (const [name, fields] of commands) {
        const pending = name.endsWith("camera.read") ? workflow.readCameraSettings("settings-device")
          : name.endsWith("camera.write") ? workflow.writeCameraSettings("settings-device", { focusMode: "AUTO" })
          : name.endsWith("transmission.read") ? workflow.readTransmissionSettings("settings-device")
          : workflow.writeTransmissionSettings("settings-device", { bandwidth: "BANDWIDTH_20MHZ" });
        const command = RelayFrameCodec.decode(await nextMessage(socket));
        expect(command).toMatchObject({ kind: "decoded", frame: { type: "command", command: { name } } });
        if (command.kind !== "decoded" || command.frame.type !== "command") throw new Error("command decoding failed");
        const settingsResult = name.includes("camera")
          ? object({ domain: text("camera"), settings: object({ autoExposureLockEnabled: bool(true), focusMode: text("AUTO"), cameraIndex: text("WIDE") }) })
          : object({ domain: text("transmission"), settings: object({ frequencyBand: text("BAND_2_4_GHZ"), channelSelectionMode: text("AUTO"), bandwidth: text("BANDWIDTH_20MHZ"), dynamicDataRateMbps: { kind: "number" as const, value: "20" } }) });
        const result = RelayFrameCodec.encode({ type: "command-result", id: command.frame.id, ok: true, detail: "ok", result: settingsResult as never });
        if (!result.ok) throw new Error("result encoding failed");
        socket.send(result.value);
        await expect(pending).resolves.toMatchObject({ ok: true });
        expect(fields === undefined || typeof fields === "object").toBe(true);
      }
    } finally {
      socket.close();
      await once(socket, "close");
      await created.value.dispose();
    }
  });
});
