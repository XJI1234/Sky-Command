import { expect, it } from "vitest";
import { RelayFrameCodec, type RelayFrame } from "../src/modules/relay-link/protocol-core/index.js";
import { RelayLink, type RelayConnection, type RelayTransport } from "../src/modules/relay-link/index.js";

class Connection implements RelayConnection {
  private messages = new Set<(bytes: Uint8Array) => void>();
  private closes = new Set<(reason?: string) => void>();
  async send(_bytes: Uint8Array): Promise<void> {}
  async close(): Promise<void> { for (const listener of [...this.closes]) listener("closed"); }
  onMessage(listener: (bytes: Uint8Array) => void): () => void { this.messages.add(listener); return () => this.messages.delete(listener); }
  onClose(listener: (reason?: string) => void): () => void { this.closes.add(listener); return () => this.closes.delete(listener); }
  onError(_listener: () => void): () => void { return () => undefined; }
  emit(frame: RelayFrame): void { const encoded = RelayFrameCodec.encode(frame); if (!encoded.ok) throw new Error("fixture"); for (const listener of [...this.messages]) listener(encoded.value); }
}

class Transport implements RelayTransport {
  private accept: ((connection: RelayConnection) => void) | null = null;
  async listen(_address: { host: string; port: number }, accept: (connection: RelayConnection) => void): Promise<{ close(): Promise<void> }> { this.accept = accept; return { close: async () => undefined }; }
  connect(): Connection { const connection = new Connection(); this.accept?.(connection); return connection; }
}

it("relay-link snapshots hundreds of paired devices within the UI responsiveness budget", async () => {
  const transport = new Transport(); let next = 0;
  const link = RelayLink.create({
    address: { host: "127.0.0.1", port: 9000 }, transport,
    scheduler: { setTimeout: () => 1, clearTimeout: () => undefined }, handshakeTimeoutMs: 10_000, maxConnections: 256,
    commandTimeoutMs: 10_000, missionTimeoutMs: 10_000,
    createConnectionId: () => `connection-${++next}`, createSessionId: (deviceId) => `session-${deviceId}`, createCommandId: () => "command"
  });
  await link.start();
  for (let index = 0; index < 200; index += 1) transport.connect().emit({ type: "hello", deviceId: `phone-${index}`, protocolVersion: "1" });
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
  const startedAt = performance.now();
  const devices = link.devices();
  expect(devices).toHaveLength(200);
  expect(performance.now() - startedAt).toBeLessThan(100);
  await link.stop();
});
