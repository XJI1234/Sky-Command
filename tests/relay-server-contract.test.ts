import { describe, expect, it } from "vitest";
import { RelayFrameCodec, type RelayFrame } from "../src/modules/relay-link/protocol-core/index.js";
import { RelayServer, type RelayConnection, type RelayTransport, type TimerScheduler } from "../src/modules/relay-link/relay-server/index.js";

const address = Object.freeze({ host: "127.0.0.1", port: 8765 });
const bytes = (frame: RelayFrame): Uint8Array => {
  const result = RelayFrameCodec.encode(frame);
  if (!result.ok) throw result.error;
  return result.value;
};
const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

class FakeConnection implements RelayConnection {
  readonly sent: Uint8Array[] = [];
  closed = false;
  private messageListeners = new Set<(bytes: Uint8Array) => void>();
  private closeListeners = new Set<(reason?: string) => void>();
  private errorListeners = new Set<() => void>();
  private pendingSends: Array<{ bytes: Uint8Array; resolve: () => void; reject: (error: unknown) => void }> = [];
  controlledSends = false;
  failSends = false;

  send(bytesToSend: Uint8Array): Promise<void> {
    if (this.closed) return Promise.reject(new Error("closed"));
    if (this.failSends) return Promise.reject(new Error("send failed"));
    const copy = bytesToSend.slice();
    if (!this.controlledSends) { this.sent.push(copy); return Promise.resolve(); }
    return new Promise<void>((resolve, reject) => this.pendingSends.push({ bytes: copy, resolve, reject }));
  }

  releaseNextSend(): void {
    const pending = this.pendingSends.shift();
    if (!pending) throw new Error("no pending send");
    this.sent.push(pending.bytes);
    pending.resolve();
  }

  close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      for (const listener of this.closeListeners) listener("closed");
    }
    return Promise.resolve();
  }

  onMessage(listener: (bytes: Uint8Array) => void): () => void { this.messageListeners.add(listener); return () => this.messageListeners.delete(listener); }
  onClose(listener: (reason?: string) => void): () => void { this.closeListeners.add(listener); return () => this.closeListeners.delete(listener); }
  onError(listener: () => void): () => void { this.errorListeners.add(listener); return () => this.errorListeners.delete(listener); }
  emitMessage(value: Uint8Array): void { for (const listener of this.messageListeners) listener(value.slice()); }
  emitClose(reason?: string): void { this.closed = true; for (const listener of this.closeListeners) listener(reason); }
  emitCloseTwice(reason = "peer-closed"): void { this.closed = true; const listeners = [...this.closeListeners]; for (const listener of listeners) listener(reason); for (const listener of listeners) listener(reason); }
  emitError(): void { for (const listener of this.errorListeners) listener(); }
}

class FakeTransport implements RelayTransport {
  listenCalls = 0;
  closed = false;
  failListen = false;
  failClose = false;
  private accept: ((connection: RelayConnection) => void) | null = null;

  async listen(_address: typeof address, onConnection: (connection: RelayConnection) => void): Promise<{ close(): Promise<void> }> {
    this.listenCalls += 1;
    if (this.failListen) throw new Error("bind failed");
    this.accept = onConnection;
    return { close: async () => { this.closed = true; if (this.failClose) throw new Error("listener close failed"); } };
  }

  connect(connection = new FakeConnection()): FakeConnection {
    if (!this.accept) throw new Error("not listening");
    this.accept(connection);
    return connection;
  }
}

class DeferredTransport implements RelayTransport {
  private resolveListen: ((listener: { close(): Promise<void> }) => void) | null = null;
  closed = false;
  listen(_address: typeof address, _onConnection: (connection: RelayConnection) => void): Promise<{ close(): Promise<void> }> {
    return new Promise((resolve) => { this.resolveListen = resolve; });
  }
  release(): void { this.resolveListen?.({ close: async () => { this.closed = true; } }); }
}

class FakeScheduler implements TimerScheduler {
  private nextId = 1;
  private timers = new Map<number, () => void>();
  setTimeout(callback: () => void, _milliseconds: number): number { const id = this.nextId++; this.timers.set(id, callback); return id; }
  clearTimeout(handle: number): void { this.timers.delete(handle); }
  fireAll(): void { for (const callback of [...this.timers.values()]) callback(); this.timers.clear(); }
}

function createServer(overrides: Partial<{ transport: RelayTransport; scheduler: TimerScheduler; maxConnections: number; createSessionId: (deviceId: string) => string }> = {}) {
  let connectionNumber = 0;
  let sessionNumber = 0;
  return RelayServer.create({
    address,
    transport: overrides.transport ?? new FakeTransport(),
    scheduler: overrides.scheduler ?? new FakeScheduler(),
    handshakeTimeoutMs: 10,
    maxConnections: overrides.maxConnections ?? 4,
    createConnectionId: () => `connection-${++connectionNumber}`,
    createSessionId: overrides.createSessionId ?? ((deviceId: string) => `session-${deviceId}-${++sessionNumber}`)
  });
}

describe("relay-server contract", () => {
  it("starts once, publishes state, and stops idempotently", async () => {
    const transport = new FakeTransport();
    const server = createServer({ transport });
    const events: string[] = [];
    server.subscribe((event) => { if (event.kind === "state-changed") events.push(event.snapshot.state); });
    expect(server.snapshot()).toMatchObject({ state: "stopped", endpoint: null, connections: [] });
    expect((await server.start()).ok).toBe(true);
    expect((await server.start())).toMatchObject({ ok: false, error: { code: "SERVER_ALREADY_STARTED" } });
    await server.stop();
    await server.stop();
    expect(transport.listenCalls).toBe(1);
    expect(transport.closed).toBe(true);
    expect(events).toEqual(["starting", "listening", "stopping", "stopped"]);
  });

  it("restores stopped state after a bind failure", async () => {
    const transport = new FakeTransport(); transport.failListen = true;
    const server = createServer({ transport });
    await expect(server.start()).resolves.toMatchObject({ ok: false, error: { code: "LISTEN_FAILED" } });
    expect(server.snapshot()).toMatchObject({ state: "stopped", endpoint: null, connections: [] });
  });

  it("handles a stop requested while a bind fails", async () => {
    const transport = new FakeTransport(); transport.failListen = true;
    const server = createServer({ transport });
    const starting = server.start();
    const stopping = server.stop();
    await starting;
    await stopping;
    expect(server.snapshot().state).toBe("stopped");
  });

  it("waits for an in-flight start before completing stop", async () => {
    const transport = new DeferredTransport();
    const server = createServer({ transport });
    const starting = server.start();
    const stopping = server.stop();
    transport.release();
    await starting;
    await stopping;
    expect(server.snapshot()).toMatchObject({ state: "stopped", endpoint: null, connections: [] });
    expect(transport.closed).toBe(true);
  });

  it("pairs a phone only after the first valid hello", async () => {
    const transport = new FakeTransport();
    const server = createServer({ transport });
    const events: string[] = [];
    server.subscribe((event) => events.push(event.kind));
    await server.start();
    const connection = transport.connect();
    expect(server.snapshot().connections[0]).toMatchObject({ phase: "awaiting-hello", deviceId: null });
    connection.emitMessage(bytes({ type: "hello", deviceId: "phone-1", protocolVersion: "1" }));
    await flush();
    expect(server.snapshot().connections[0]).toMatchObject({ phase: "paired", deviceId: "phone-1", sessionId: "session-phone-1-1" });
    expect(connection.sent).toHaveLength(1);
    expect(RelayFrameCodec.decode(connection.sent[0]!)).toMatchObject({ kind: "decoded", frame: { type: "paired", sessionId: "session-phone-1-1", protocolVersion: "1" } });
    expect(events).toEqual(["state-changed", "state-changed", "connection-opened", "connection-paired"]);
  });

  it("rejects a non-hello or malformed first frame and closes only that connection", async () => {
    const transport = new FakeTransport();
    const server = createServer({ transport });
    const errors: string[] = [];
    server.subscribe((event) => { if (event.kind === "protocol-error") errors.push(event.error.code); });
    await server.start();
    const connection = transport.connect();
    connection.emitMessage(bytes({ type: "telemetry", payload: { kind: "object", fields: {} }, capabilities: { kind: "object", fields: {} } }));
    await flush();
    expect(connection.closed).toBe(true);
    expect(errors).toEqual(["INVALID_MESSAGE_TYPE"]);
    expect(server.snapshot().connections).toEqual([]);
    const second = transport.connect();
    second.emitMessage(new Uint8Array([0xff]));
    await flush();
    expect(second.closed).toBe(true);
    expect(errors).toEqual(["INVALID_MESSAGE_TYPE", "INVALID_UTF8"]);
  });

  it("rejects unknown first frames and a pairing response that cannot be encoded", async () => {
    const transport = new FakeTransport();
    const unknownServer = createServer({ transport });
    await unknownServer.start();
    const unknown = transport.connect();
    unknown.emitMessage(new TextEncoder().encode('{"type":"future"}'));
    await flush();
    expect(unknown.closed).toBe(true);

    const invalidSessionTransport = new FakeTransport();
    const invalidSessionServer = createServer({ transport: invalidSessionTransport, createSessionId: () => "" });
    await invalidSessionServer.start();
    const invalidSession = invalidSessionTransport.connect();
    invalidSession.emitMessage(bytes({ type: "hello", deviceId: "phone-1", protocolVersion: "1" }));
    await flush();
    expect(invalidSession.closed).toBe(true);
  });

  it("ignores a duplicate close callback without changing state twice", async () => {
    const transport = new FakeTransport();
    const server = createServer({ transport });
    await server.start();
    const connection = transport.connect();
    connection.emitCloseTwice();
    expect(server.snapshot().connections).toEqual([]);
  });

  it("replaces a paired session when the same deviceId hellos again", async () => {
    const transport = new FakeTransport();
    const server = createServer({ transport });
    const closed: string[] = [];
    server.subscribe((event) => { if (event.kind === "connection-closed") closed.push(event.reason); });
    await server.start();
    const first = transport.connect(); first.emitMessage(bytes({ type: "hello", deviceId: "phone-1", protocolVersion: "1" })); await flush();
    const replacement = transport.connect(); replacement.emitMessage(bytes({ type: "hello", deviceId: "phone-1", protocolVersion: "1" })); await flush();
    expect(first.closed).toBe(true);
    expect(replacement.closed).toBe(false);
    expect(closed).toEqual(["session-replaced"]);
    expect(server.snapshot().connections).toEqual([
      expect.objectContaining({ phase: "paired", deviceId: "phone-1", sessionId: "session-phone-1-2" })
    ]);
    expect(RelayFrameCodec.decode(replacement.sent[0]!)).toMatchObject({
      kind: "decoded",
      frame: { type: "paired", sessionId: "session-phone-1-2", protocolVersion: "1" }
    });
  });

  it("emits paired application frames in order and rejects a second handshake", async () => {
    const transport = new FakeTransport();
    const server = createServer({ transport });
    const frames: RelayFrame[] = [];
    await server.start();
    server.subscribe((event) => { if (event.kind === "frame") frames.push(event.frame); });
    const connection = transport.connect();
    connection.emitMessage(bytes({ type: "hello", deviceId: "phone-1", protocolVersion: "1" }));
    await flush();
    connection.emitMessage(bytes({ type: "command-result", id: "command-1", ok: true, detail: "done" }));
    await flush();
    expect(frames).toMatchObject([{ type: "command-result", id: "command-1" }]);
    connection.emitMessage(bytes({ type: "hello", deviceId: "phone-1", protocolVersion: "1" }));
    await flush();
    expect(connection.closed).toBe(true);
  });

  it("ignores future frame types after pairing without closing the phone", async () => {
    const transport = new FakeTransport();
    const server = createServer({ transport });
    await server.start();
    const connection = transport.connect();
    connection.emitMessage(bytes({ type: "hello", deviceId: "phone-1", protocolVersion: "1" }));
    await flush();
    connection.emitMessage(new TextEncoder().encode('{"type":"future-v2","value":1}'));
    await flush();
    expect(connection.closed).toBe(false);
    expect(server.snapshot().connections).toHaveLength(1);
  });

  it("times out an idle handshake and respects the connection limit", async () => {
    const transport = new FakeTransport();
    const scheduler = new FakeScheduler();
    const server = createServer({ transport, scheduler, maxConnections: 1 });
    await server.start();
    const first = transport.connect();
    const rejected = transport.connect();
    expect(rejected.closed).toBe(true);
    scheduler.fireAll();
    expect(first.closed).toBe(true);
    expect(server.snapshot().connections).toEqual([]);
  });

  it("allows a paired device to reconnect when the connection limit is already full", async () => {
    const transport = new FakeTransport();
    const server = createServer({ transport, maxConnections: 1 });
    await server.start();
    const first = transport.connect();
    first.emitMessage(bytes({ type: "hello", deviceId: "phone-1", protocolVersion: "1" }));
    await flush();
    const replacement = transport.connect();
    expect(replacement.closed).toBe(false);
    replacement.emitMessage(bytes({ type: "hello", deviceId: "phone-1", protocolVersion: "1" }));
    await flush();
    expect(first.closed).toBe(true);
    expect(replacement.closed).toBe(false);
    expect(server.snapshot().connections).toEqual([
      expect.objectContaining({ phase: "paired", deviceId: "phone-1" })
    ]);
    const outsider = transport.connect();
    outsider.emitMessage(bytes({ type: "hello", deviceId: "phone-2", protocolVersion: "1" }));
    await flush();
    expect(outsider.closed).toBe(true);
    expect(server.snapshot().connections[0]).toMatchObject({ deviceId: "phone-1" });
  });

  it("ignores a stale handshake callback and inbound work queued before a peer closes", async () => {
    const callbacks: Array<() => void> = [];
    const scheduler: TimerScheduler = {
      setTimeout: (callback) => { callbacks.push(callback); return callbacks.length; },
      clearTimeout: () => undefined,
    };
    const transport = new FakeTransport();
    const server = createServer({ transport, scheduler });
    await server.start();
    const paired = transport.connect();
    paired.emitMessage(bytes({ type: "hello", deviceId: "phone-1", protocolVersion: "1" }));
    await flush();
    callbacks[0]!();
    expect(server.snapshot().connections[0]).toMatchObject({ phase: "paired" });

    const closing = transport.connect();
    closing.emitMessage(bytes({ type: "hello", deviceId: "phone-2", protocolVersion: "1" }));
    closing.emitClose("peer-closed");
    await flush();
    expect(server.snapshot().connections).toHaveLength(1);
  });

  it("closes active connections during stop and normalizes missing close reasons", async () => {
    const transport = new FakeTransport();
    const server = createServer({ transport });
    const reasons: string[] = [];
    server.subscribe((event) => { if (event.kind === "connection-closed") reasons.push(event.reason); });
    await server.start();
    const peer = transport.connect();
    peer.emitClose();
    peer.emitError();
    const active = transport.connect();
    await server.stop();
    expect(active.closed).toBe(true);
    expect(reasons).toEqual(["peer-closed", "server-stopped"]);
  });

  it("serializes sends, rejects unavailable connections, and closes on transport failure", async () => {
    const transport = new FakeTransport();
    const server = createServer({ transport });
    await server.start();
    const connection = transport.connect();
    await expect(server.send("connection-1", bytes({ type: "command", id: "x", command: { name: "go", fields: {} } }))).resolves.toMatchObject({ ok: false, error: { code: "NOT_CONNECTED" } });
    connection.emitMessage(bytes({ type: "hello", deviceId: "phone-1", protocolVersion: "1" }));
    await flush();
    connection.controlledSends = true;
    const first = server.send("connection-1", bytes({ type: "mission-complete", id: "m-1" }));
    const second = server.send("connection-1", bytes({ type: "mission-complete", id: "m-2" }));
    await flush();
    expect(connection.sent).toHaveLength(1); // paired frame is sent before controlled mode
    connection.releaseNextSend();
    await first;
    await flush();
    expect(connection.sent).toHaveLength(2);
    connection.releaseNextSend();
    await second;
    expect(connection.sent).toHaveLength(3);
    connection.emitError();
    await expect(server.send("connection-1", bytes({ type: "mission-complete", id: "m-3" }))).resolves.toMatchObject({ ok: false, error: { code: "NOT_CONNECTED" } });
    const failing = transport.connect();
    failing.emitMessage(bytes({ type: "hello", deviceId: "phone-2", protocolVersion: "1" }));
    await flush();
    failing.failSends = true;
    await expect(server.send("connection-2", bytes({ type: "mission-complete", id: "m-4" }))).resolves.toMatchObject({ ok: false, error: { code: "SEND_FAILED" } });
    expect(failing.closed).toBe(true);
  });

  it("rejects malformed outbound bytes and cancels a queued send after close", async () => {
    const transport = new FakeTransport();
    const server = createServer({ transport });
    await server.start();
    await expect(server.send("missing", new Uint8Array())).resolves.toMatchObject({ ok: false, error: { code: "INVALID_FRAME" } });
    await expect(server.send("missing", {} as never)).resolves.toMatchObject({ ok: false, error: { code: "INVALID_FRAME" } });
    const connection = transport.connect();
    connection.emitMessage(bytes({ type: "hello", deviceId: "phone-1", protocolVersion: "1" }));
    await flush();
    connection.controlledSends = true;
    const first = server.send("connection-1", bytes({ type: "mission-complete", id: "one" }));
    const second = server.send("connection-1", bytes({ type: "mission-complete", id: "two" }));
    await flush();
    connection.emitClose("peer-closed");
    connection.releaseNextSend();
    await expect(first).resolves.toMatchObject({ ok: true });
    await expect(second).resolves.toMatchObject({ ok: false, error: { code: "NOT_CONNECTED" } });
  });

  it("closes a connection when the paired response transport send fails", async () => {
    const transport = new FakeTransport();
    const server = createServer({ transport });
    await server.start();
    const connection = transport.connect();
    connection.failSends = true;
    connection.emitMessage(bytes({ type: "hello", deviceId: "phone-1", protocolVersion: "1" }));
    await flush();
    expect(connection.closed).toBe(true);
  });

  it("contains listener failures and detaches snapshots from callers", async () => {
    const transport = new FakeTransport();
    const server = createServer({ transport });
    server.subscribe(() => { throw new Error("listener failure"); });
    let callbacks = 0;
    const unsubscribe = server.subscribe(() => { callbacks += 1; });
    unsubscribe();
    unsubscribe();
    await server.start();
    const connection = transport.connect();
    connection.emitMessage(bytes({ type: "hello", deviceId: "phone-1", protocolVersion: "1" }));
    await flush();
    const snapshot = server.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.connections)).toBe(true);
    expect(() => (snapshot.connections as unknown as Array<unknown>).pop()).toThrow();
    expect(server.snapshot().connections).toHaveLength(1);
    expect(callbacks).toBe(0);
  });

  it("contains best-effort close rejections while dropping or stopping a connection", async () => {
    const transport = new FakeTransport();
    transport.failClose = true;
    const server = createServer({ transport, maxConnections: 1 });
    await server.start();
    const active = transport.connect();
    const dropped = new FakeConnection();
    dropped.close = async () => { dropped.closed = true; throw new Error("peer close failed"); };
    transport.connect(dropped);
    expect(dropped.closed).toBe(true);
    active.close = async () => { active.closed = true; throw new Error("active close failed"); };
    await expect(server.stop()).resolves.toBeUndefined();
    expect(server.snapshot()).toMatchObject({ state: "stopped", connections: [] });
  });
});
