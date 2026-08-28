import { describe, expect, it } from "vitest";
import { DesktopUiGateway } from "../src/production/desktop-ui-gateway/index.js";

describe("DesktopUiGateway", () => {
  it("拒绝未列入白名单的方法，且不会触及工作流", async () => {
    let called = false;
    const gateway = DesktopUiGateway.create({
      application: {
        snapshot: () => ({ phase: "idle" }),
        subscribe: () => () => undefined,
        workflow: () => ({ snapshot: () => ({}) }),
      },
    });

    await expect(gateway.invoke("relay.sendRaw", { called: () => { called = true; } })).resolves.toEqual({ ok: false, code: "METHOD_NOT_ALLOWED" });
    expect(called).toBe(false);
  });

  it("逐一映射全部业务白名单、脱敏快照并只发放本机就绪视频", async () => {
    const calls: Array<Readonly<{ readonly name: string; readonly args: readonly unknown[] }>> = [];
    const named = (name: string) => async (...args: readonly unknown[]) => {
      calls.push({ name, args });
      return { ok: true, name };
    };
    let applicationListener: ((snapshot: unknown) => void) | null = null;
    const workflow = {
      snapshot: () => ({
        media: { streams: [
          { deviceId: "device-a", phase: "ready", playbackUrl: "http://127.0.0.1:18080/live/stream-a.flv", diagnostic: "private" },
          { deviceId: "device-b", phase: "ready", playbackUrl: "https://example.invalid/live/stream-b.flv" },
        ] },
      }),
      checkHardwareReadiness: named("checkHardwareReadiness"),
      importRoute: named("importRoute"), getRoutePreview: named("getRoutePreview"), selectRoute: named("selectRoute"), removeRoute: named("removeRoute"),
      assignRoute: named("assignRoute"), clearAssignment: named("clearAssignment"),
      stage: named("stage"), upload: named("upload"), start: named("start"), pause: named("pause"), resume: named("resume"), stop: named("stop"),
      startStream: named("startStream"), stopStream: named("stopStream"), refreshMedia: named("refreshMedia"), selectVideo: named("selectVideo"), clearVideo: named("clearVideo"),
      readTransmissionSettings: named("readTransmissionSettings"), writeTransmissionSettings: named("writeTransmissionSettings"), readCameraSettings: named("readCameraSettings"), writeCameraSettings: named("writeCameraSettings"),
      requestFlightAction: named("requestFlightAction"), confirmFlightAction: named("confirmFlightAction"), cancelFlightAction: named("cancelFlightAction"),
    };
    const gateway = DesktopUiGateway.create({
      application: {
        snapshot: () => ({ phase: "running", endpoint: { host: "192.168.1.8", port: 1935 }, workflow: { diagnostic: "private", playbackUrl: "http://private" } }),
        subscribe: (listener) => { applicationListener = listener; return () => { applicationListener = null; }; },
        workflow: () => workflow,
      },
    });

    const commands: readonly Readonly<{ readonly method: string; readonly input: unknown }>[] = [
      { method: "hardware.readiness", input: { deviceId: "device-a" } },
      { method: "route.import", input: { fileName: "route.kmz", bytes: new Uint8Array([1, 2]) } },
      { method: "route.preview", input: { routeId: "route-a" } }, { method: "route.select", input: { routeId: "route-a" } }, { method: "route.remove", input: { routeId: "route-a" } },
      { method: "assignment.assign", input: { deviceId: "device-a", routeId: "route-a" } }, { method: "assignment.clear", input: { deviceId: "device-a" } },
      { method: "mission.stage", input: { deviceId: "device-a" } }, { method: "mission.upload", input: { deviceId: "device-a" } }, { method: "mission.start", input: { deviceId: "device-a" } }, { method: "mission.pause", input: { deviceId: "device-a" } }, { method: "mission.resume", input: { deviceId: "device-a" } }, { method: "mission.stop", input: { deviceId: "device-a" } },
      { method: "stream.start", input: { deviceId: "device-a" } }, { method: "stream.stop", input: { deviceId: "device-a" } }, { method: "stream.refresh", input: undefined }, { method: "stream.select", input: { deviceId: "device-a" } }, { method: "stream.clear", input: undefined },
      { method: "settings.transmission.read", input: { deviceId: "device-a" } }, { method: "settings.transmission.write", input: { deviceId: "device-a", patch: { bandwidth: "BANDWIDTH_20MHZ" } } },
      { method: "settings.camera.read", input: { deviceId: "device-a" } }, { method: "settings.camera.write", input: { deviceId: "device-a", patch: { focusMode: "AUTO" } } },
      { method: "flight.request", input: { deviceId: "device-a", action: "takeoff" } }, { method: "flight.confirm", input: { deviceId: "device-a", confirmationId: "confirm-a" } }, { method: "flight.cancel", input: { deviceId: "device-a", confirmationId: "confirm-a" } },
    ];
    for (const command of commands) await expect(gateway.invoke(command.method, command.input)).resolves.toMatchObject({ ok: true, value: { ok: true } });
    await expect(gateway.invoke("state.snapshot", undefined)).resolves.toEqual({ ok: true, value: { phase: "running", workflow: {} } });
    await expect(gateway.invoke("network.hint", undefined)).resolves.toEqual({ ok: true, value: { hints: [] } });
    await expect(gateway.invoke("video.playback", { deviceId: "device-a" })).resolves.toEqual({ ok: true, value: { deviceId: "device-a", url: "http://127.0.0.1:18080/live/stream-a.flv" } });
    await expect(gateway.invoke("video.playback", { deviceId: "device-b" })).resolves.toEqual({ ok: true, value: { ok: false, code: "VIDEO_NOT_READY" } });
    expect(calls.map((call) => call.name)).toEqual([
      "checkHardwareReadiness", "importRoute", "getRoutePreview", "selectRoute", "removeRoute", "assignRoute", "clearAssignment",
      "stage", "upload", "start", "pause", "resume", "stop", "startStream", "stopStream", "refreshMedia", "selectVideo", "clearVideo",
      "readTransmissionSettings", "writeTransmissionSettings", "readCameraSettings", "writeCameraSettings", "requestFlightAction", "confirmFlightAction", "cancelFlightAction",
    ]);

    const delivered: unknown[] = [];
    const unsubscribe = gateway.subscribe((snapshot) => { delivered.push(snapshot); });
    applicationListener?.({ endpoint: { host: "private" }, state: "changed" });
    unsubscribe();
    applicationListener?.({ state: "ignored" });
    expect(delivered).toEqual([{ state: "changed" }]);
    gateway.dispose();
    await expect(gateway.invoke("state.snapshot", undefined)).resolves.toEqual({ ok: false, code: "DISPOSED" });
  });

  it("将畸形输入、恶意 getter 和下游故障稳定映射为网关错误", async () => {
    const workflow = { snapshot: () => { throw new Error("private"); }, start: () => { throw new Error("private"); } };
    const gateway = DesktopUiGateway.create({
      application: {
        snapshot: () => { throw new Error("private"); },
        subscribe: () => { throw new Error("private"); },
        workflow: () => workflow,
      },
    });
    const hostile = Object.defineProperty({ deviceId: "device-a" }, "deviceId", { enumerable: true, get: () => { throw new Error("private"); } });

    expect(gateway.snapshot()).toEqual({ phase: "unavailable" });
    await expect(gateway.invoke("route.import", { fileName: "route.kmz", bytes: [] })).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    await expect(gateway.invoke("route.select", { routeId: "route-a", extra: true })).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    await expect(gateway.invoke("mission.start", hostile)).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    await expect(gateway.invoke("stream.refresh", null)).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    await expect(gateway.invoke("mission.start", { deviceId: "device-a" })).resolves.toEqual({ ok: false, code: "DEPENDENCY_FAILURE" });
    await expect(gateway.invoke("video.playback", { deviceId: "device-a" })).resolves.toEqual({ ok: false, code: "DEPENDENCY_FAILURE" });
  });

  it("rejects malformed inputs across every whitelist family", async () => {
    const calls: unknown[][] = [];
    const workflow = {
      snapshot: () => ({ media: { streams: [] } }),
      importRoute: async (...args: unknown[]) => { calls.push(args); return { ok: true }; },
      getRoutePreview: (...args: unknown[]) => { calls.push(args); return { ok: true }; },
      assignRoute: (...args: unknown[]) => { calls.push(args); return { ok: true }; },
      start: async (...args: unknown[]) => { calls.push(args); return { ok: true }; },
    };
    const gateway = DesktopUiGateway.create({ application: { snapshot: () => ({ phase: "idle" }), subscribe: () => () => undefined, workflow: () => workflow } });
    const invalidIds = [null, 1, "", "   ", "a\u0000b", "x".repeat(129), { value: "x" }];
    for (const id of invalidIds) {
      await expect(gateway.invoke("route.preview", { routeId: id })).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
      await expect(gateway.invoke("assignment.clear", { deviceId: id })).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
      await expect(gateway.invoke("mission.start", { deviceId: id })).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
      await expect(gateway.invoke("stream.start", { deviceId: id })).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
      await expect(gateway.invoke("settings.camera.read", { deviceId: id })).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    }
    const invalidInputs: Array<[string, unknown]> = [
      ["route.import", undefined], ["route.import", { fileName: "x.kmz", bytes: [1] }],
      ["route.import", { fileName: "", bytes: new Uint8Array() }], ["route.import", { fileName: "x.kmz", bytes: new Uint8Array(), extra: true }],
      ["route.preview", undefined], ["route.preview", { routeId: "x", extra: true }],
      ["assignment.assign", { deviceId: "a" }], ["assignment.assign", { deviceId: "a", routeId: "" }], ["assignment.assign", { deviceId: "a", routeId: "b", extra: 1 }],
      ["settings.camera.write", { deviceId: "a", patch: null }], ["settings.camera.write", { deviceId: "a", patch: [] }], ["settings.camera.write", { deviceId: "a" }],
      ["flight.request", { deviceId: "a", action: "hover" }], ["flight.request", { deviceId: "a" }], ["flight.request", { deviceId: "a", action: "takeoff", extra: 1 }],
      ["flight.confirm", { deviceId: "a", confirmationId: "" }], ["flight.cancel", { deviceId: "a", confirmationId: "x", extra: 1 }],
    ];
    for (const [method, input] of invalidInputs) await expect(gateway.invoke(method, input)).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    for (const method of ["stream.refresh", "stream.clear"] as const) {
      await expect(gateway.invoke(method, null)).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
      await expect(gateway.invoke(method, {})).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    }
    await expect(gateway.invoke(1, undefined)).resolves.toEqual({ ok: false, code: "METHOD_NOT_ALLOWED" });
    expect(calls).toEqual([]);
  });

  it("sanitizes arrays, byte arrays, functions, symbols, cycles and hostile getters", () => {
    const cyclic: Record<string, unknown> = { safe: "ok" };
    cyclic.self = cyclic;
    const hostile = Object.create(null) as Record<string, unknown>;
    hostile.array = [new Uint8Array([1, 2]), () => "secret", Symbol("secret"), cyclic];
    Object.defineProperty(hostile, "throws", { enumerable: true, get: () => { throw new Error("getter"); } });
    const gateway = DesktopUiGateway.create({ application: { snapshot: () => hostile, subscribe: () => () => undefined, workflow: () => ({}) } });
    const snapshot = gateway.snapshot() as Record<string, unknown>;
    expect(snapshot.array).toEqual([{ byteLength: 2 }, null, null, { safe: "ok", self: null }]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.throws).toBeUndefined();
  });

  it("covers every video playback validation outcome", async () => {
    const urls: Array<[unknown, "not-ready" | "dependency"]> = [[undefined, "not-ready"], ["not a url", "dependency"], ["ftp://127.0.0.1/video", "not-ready"], ["http://example.com/video", "not-ready"], ["http://user@127.0.0.1/video", "not-ready"]];
    for (const [url, expected] of urls) {
      const workflow = { snapshot: () => ({ media: { streams: [{ deviceId: "a", phase: "ready", playbackUrl: url }] } }) };
      const gateway = DesktopUiGateway.create({ application: { snapshot: () => ({}), subscribe: () => () => undefined, workflow: () => workflow } });
      const result = await gateway.invoke("video.playback", { deviceId: "a" });
      expect(result).toEqual(expected === "dependency" ? { ok: false, code: "DEPENDENCY_FAILURE" } : { ok: true, value: { ok: false, code: "VIDEO_NOT_READY" } });
    }
    const notArray = DesktopUiGateway.create({ application: { snapshot: () => ({}), subscribe: () => () => undefined, workflow: () => ({ snapshot: () => ({ media: { streams: {} } }) }) } });
    await expect(notArray.invoke("video.playback", { deviceId: "a" })).resolves.toMatchObject({ ok: true, value: { ok: false, code: "VIDEO_NOT_READY" } });
    const noSnapshot = DesktopUiGateway.create({ application: { snapshot: () => ({}), subscribe: () => () => undefined, workflow: () => ({}) } });
    await expect(noSnapshot.invoke("video.playback", { deviceId: "a" })).resolves.toEqual({ ok: false, code: "DEPENDENCY_FAILURE" });
    const throwing = DesktopUiGateway.create({ application: { snapshot: () => ({}), subscribe: () => () => undefined, workflow: () => ({ snapshot: () => { throw new Error("snapshot"); } }) } });
    await expect(throwing.invoke("video.playback", { deviceId: "a" })).resolves.toEqual({ ok: false, code: "DEPENDENCY_FAILURE" });
    const valid = DesktopUiGateway.create({ application: { snapshot: () => ({}), subscribe: () => () => undefined, workflow: () => ({ snapshot: () => ({ media: { streams: [{ deviceId: "a", phase: "ready", playbackUrl: "https://localhost:18080/video" }] } }) }) } });
    await expect(valid.invoke("video.playback", { deviceId: "a" })).resolves.toMatchObject({ ok: true, value: { deviceId: "a" } });
  });

  it("isolates dependency, observer and lifecycle failures", async () => {
    const workflow = { start: () => { throw new Error("operation"); } };
    const gateway = DesktopUiGateway.create({ application: { snapshot: () => { throw new Error("snapshot"); }, subscribe: () => { throw new Error("subscribe"); }, workflow: () => workflow } });
    await expect(gateway.invoke("mission.start", { deviceId: "a" })).resolves.toEqual({ ok: false, code: "DEPENDENCY_FAILURE" });
    const unsubscribe = gateway.subscribe(() => { throw new Error("observer"); });
    unsubscribe();
    gateway.dispose();
    gateway.dispose();
    expect(gateway.snapshot()).toEqual({ phase: "disposed" });
    expect(gateway.subscribe(() => undefined)).toEqual(expect.any(Function));
    await expect(gateway.invoke("state.snapshot", undefined)).resolves.toEqual({ ok: false, code: "DISPOSED" });
  });

  it("covers null workflow targets, missing operations and undefined subscription snapshots", async () => {
    let appListener: ((value: unknown) => void) | undefined;
    const gateway = DesktopUiGateway.create({ application: {
      snapshot: () => ({ phase: "idle" }),
      subscribe: (listener) => { appListener = listener; return () => undefined; },
      workflow: () => null as never,
    } });
    await expect(gateway.invoke("state.snapshot", null)).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    await expect(gateway.invoke("network.hint", { extra: true })).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    await expect(gateway.invoke("video.playback", { deviceId: "a" })).resolves.toEqual({ ok: false, code: "DEPENDENCY_FAILURE" });
    await expect(gateway.invoke("video.playback", null)).resolves.toEqual({ ok: false, code: "INVALID_INPUT" });
    await expect(gateway.invoke("mission.upload", { deviceId: "a" })).resolves.toEqual({ ok: false, code: "DEPENDENCY_FAILURE" });
    appListener?.(undefined);
    const noOp = gateway.subscribe(() => undefined);
    noOp();
    noOp();
    gateway.dispose();
    const disposedNoOp = gateway.subscribe(() => undefined);
    disposedNoOp();
  });

  it("contains unsubscribe failures during disposal", () => {
    const gateway = DesktopUiGateway.create({ application: {
      snapshot: () => ({}),
      subscribe: () => () => { throw new Error("unsubscribe"); },
      workflow: () => ({}),
    } });
    expect(() => gateway.dispose()).not.toThrow();
  });

  it("supports cancelling gateway subscriptions while isolating application callbacks", () => {
    let appListener: ((value: unknown) => void) | undefined;
    const gateway = DesktopUiGateway.create({ application: { snapshot: () => ({}), subscribe: (listener) => { appListener = listener; return () => undefined; }, workflow: () => ({}) } });
    const received: unknown[] = [];
    const first = gateway.subscribe(() => { throw new Error("observer"); });
    const second = gateway.subscribe((value) => received.push(value));
    appListener?.({ state: "first" });
    first();
    second();
    appListener?.({ state: "ignored" });
    expect(received).toEqual([{ state: "first" }]);
  });

  it("network.hint 只返回当前局域网 Relay 地址，失败时不泄露内部异常", async () => {
    const application = { snapshot: () => ({}), subscribe: () => () => undefined, workflow: () => ({}) };
    const live = DesktopUiGateway.create({
      application,
      relayHint: () => ["ws://192.168.1.8:8080/relay", "not-a-url", "ws://10.0.0.2:8080/relay", 7],
    });
    await expect(live.invoke("network.hint", undefined)).resolves.toEqual({
      ok: true,
      value: { hints: ["ws://192.168.1.8:8080/relay", "ws://10.0.0.2:8080/relay"] },
    });

    const broken = DesktopUiGateway.create({
      application,
      relayHint: () => { throw new Error("private adapter"); },
    });
    await expect(broken.invoke("network.hint", undefined)).resolves.toEqual({ ok: false, code: "DEPENDENCY_FAILURE" });

    const malformed = DesktopUiGateway.create({
      application,
      relayHint: () => "ws://192.168.1.8:8080/relay",
    });
    await expect(malformed.invoke("network.hint", undefined)).resolves.toEqual({ ok: true, value: { hints: [] } });
  });

  it("拒绝已封存旁路的方法，且不会调用工作流", async () => {
    const gateway = DesktopUiGateway.create({
      application: { snapshot: () => ({ phase: "running" }), subscribe: () => () => undefined, workflow: () => ({}) },
    });
    await expect(gateway.invoke("webrtc.start", undefined)).resolves.toEqual({ ok: false, code: "METHOD_NOT_ALLOWED" });
    await expect(gateway.invoke("webrtc.stream-start", { deviceId: "phone-1" })).resolves.toEqual({ ok: false, code: "METHOD_NOT_ALLOWED" });
  });
});
