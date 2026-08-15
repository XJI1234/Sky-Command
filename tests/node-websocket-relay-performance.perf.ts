import { expect, it } from "vitest";
import { NodeWebSocketRelayTransport, type WebSocketLike, type WebSocketServerLike } from "../src/adapters/node-websocket-relay/index.js";

type Listener = (...args: any[]) => void;

class Socket implements WebSocketLike {
  readonly OPEN = 1;
  readyState = 1;
  private readonly listeners = new Map<string, Set<Listener>>();
  readonly sent: Uint8Array[] = [];

  send(value: Uint8Array, callback?: (error?: Error) => void): void {
    this.sent.push(value.slice());
    callback?.();
  }

  close(): void {
    this.readyState = 3;
    this.emit("close");
  }

  on(event: string, listener: Listener): this {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }
}

class Server implements WebSocketServerLike {
  private readonly listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener): this {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  close(callback?: (error?: Error) => void): void {
    callback?.();
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }

  connect(): Socket {
    const socket = new Socket();
    this.emit("connection", socket);
    return socket;
  }
}

it("node websocket relay handles high-rate binary traffic within the relay budget", async () => {
  const server = new Server();
  const transport = NodeWebSocketRelayTransport.create({ factory: { openState: 1, create: () => server } });
  let connection!: WebSocketLike;
  const listening = transport.listen({ host: "127.0.0.1", port: 0 }, (value) => { connection = value; });
  server.emit("listening");
  const listener = await listening;
  const socket = server.connect();
  let received = 0;
  connection.onMessage(() => { received += 1; });
  const frame = new Uint8Array([1, 2, 3, 4]);

  const startedAt = performance.now();
  for (let index = 0; index < 10_000; index += 1) socket.emit("message", frame, true);
  for (let index = 0; index < 10_000; index += 1) await connection.send(frame);
  const elapsed = performance.now() - startedAt;

  expect(received).toBe(10_000);
  expect(socket.sent).toHaveLength(10_000);
  expect(elapsed).toBeLessThan(500);
  await listener.close();
});
