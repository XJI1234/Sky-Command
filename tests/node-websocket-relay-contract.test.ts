import { describe, expect, it, vi } from "vitest";
import { NodeWebSocketRelayTransport, type WebSocketLike, type WebSocketServerLike } from "../src/adapters/node-websocket-relay/index.js";

type Listener = (...args: any[]) => void;

class Socket implements WebSocketLike {
  readonly OPEN = 1;
  readyState = 1;
  readonly sent: Uint8Array[] = [];
  throwOnClose = false;
  private readonly listeners = new Map<string, Set<Listener>>();
  send(value: Uint8Array, callback?: (error?: Error) => void): void { this.sent.push(value instanceof Uint8Array ? value.slice() : new Uint8Array(value as any)); callback?.(); }
  close(): void { if (this.throwOnClose) throw new Error("secret socket close"); this.readyState = 3; this.emit("close"); }
  on(event: string, listener: Listener): this { const set = this.listeners.get(event) ?? new Set(); set.add(listener); this.listeners.set(event, set); return this; }
  off(event: string, listener: Listener): this { this.listeners.get(event)?.delete(listener); return this; }
  emit(event: string, ...args: unknown[]): void { for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args); }
}

class Server implements WebSocketServerLike {
  readonly sockets: Socket[] = [];
  closeCalls = 0;
  throwOnClose = false;
  private readonly listeners = new Map<string, Set<Listener>>();
  closed = false;
  on(event: string, listener: Listener): this { const set = this.listeners.get(event) ?? new Set(); set.add(listener); this.listeners.set(event, set); return this; }
  off(event: string, listener: Listener): this { this.listeners.get(event)?.delete(listener); return this; }
  close(callback?: (error?: Error) => void): void { this.closeCalls += 1; if (this.throwOnClose) throw new Error("secret close"); this.closed = true; for (const socket of [...this.sockets]) socket.close(); callback?.(); }
  emit(event: string, ...args: unknown[]): void { for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args); }
  connect(): Socket { const socket = new Socket(); this.sockets.push(socket); this.emit("connection", socket); return socket; }
}

const create = () => { const server = new Server(); const transport = NodeWebSocketRelayTransport.create({ factory: { openState: 1, create: () => server } }); return { server, transport }; };

describe("node websocket relay adapter contract", () => {
  it("resolves listen after listening and adapts binary connections", async () => {
    const { server, transport } = create(); const connections: WebSocketLike[] = [];
    const listening = transport.listen({ host: "127.0.0.1", port: 9000 }, (connection) => connections.push(connection));
    server.emit("listening"); const listener = await listening; const socket = server.connect();
    expect(connections).toHaveLength(1);
    const received: Uint8Array[] = []; connections[0]!.onMessage((bytes) => received.push(bytes));
    const source = new Uint8Array([1, 2, 3]); socket.emit("message", source, true); source[0] = 9;
    expect(received).toEqual([new Uint8Array([1, 2, 3])]);
    const buffer = new ArrayBuffer(2); new Uint8Array(buffer).set([7, 8]); socket.emit("message", buffer, true);
    expect(received[1]).toEqual(new Uint8Array([7, 8]));
    socket.emit("message", "invalid-binary", true); expect(socket.readyState).toBe(3);
    await listener.close(); expect(server.closed).toBe(true);
  });

  it("retains the actual local IPv4 address of an incoming relay connection", async () => {
    const { server, transport } = create();
    const accepted: Array<{ readonly localAddress?: string }> = [];
    const listening = transport.listen({ host: "0.0.0.0", port: 8080 }, (connection) => accepted.push(connection));
    server.emit("listening");
    const listener = await listening;
    const socket = new Socket();
    server.sockets.push(socket);

    server.emit("connection", socket, { socket: { localAddress: "172.20.10.12" } });

    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.localAddress).toBe("172.20.10.12");
    await listener.close();
  });

  it("drops invalid or unreadable local addresses without rejecting the relay connection", async () => {
    const { server, transport } = create();
    const accepted: Array<{ readonly localAddress?: string }> = [];
    const listening = transport.listen({ host: "0.0.0.0", port: 8080 }, (connection) => accepted.push(connection));
    server.emit("listening");
    const listener = await listening;
    const loopbackSocket = new Socket();
    const unreadableSocket = new Socket();
    server.sockets.push(loopbackSocket, unreadableSocket);

    server.emit("connection", loopbackSocket, { socket: { localAddress: "127.0.0.1" } });
    server.emit("connection", unreadableSocket, { get socket(): never { throw new Error("socket unavailable"); } });

    expect(accepted).toHaveLength(2);
    expect(accepted.map((connection) => connection.localAddress)).toEqual([undefined, undefined]);
    await listener.close();
  });

  it("sends copied binary data, rejects text input, and contains listener failures", async () => {
    const { server, transport } = create(); const accepted: WebSocketLike[] = []; const listening = transport.listen({ host: "127.0.0.1", port: 9000 }, (connection) => accepted.push(connection)); server.emit("listening"); const listener = await listening; const socket = server.connect();
    const connection = accepted[0]!; const bytes = new Uint8Array([4, 5]); await connection.send(bytes); bytes[0] = 9;
    expect(socket.sent).toEqual([new Uint8Array([4, 5])]);
    socket.emit("message", "not-binary", false); expect(socket.readyState).toBe(3);
    await listener.close();
    expect(connection).toBeDefined();
  });

  it("rejects sends after the socket is no longer open", async () => {
    const { server, transport } = create();
    let connection!: WebSocketLike;
    const listening = transport.listen({ host: "127.0.0.1", port: 8 }, (value) => { connection = value; });
    server.emit("listening");
    const listener = await listening;
    const socket = server.connect();
    socket.readyState = 3;

    await expect(connection.send(new Uint8Array([1]))).rejects.toThrow("transport unavailable");
    await listener.close();
  });

  it("ignores message registration and messages after a connection has closed", async () => {
    const { server, transport } = create();
    let connection!: WebSocketLike;
    const listening = transport.listen({ host: "127.0.0.1", port: 13 }, (value) => { connection = value; });
    server.emit("listening");
    const listener = await listening;
    const socket = server.connect();
    const unsubscribeOpenMessage = connection.onMessage(() => undefined);
    const unsubscribeOpenError = connection.onError(() => undefined);
    unsubscribeOpenMessage();
    unsubscribeOpenMessage();
    unsubscribeOpenError();
    unsubscribeOpenError();

    socket.emit("close");
    const unsubscribe = connection.onMessage(() => { throw new Error("must not run"); });
    socket.emit("message", new Uint8Array([1]), true);
    unsubscribe();
    unsubscribe();
    await listener.close();
  });

  it("notifies close once and makes unsubscribe idempotent", async () => {
    const { server, transport } = create(); const accepted: WebSocketLike[] = []; const listening = transport.listen({ host: "127.0.0.1", port: 9000 }, (connection) => accepted.push(connection)); server.emit("listening"); const listener = await listening; const socket = server.connect(); const connection = accepted[0]!;
    const reasons: string[] = []; const unsubscribe = connection.onClose((reason) => reasons.push(reason ?? "")); unsubscribe(); unsubscribe(); connection.onClose((reason) => reasons.push(reason ?? ""));
    socket.emit("error", new Error("secret")); socket.emit("close"); socket.emit("close");
    expect(reasons).toEqual(["transport-error"]); await listener.close();
  });

  it("rejects a bind failure and turns a socket send failure into a rejected promise", async () => {
    const failingServer = new Server();
    const transport = NodeWebSocketRelayTransport.create({ factory: { openState: 1, create: () => { throw new Error("secret bind"); } } });
    await expect(transport.listen({ host: "127.0.0.1", port: 1 }, () => undefined)).rejects.toThrow("could not start");
    const errorBeforeListening = NodeWebSocketRelayTransport.create({ factory: { openState: 1, create: () => failingServer } });
    const failedListening = errorBeforeListening.listen({ host: "127.0.0.1", port: 2 }, () => undefined);
    failingServer.emit("error", new Error("secret bind event"));
    await expect(failedListening).rejects.toThrow("could not start");
    const normal = NodeWebSocketRelayTransport.create({ factory: { openState: 1, create: () => failingServer } });
    const listening = normal.listen({ host: "127.0.0.1", port: 3 }, () => undefined); failingServer.emit("listening"); const listener = await listening;
    failingServer.emit("error", new Error("late bind event"));
    const second = new Server(); const adapter = NodeWebSocketRelayTransport.create({ factory: { openState: 1, create: () => second } }); let connection!: WebSocketLike; const pending = adapter.listen({ host: "127.0.0.1", port: 3 }, (value) => { connection = value; }); second.emit("listening"); await pending; const secondSocket = second.connect();
    secondSocket.send = (_bytes: Uint8Array, callback?: (error?: Error) => void) => callback?.(new Error("secret send"));
    await expect(connection.send(new Uint8Array([1]))).rejects.toThrow("transport send failed");
    const third = new Server(); const thirdAdapter = NodeWebSocketRelayTransport.create({ factory: { openState: 1, create: () => third } }); let throwingConnection!: WebSocketLike; const thirdListening = thirdAdapter.listen({ host: "127.0.0.1", port: 5 }, (value) => { throwingConnection = value; }); third.emit("listening"); await thirdListening; const thirdSocket = third.connect(); thirdSocket.send = () => { throw new Error("secret"); };
    await expect(throwingConnection.send(new Uint8Array([1]))).rejects.toThrow("transport send failed");
    await listener.close();
  });

  it("contains adapter callback failures and uses the production ws factory", async () => {
    const fixture = create(); let connection!: WebSocketLike;
    const listening = fixture.transport.listen({ host: "127.0.0.1", port: 4 }, (value) => { connection = value; }); fixture.server.emit("listening"); await listening; const socket = fixture.server.connect();
    connection.onMessage(() => { throw new Error("message"); }); socket.emit("message", new Uint8Array([1]), true);
    connection.onClose(() => { throw new Error("close"); }); connection.onError(() => { throw new Error("error"); }); socket.emit("error", new Error("transport")); socket.emit("close");
    await (await listening).close();

    const rejected = create();
    const rejectedListening = rejected.transport.listen({ host: "127.0.0.1", port: 9 }, () => { throw new Error("caller"); });
    rejected.server.emit("listening");
    await expect(rejectedListening).resolves.toBeDefined();
    const production = NodeWebSocketRelayTransport.create(); const realListener = await production.listen({ host: "127.0.0.1", port: 0 }, () => undefined); await realListener.close();
  });

  it("isolates close listener failures on an active connection", async () => {
    const { server, transport } = create();
    let connection!: WebSocketLike;
    const listening = transport.listen({ host: "127.0.0.1", port: 10 }, (value) => { connection = value; });
    server.emit("listening");
    const listener = await listening;
    const socket = server.connect();
    let closeCalls = 0;
    connection.onClose(() => { closeCalls += 1; throw new Error("caller close"); });

    socket.emit("close");
    socket.emit("close");

    expect(closeCalls).toBe(1);
    await listener.close();
  });

  it("contains an onConnection failure and a socket close failure", async () => {
    const { server, transport } = create();
    const listening = transport.listen({ host: "127.0.0.1", port: 14 }, () => { throw new Error("caller connection"); });
    server.emit("listening");
    const listener = await listening;
    const socket = server.connect();

    expect(socket.readyState).toBe(3);
    await listener.close();

    const closeFixture = create();
    let connection!: WebSocketLike;
    const closeListening = closeFixture.transport.listen({ host: "127.0.0.1", port: 15 }, (value) => { connection = value; });
    closeFixture.server.emit("listening");
    const closeListener = await closeListening;
    const closeSocket = closeFixture.server.connect();
    (closeSocket as Socket).throwOnClose = true;

    await connection.close();
    expect(closeSocket.readyState).toBe(1);
    await closeListener.close();
  });

  it("closes active connections when the listener stops", async () => {
    const { server, transport } = create();
    let connection!: WebSocketLike;
    const listening = transport.listen({ host: "127.0.0.1", port: 11 }, (value) => { connection = value; });
    server.emit("listening");
    const listener = await listening;
    const socket = server.connect();
    const reasons: string[] = [];
    connection.onClose((reason) => reasons.push(reason ?? ""));

    await listener.close();

    expect(socket.readyState).toBe(3);
    expect(reasons).toEqual(["server-closed"]);
  });

  it("makes a connection close operation idempotent", async () => {
    const { server, transport } = create();
    let connection!: WebSocketLike;
    const listening = transport.listen({ host: "127.0.0.1", port: 12 }, (value) => { connection = value; });
    server.emit("listening");
    const listener = await listening;
    const socket = server.connect();
    const reasons: string[] = [];
    connection.onClose((reason) => reasons.push(reason ?? ""));

    await connection.close();
    await connection.close();

    expect(socket.readyState).toBe(3);
    expect(reasons).toEqual(["peer-closed"]);
    await listener.close();
  });

  it("closes the underlying server at most once when close is called repeatedly", async () => {
    const { server, transport } = create();
    const listening = transport.listen({ host: "127.0.0.1", port: 6 }, () => undefined);
    server.emit("listening");
    const listener = await listening;

    await Promise.all([listener.close(), listener.close(), listener.close()]);

    expect(server.closeCalls).toBe(1);
  });

  it("resolves close even when the underlying server throws synchronously", async () => {
    const server = new Server();
    server.throwOnClose = true;
    const transport = NodeWebSocketRelayTransport.create({ factory: { openState: 1, create: () => server } });
    const listening = transport.listen({ host: "127.0.0.1", port: 7 }, () => undefined);
    server.emit("listening");
    const listener = await listening;

    await expect(listener.close()).resolves.toBeUndefined();
    expect(server.closeCalls).toBe(1);
  });

  it("生产 WebSocket 服务器只接受 /relay 路径", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../src/adapters/node-websocket-relay/index.ts", import.meta.url), "utf8");
    expect(source).toContain("path: \"/relay\"");
  });

  it("paired sockets that miss a pong are closed as peer-closed", async () => {
    class PingSocket extends Socket {
      pings = 0;
      ping(): void { this.pings += 1; }
    }
    const timers: Array<() => void> = [];
    const server = new Server();
    const transport = NodeWebSocketRelayTransport.create({
      factory: { openState: 1, create: () => server },
      pingIntervalMs: 15_000,
      scheduler: {
        setInterval: (callback: () => void) => { timers.push(callback); return timers.length; },
        clearInterval: () => undefined,
      },
    });
    const reasons: string[] = [];
    const listening = transport.listen({ host: "127.0.0.1", port: 15 }, (connection) => {
      connection.onClose((reason) => { reasons.push(reason ?? ""); });
    });
    server.emit("listening");
    const listener = await listening;
    const socket = new PingSocket();
    server.sockets.push(socket);
    server.emit("connection", socket);
    expect(timers).toHaveLength(1);
    timers[0]!();
    expect(socket.pings).toBe(1);
    expect(socket.readyState).toBe(1);
    timers[0]!();
    expect(socket.readyState).toBe(3);
    expect(reasons).toEqual(["peer-closed"]);
    await listener.close();
  });

  it("closes only a paired socket whose keepalive ping throws", async () => {
    class ThrowingPingSocket extends Socket {
      ping(): void { throw new Error("ping unavailable"); }
    }
    const timers: Array<() => void> = [];
    const server = new Server();
    const transport = NodeWebSocketRelayTransport.create({
      factory: { openState: 1, create: () => server },
      pingIntervalMs: 1,
      scheduler: {
        setInterval: (callback: () => void) => { timers.push(callback); return timers.length; },
        clearInterval: () => undefined,
      },
    });
    const reasons: string[] = [];
    const listening = transport.listen({ host: "127.0.0.1", port: 18 }, (connection) => {
      connection.onClose((reason) => reasons.push(reason ?? ""));
    });
    server.emit("listening");
    const listener = await listening;
    const socket = new ThrowingPingSocket();
    server.sockets.push(socket);
    server.emit("connection", socket);

    timers[0]!();

    expect(socket.readyState).toBe(3);
    expect(reasons).toEqual(["transport-error"]);
    await listener.close();
  });

  it("clears keepalive timers, accepts pongs, and handles both supported timer handle shapes", async () => {
    class PingSocket extends Socket {
      pings = 0;
      ping(): void { this.pings += 1; }
    }
    const timers: Array<() => void> = [];
    const cleared: unknown[] = [];
    const server = new Server();
    const transport = NodeWebSocketRelayTransport.create({
      factory: { openState: 1, create: () => server },
      pingIntervalMs: 1,
      scheduler: {
        setInterval: (callback: () => void) => { timers.push(callback); return timers.length; },
        clearInterval: (handle: unknown) => { cleared.push(handle); },
      },
    });
    const listening = transport.listen({ host: "127.0.0.1", port: 16 }, () => undefined);
    server.emit("listening");
    const listener = await listening;
    const socket = new PingSocket();
    server.sockets.push(socket);
    server.emit("connection", socket);

    timers[0]!();
    socket.emit("pong");
    timers[0]!();
    expect(socket.pings).toBe(2);
    socket.close();
    timers[0]!();
    expect(cleared).toEqual([1]);
    await listener.close();

    const numericServer = new Server();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval").mockReturnValue(1 as unknown as NodeJS.Timeout);
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => undefined);
    try {
      const numericTransport = NodeWebSocketRelayTransport.create({ factory: { openState: 1, create: () => numericServer } });
      const numericListening = numericTransport.listen({ host: "127.0.0.1", port: 17 }, () => undefined);
      numericServer.emit("listening");
      const numericListener = await numericListening;
      const numericSocket = new PingSocket();
      numericServer.sockets.push(numericSocket);
      numericServer.emit("connection", numericSocket);
      numericSocket.close();
      expect(clearIntervalSpy).toHaveBeenCalledWith(1);
      await numericListener.close();
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });
});
