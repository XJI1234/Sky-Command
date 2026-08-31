import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";
import { RelayFrameCodec, type RelayFrame } from "../src/modules/relay-link/protocol-core/index.js";
import { RelayLink, type RelayLinkOptions, type RelayConnection, type RelayTransport, type TimerScheduler, type RelayLinkSnapshot } from "../src/modules/relay-link/index.js";

class Scheduler implements TimerScheduler {
  private next = 1;
  private timers = new Map<number, () => void>();
  setTimeout(callback: () => void, _milliseconds: number): number { const id = this.next++; this.timers.set(id, callback); return id; }
  clearTimeout(handle: unknown): void { this.timers.delete(handle as number); }
  fireAll(): void { for (const callback of [...this.timers.values()]) callback(); this.timers.clear(); }
}

class Connection implements RelayConnection {
  readonly sent: Uint8Array[] = [];
  readonly closed = { value: false };
  failSends = false;
  readonly localAddress?: string;
  private messages = new Set<(bytes: Uint8Array) => void>();
  private closes = new Set<(reason?: string) => void>();
  private errors = new Set<() => void>();
  constructor(localAddress?: string) { this.localAddress = localAddress; }
  async send(bytes: Uint8Array): Promise<void> { if (this.failSends) throw new Error("send failed"); this.sent.push(bytes.slice()); }
  async close(): Promise<void> { this.closed.value = true; }
  onMessage(listener: (bytes: Uint8Array) => void): () => void { this.messages.add(listener); return () => this.messages.delete(listener); }
  onClose(listener: (reason?: string) => void): () => void { this.closes.add(listener); return () => this.closes.delete(listener); }
  onError(listener: () => void): () => void { this.errors.add(listener); return () => this.errors.delete(listener); }
  emit(frame: RelayFrame): void { const encoded = RelayFrameCodec.encode(frame); if (!encoded.ok) throw new Error("fixture"); for (const listener of [...this.messages]) listener(encoded.value); }
  emitClose(reason?: string): void { for (const listener of [...this.closes]) listener(reason); }
  emitError(): void { for (const listener of [...this.errors]) listener(); }
}

class Transport implements RelayTransport {
  readonly connections: Connection[] = [];
  failListen = false;
  private accept: ((connection: RelayConnection) => void) | null = null;
  async listen(_address: { host: string; port: number }, accept: (connection: RelayConnection) => void): Promise<{ close(): Promise<void> }> {
    if (this.failListen) throw new Error("listen failed");
    this.accept = accept;
    return { close: async () => undefined };
  }
  connect(localAddress?: string): Connection { const connection = new Connection(localAddress); this.connections.push(connection); this.accept?.(connection); return connection; }
}

const object = (fields: Record<string, unknown>) => ({ kind: "object" as const, fields });
const options = (overrides: Partial<RelayLinkOptions> = {}): { options: RelayLinkOptions; transport: Transport; scheduler: Scheduler } => {
  const transport = new Transport(); const scheduler = new Scheduler(); let command = 0; let connection = 0;
  return { transport, scheduler, options: {
    address: { host: "127.0.0.1", port: 9000 }, transport, scheduler, handshakeTimeoutMs: 100, maxConnections: 4,
    commandTimeoutMs: 100, missionTimeoutMs: 100,
    createConnectionId: () => `connection-${++connection}`, createSessionId: (deviceId) => `session-${deviceId}`,
    createCommandId: () => `command-${++command}`, ...overrides
  } };
};
const payload = { missionId: "mission-1", fileName: "route.kmz", bytes: new Uint8Array([1, 2, 3]), size: 3, sha256: Buffer.from(sha256(new Uint8Array([1, 2, 3]))).toString("hex") };
const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe("relay-link root contract", () => {
  it("starts, pairs devices, maps telemetry, and publishes detached snapshots", async () => {
    const fixture = options(); const link = RelayLink.create(fixture.options); const snapshots: unknown[] = [];
    link.subscribe((snapshot) => snapshots.push(snapshot));
    expect(await link.start()).toMatchObject({ ok: true, value: { state: "listening" } });
    const phone = fixture.transport.connect(); phone.emit({ type: "hello", deviceId: "phone-1", protocolVersion: "1" }); await flush();
    expect(link.devices()).toMatchObject([{ deviceId: "phone-1", sessionId: "session-phone-1" }]);
    expect(link.latestTelemetry("phone-1")).toBeNull(); expect(link.latestTelemetry(" ")).toBeNull();
    phone.emit({ type: "telemetry", payload: object({ battery: { kind: "number", value: "98" } }), capabilities: object({ live: { kind: "boolean", value: true } }) }); await flush();
    expect(link.latestTelemetry("phone-1")).toMatchObject({ deviceId: "phone-1", sessionId: "session-phone-1", payload: { fields: { battery: { value: "98" } } } });
    expect(snapshots.length).toBeGreaterThan(1);
    expect(Object.isFrozen(link.devices())).toBe(true);
  });

  it("projects the desktop receipt time with telemetry without trusting a phone clock", async () => {
    let now = 1_725_000_000_000;
    const fixture = options({ now: () => now } as never);
    const link = RelayLink.create(fixture.options);
    await link.start();
    const phone = fixture.transport.connect();
    phone.emit({ type: "hello", deviceId: "phone-1", protocolVersion: "1" });
    await flush();

    phone.emit({ type: "telemetry", payload: object({}), capabilities: object({}) });
    await flush();
    expect(link.latestTelemetry("phone-1")).toMatchObject({ receivedAtMs: 1_725_000_000_000 });
    now += 800;
    phone.emit({ type: "telemetry", payload: object({}), capabilities: object({}) });
    await flush();
    expect(link.latestTelemetry("phone-1")).toMatchObject({ receivedAtMs: 1_725_000_000_800 });
  });

  it("keeps each paired device's relay ingress address private to the command path", async () => {
    const fixture = options();
    const link = RelayLink.create(fixture.options);
    await link.start();
    const phone = fixture.transport.connect("172.20.10.12");
    phone.emit({ type: "hello", deviceId: "phone-1", protocolVersion: "1" });
    await flush();

    expect(link.ingressAddress("phone-1")).toBe("172.20.10.12");
    expect(JSON.stringify(link.devices())).not.toContain("172.20.10.12");
    phone.emitClose("lost");
    await flush();
    expect(link.ingressAddress("phone-1")).toBeNull();
  });

  it("routes command and mission results and never treats transfer completion as success", async () => {
    const fixture = options(); const link = RelayLink.create(fixture.options); await link.start();
    const phone = fixture.transport.connect(); phone.emit({ type: "hello", deviceId: "phone-1", protocolVersion: "1" }); await flush();
    const command = link.sendCommand("phone-1", { name: "camera.start", fields: {} }); await flush();
    phone.emit({ type: "command-result", id: "command-1", ok: true, detail: "accepted" });
    await expect(command).resolves.toMatchObject({ deviceId: "phone-1", commandId: "command-1", status: "succeeded" });
    const mission = link.sendMission("phone-1", payload); for (let index = 0; index < 20; index += 1) await flush();
    expect(phone.sent.map((bytes) => RelayFrameCodec.decode(bytes)).filter((result) => result.kind === "decoded").map((result) => result.frame.type)).toContain("mission-complete");
    phone.emit({ type: "mission-result", id: "mission-1", ok: true, detail: "uploaded" });
    await expect(mission).resolves.toMatchObject({ deviceId: "phone-1", missionId: "mission-1", status: "succeeded" });
  });

  it("把手机端命令的结构化结果交给原始命令调用者", async () => {
    const fixture = options();
    const link = RelayLink.create(fixture.options);
    await link.start();
    const phone = fixture.transport.connect();
    phone.emit({ type: "hello", deviceId: "phone-1", protocolVersion: "1" });
    await flush();
    const command = link.sendCommand("phone-1", { name: "device.settings.camera.read", fields: {} });
    await flush();
    phone.emit({ type: "command-result", id: "command-1", ok: true, detail: "Settings confirmed", result: object({ domain: { kind: "string", value: "camera" }, settings: object({ autoExposureLockEnabled: { kind: "boolean", value: true }, focusMode: { kind: "string", value: "AF" }, cameraIndex: { kind: "string", value: "LEFT_OR_MAIN" } }) }) });
    await expect(command).resolves.toMatchObject({ status: "succeeded", result: { kind: "object", fields: { domain: { value: "camera" } } } });
  });

  it("rejects absent or invalid requests without sending frames", async () => {
    const fixture = options(); const link = RelayLink.create(fixture.options);
    await expect(link.sendCommand("missing", { name: "go", fields: {} })).resolves.toMatchObject({ status: "rejected" });
    await expect(link.sendMission("missing", payload)).resolves.toMatchObject({ status: "rejected" });
    await expect(link.sendMission("missing", null as never)).resolves.toMatchObject({ status: "rejected", missionId: "invalid" });
    await link.start(); const phone = fixture.transport.connect(); phone.emit({ type: "hello", deviceId: "phone-1", protocolVersion: "1" }); await flush();
    const before = phone.sent.length;
    await expect(link.sendCommand(" ", { name: "go", fields: {} })).resolves.toMatchObject({ status: "rejected" });
    await expect(link.sendMission(" ", null as never)).resolves.toMatchObject({ status: "rejected" });
    await expect(link.sendMission(" ", payload)).resolves.toMatchObject({ status: "rejected", missionId: "mission-1" });
    await expect(link.sendCommand("phone-1", { name: "", fields: {} })).resolves.toMatchObject({ status: "rejected" });
    await expect(link.sendMission("phone-1", { ...payload, fileName: "../route.kmz" })).resolves.toMatchObject({ status: "rejected" });
    expect(phone.sent).toHaveLength(before);
  });

  it("replaces a live session for the same deviceId and disconnects the old connection's pending command", async () => {
    const fixture = options({
      createSessionId: ((count) => (deviceId: string) => `session-${deviceId}-${++count}`)(0)
    });
    const link = RelayLink.create(fixture.options);
    await link.start();
    const first = fixture.transport.connect();
    first.emit({ type: "hello", deviceId: "phone-1", protocolVersion: "1" });
    await flush();
    const command = link.sendCommand("phone-1", { name: "go", fields: {} });
    await flush();
    const replacement = fixture.transport.connect();
    replacement.emit({ type: "hello", deviceId: "phone-1", protocolVersion: "1" });
    await flush();
    await expect(command).resolves.toMatchObject({ status: "disconnected", detail: "session-replaced" });
    expect(first.closed.value).toBe(true);
    expect(link.devices()).toEqual([{ deviceId: "phone-1", sessionId: "session-phone-1-2" }]);
    const next = link.sendCommand("phone-1", { name: "go", fields: {} });
    await flush();
    replacement.emit({ type: "command-result", id: "command-2", ok: true, detail: "accepted" });
    await expect(next).resolves.toMatchObject({ status: "succeeded", commandId: "command-2" });
  });

  it("cancels pending operations and removes devices on disconnect", async () => {
    const fixture = options(); const link = RelayLink.create(fixture.options); await link.start();
    const phone = fixture.transport.connect(); phone.emit({ type: "hello", deviceId: "phone-1", protocolVersion: "1" }); await flush();
    const command = link.sendCommand("phone-1", { name: "go", fields: {} }); const mission = link.sendMission("phone-1", payload); await flush();
    phone.emitClose("lost"); await flush();
    await expect(command).resolves.toMatchObject({ status: "disconnected", detail: "lost" });
    await expect(mission).resolves.toMatchObject({ status: "disconnected", detail: "lost" });
    expect(link.devices()).toEqual([]); expect(link.latestTelemetry("phone-1")).toBeNull();
  });

  it("times out operations, contains listeners, and supports idempotent stop", async () => {
    const fixture = options(); const link = RelayLink.create(fixture.options); link.subscribe(() => { throw new Error("listener"); });
    const unsubscribe = link.subscribe(() => undefined); unsubscribe(); unsubscribe();
    await link.start(); const phone = fixture.transport.connect(); phone.emit({ type: "hello", deviceId: "phone-1", protocolVersion: "1" }); await flush();
    const command = link.sendCommand("phone-1", { name: "go", fields: {} }); const mission = link.sendMission("phone-1", payload); await flush(); fixture.scheduler.fireAll(); await flush();
    await expect(command).resolves.toMatchObject({ status: "timed-out" }); await expect(mission).resolves.toMatchObject({ status: "timed-out" });
    await link.stop(); await link.stop(); expect((await link.start()).ok).toBe(true); await link.stop();
  });

  it("covers lifecycle and command transport failures without leaking adapter details", async () => {
    const failed = options(); failed.transport.failListen = true;
    expect((await RelayLink.create(failed.options).start()).ok).toBe(false);
    const fixture = options({ createCommandId: () => { throw new Error("secret"); } }); const link = RelayLink.create(fixture.options);
    await link.start(); const phone = fixture.transport.connect(); phone.emit({ type: "hello", deviceId: "phone-1", protocolVersion: "1" }); await flush();
    await expect(link.sendCommand("phone-1", { name: "go", fields: {} })).resolves.toMatchObject({ status: "rejected", commandId: "invalid" });
    const hostileFixture = options(); const hostileLink = RelayLink.create(hostileFixture.options); await hostileLink.start(); const hostilePhone = hostileFixture.transport.connect(); hostilePhone.emit({ type: "hello", deviceId: "phone-2", protocolVersion: "1" }); await flush();
    await expect(hostileLink.sendCommand("phone-2", new Proxy({ name: "go", fields: {} }, { get() { throw new Error("secret"); } }) as never)).resolves.toMatchObject({ status: "rejected" });
    phone.emit({ type: "command-result", id: "missing", ok: true, detail: "late" }); phone.emit({ type: "mission-result", id: "missing", ok: true, detail: "late" }); await flush();
  });

  it("rejects duplicate generated command IDs and reports a failed send", async () => {
    const fixture = options({ createCommandId: () => "same-command" }); const link = RelayLink.create(fixture.options); await link.start();
    const phone = fixture.transport.connect(); phone.emit({ type: "hello", deviceId: "phone-1", protocolVersion: "1" }); await flush();
    const first = link.sendCommand("phone-1", { name: "go", fields: {} }); await flush();
    await expect(link.sendCommand("phone-1", { name: "go", fields: {} })).resolves.toMatchObject({ status: "rejected" });
    phone.emit({ type: "command-result", id: "same-command", ok: true, detail: "done" }); await expect(first).resolves.toMatchObject({ status: "succeeded" });
    phone.failSends = true;
    await expect(link.sendCommand("phone-1", { name: "go", fields: {} })).resolves.toMatchObject({ status: "disconnected" });
  });

  it("send-failed 立即结束等待中的任务，不得伪装成功，也不等到超时", async () => {
    const fixture = options();
    const link = RelayLink.create(fixture.options);
    await link.start();
    const phone = fixture.transport.connect();
    phone.emit({ type: "hello", deviceId: "phone-1", protocolVersion: "1" });
    await flush();
    const mission = link.sendMission("phone-1", payload);
    for (let index = 0; index < 20; index += 1) await flush();
    expect(phone.sent.map((bytes) => RelayFrameCodec.decode(bytes)).filter((result) => result.kind === "decoded").map((result) => result.frame.type)).toContain("mission-complete");
    phone.failSends = true;
    await expect(link.sendCommand("phone-1", { name: "telemetry.read", fields: {} })).resolves.toMatchObject({ status: "disconnected" });
    await expect(mission).resolves.toMatchObject({ status: "disconnected", detail: "send-failed" });
    expect(link.devices()).toEqual([]);
  });

  it("exposes pending identities while telemetry arrives and handles mission transport failure", async () => {
    const fixture = options(); const link = RelayLink.create(fixture.options); const snapshots: RelayLinkSnapshot[] = []; link.subscribe((value) => snapshots.push(value)); await link.start();
    const phone = fixture.transport.connect(); phone.emit({ type: "hello", deviceId: "phone-1", protocolVersion: "1" }); await flush();
    const command = link.sendCommand("phone-1", { name: "go", fields: {} }); const mission = link.sendMission("phone-1", payload); await flush();
    phone.emit({ type: "telemetry", payload: object({}), capabilities: object({}) }); await flush();
    expect(snapshots.some((value) => value.pendingCommands.length === 1)).toBe(true);
    expect(snapshots.some((value) => value.pendingMissions.length === 1)).toBe(true);
    phone.failSends = true; phone.emitClose("lost"); await flush();
    await expect(command).resolves.toMatchObject({ status: "disconnected" }); await expect(mission).resolves.toMatchObject({ status: "disconnected" });
  });

  it("contains hostile mission payload reads and reports a transport failure", async () => {
    const fixture = options(); const link = RelayLink.create(fixture.options); await link.start(); const phone = fixture.transport.connect(); phone.emit({ type: "hello", deviceId: "phone-1", protocolVersion: "1" }); await flush();
    await expect(link.sendMission("phone-1", new Proxy(payload, { get() { throw new Error("secret"); } }) as never)).resolves.toMatchObject({ status: "rejected" });
    await expect(link.sendMission("phone-1", null as never)).resolves.toMatchObject({ status: "rejected", missionId: "invalid" });
    phone.failSends = true;
    await expect(link.sendMission("phone-1", payload)).resolves.toMatchObject({ status: "disconnected", detail: "send-failed" });
  });

  it("publishes the latest mobile mission phase and clears it when its phone disconnects", async () => {
    const fixture = options();
    const link = RelayLink.create(fixture.options);
    const snapshots: RelayLinkSnapshot[] = [];
    link.subscribe((snapshot) => snapshots.push(snapshot));
    await link.start();
    const phone = fixture.transport.connect();
    phone.emit({ type: "hello", deviceId: "phone-1", protocolVersion: "1" });
    await flush();
    phone.emit({ type: "mission-phase", missionRevision: 1, deviceGeneration: 0, sequence: 1, phase: "START_POINT_REACHED", fileName: "survey.kmz" });
    await flush();
    expect(snapshots.at(-1)).toMatchObject({
      missionPhases: [{ deviceId: "phone-1", missionRevision: 1, sequence: 1, phase: "START_POINT_REACHED", fileName: "survey.kmz" }]
    });
    const publishedBeforeStalePhase = snapshots.length;
    phone.emit({ type: "mission-phase", missionRevision: 1, deviceGeneration: 0, sequence: 1, phase: "START_POINT_REACHED", fileName: "survey.kmz" });
    await flush();
    expect(snapshots).toHaveLength(publishedBeforeStalePhase);
    phone.emitClose("lost");
    await flush();
    expect(snapshots.at(-1)).toMatchObject({ missionPhases: [] });
  });

  it("persists each mobile diagnostic batch before acknowledging its final sequence", async () => {
    const fixture = options();
    const persisted: unknown[] = [];
    (fixture.options as { diagnosticSink?: { persist(input: unknown): boolean } }).diagnosticSink = {
      persist: (input) => { persisted.push(input); return true; }
    };
    const link = RelayLink.create(fixture.options);
    await link.start();
    const phone = fixture.transport.connect();
    phone.emit({ type: "hello", deviceId: "phone-1", protocolVersion: "1" });
    await flush();

    phone.emit({
      type: "diagnostic-report",
      runId: "run-1",
      events: [{ sequence: 1, timestampMillis: 1, level: "ERROR", module: "device-connection", eventCode: "SDK_FAILURE", operationId: "start-1", safeDetail: "registration failed" }]
    });
    await flush();

    expect(persisted).toEqual([{ deviceId: "phone-1", runId: "run-1", events: [{ sequence: 1, timestampMillis: 1, level: "ERROR", module: "device-connection", eventCode: "SDK_FAILURE", operationId: "start-1", safeDetail: "registration failed" }] }]);
    const acknowledgements = phone.sent
      .map((bytes) => RelayFrameCodec.decode(bytes))
      .filter((result): result is Extract<typeof result, { kind: "decoded" }> => result.kind === "decoded")
      .map((result) => result.frame)
      .filter((frame) => frame.type === "diagnostic-ack");
    expect(acknowledgements).toEqual([{ type: "diagnostic-ack", runId: "run-1", acknowledgedSequence: 1 }]);
  });

  it("在日志未落盘时不确认，在重复上报时不重复写入", async () => {
    const fixture = options();
    const calls: unknown[] = [];
    let attempt = 0;
    (fixture.options as { diagnosticSink?: { persist(input: unknown): boolean } }).diagnosticSink = {
      persist: (input) => {
        calls.push(input);
        attempt += 1;
        if (attempt === 1) return false;
        if (attempt === 2) throw new Error("disk unavailable");
        return true;
      },
    };
    const link = RelayLink.create(fixture.options);
    await link.start();
    const phone = fixture.transport.connect();
    phone.emit({ type: "hello", deviceId: "phone-1", protocolVersion: "1" });
    await flush();
    const report = { type: "diagnostic-report" as const, runId: "run-1", events: [{ sequence: 1, timestampMillis: 1, level: "INFO" as const, module: "relay-gateway", eventCode: "STARTED", operationId: null, safeDetail: "connected" }] };

    phone.emit(report);
    await flush();
    phone.emit(report);
    await flush();
    expect(phone.sent.filter((bytes) => {
      const decoded = RelayFrameCodec.decode(bytes);
      return decoded.kind === "decoded" && decoded.frame.type === "diagnostic-ack";
    })).toHaveLength(0);

    phone.emit(report);
    await flush();
    phone.emit(report);
    await flush();
    expect(calls).toHaveLength(3);
    const acknowledgements = phone.sent
      .map((bytes) => RelayFrameCodec.decode(bytes))
      .filter((result): result is Extract<typeof result, { kind: "decoded" }> => result.kind === "decoded")
      .map((result) => result.frame)
      .filter((frame) => frame.type === "diagnostic-ack");
    expect(acknowledgements).toEqual([
      { type: "diagnostic-ack", runId: "run-1", acknowledgedSequence: 1 },
      { type: "diagnostic-ack", runId: "run-1", acknowledgedSequence: 1 },
    ]);
  });

  it("未配置日志存储时不确认手机日志", async () => {
    const fixture = options();
    const link = RelayLink.create(fixture.options);
    await link.start();
    const phone = fixture.transport.connect();
    phone.emit({ type: "hello", deviceId: "phone-1", protocolVersion: "1" });
    await flush();
    const sentBefore = phone.sent.length;
    phone.emit({ type: "diagnostic-report", runId: "run-1", events: [{ sequence: 1, timestampMillis: 1, level: "INFO", module: "relay-gateway", eventCode: "STARTED", operationId: null, safeDetail: "connected" }] });
    await flush();
    expect(phone.sent).toHaveLength(sentBefore);
  });

  it("限定诊断去重索引的内存上限", async () => {
    const fixture = options();
    let writes = 0;
    (fixture.options as { diagnosticSink?: { persist(input: unknown): boolean } }).diagnosticSink = { persist: () => { writes += 1; return true; } };
    const link = RelayLink.create(fixture.options);
    await link.start();
    const phone = fixture.transport.connect();
    phone.emit({ type: "hello", deviceId: "phone-1", protocolVersion: "1" });
    await flush();
    for (let sequence = 1; sequence <= 4_097; sequence += 1) {
      phone.emit({ type: "diagnostic-report", runId: "run-1", events: [{ sequence, timestampMillis: sequence, level: "INFO", module: "relay-gateway", eventCode: "STARTED", operationId: null, safeDetail: "connected" }] });
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    phone.emit({ type: "diagnostic-report", runId: "run-1", events: [{ sequence: 1, timestampMillis: 1, level: "INFO", module: "relay-gateway", eventCode: "STARTED", operationId: null, safeDetail: "connected" }] });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(writes).toBe(4_098);
  });

  it("将非法的中继入口设备标识稳定视为不存在", () => {
    const fixture = options();
    const link = RelayLink.create(fixture.options);
    expect(link.ingressAddress("")).toBeNull();
    expect(link.ingressAddress("invalid\u0000device")).toBeNull();
  });
});
