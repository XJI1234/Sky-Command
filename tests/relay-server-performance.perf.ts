import { expect, it } from "vitest";
import { RelayFrameCodec, type RelayFrame } from "../src/modules/relay-link/protocol-core/index.js";
import { RelayServer, type RelayConnection, type RelayTransport } from "../src/modules/relay-link/relay-server/index.js";

class FastConnection implements RelayConnection {
  private messageListener: ((bytes: Uint8Array) => void) | null = null;
  private closeListener: ((reason?: string) => void) | null = null;
  private errorListener: (() => void) | null = null;
  send(_bytes: Uint8Array): Promise<void> { return Promise.resolve(); }
  close(): Promise<void> { this.closeListener?.("closed"); return Promise.resolve(); }
  onMessage(listener: (bytes: Uint8Array) => void): () => void { this.messageListener = listener; return () => { this.messageListener = null; }; }
  onClose(listener: (reason?: string) => void): () => void { this.closeListener = listener; return () => { this.closeListener = null; }; }
  onError(listener: () => void): () => void { this.errorListener = listener; return () => { this.errorListener = null; }; }
  emit(frame: Uint8Array): void { this.messageListener?.(frame.slice()); }
  voidError(): void { this.errorListener?.(); }
}

class FastTransport implements RelayTransport {
  private accept: ((connection: RelayConnection) => void) | null = null;
  async listen(_address: { host: string; port: number }, onConnection: (connection: RelayConnection) => void): Promise<{ close(): Promise<void> }> {
    this.accept = onConnection;
    return { close: async () => undefined };
  }
  connect(): FastConnection { const connection = new FastConnection(); this.accept?.(connection); return connection; }
}

const encode = (frame: RelayFrame): Uint8Array => {
  const result = RelayFrameCodec.encode(frame);
  if (!result.ok) throw result.error;
  return result.value;
};

it("relay-server dispatches bounded inbound frames without quadratic work", async () => {
  const transport = new FastTransport();
  const server = RelayServer.create({
    address: { host: "127.0.0.1", port: 8765 },
    transport,
    scheduler: { setTimeout: () => 1, clearTimeout: () => undefined },
    handshakeTimeoutMs: 10_000,
    maxConnections: 1,
    createConnectionId: () => "connection-1",
    createSessionId: () => "session-1"
  });
  let frames = 0;
  server.subscribe((event) => { if (event.kind === "frame") frames += 1; });
  await server.start();
  const connection = transport.connect();
  connection.emit(encode({ type: "hello", deviceId: "phone-1", protocolVersion: "1" }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  const frame = encode({ type: "mission-complete", id: "mission-1" });
  const startedAt = performance.now();
  for (let index = 0; index < 1_000; index += 1) connection.emit(frame);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(frames).toBe(1_000);
  expect(performance.now() - startedAt).toBeLessThan(500);
  await server.stop();
});
