import { once } from "node:events";
import { connect, createServer } from "node:net";
import { expect, it } from "vitest";
import { NodeWebSocketRelayTransport } from "../src/adapters/node-websocket-relay/index.js";
import { RelayFrameCodec, type RelayFrame } from "../src/modules/relay-link/protocol-core/index.js";
import { RelayServer } from "../src/modules/relay-link/relay-server/index.js";

async function availablePort(): Promise<number> {
  const allocator = createServer();
  allocator.listen(0, "127.0.0.1");
  await once(allocator, "listening");
  const address = allocator.address();
  if (address === null || typeof address === "string") throw new Error("No test port");
  await new Promise<void>((resolve) => allocator.close(() => resolve()));
  return address.port;
}

// A raw client makes all WebSocket frames arrive in one TCP write, as happens
// when upload callbacks accumulate while the gateway's event loop is busy.
function maskedFrame(frame: RelayFrame): Buffer {
  const encoded = RelayFrameCodec.encode(frame);
  if (!encoded.ok) throw encoded.error;
  const payload = Buffer.from(encoded.value);
  const header = Buffer.alloc(payload.length < 126 ? 2 : 4);
  header[0] = 0x82;
  header[1] = 0x80 | (payload.length < 126 ? payload.length : 126);
  if (payload.length >= 126) header.writeUInt16BE(payload.length, 2);
  const mask = Buffer.from([1, 2, 3, 4]);
  for (let index = 0; index < payload.length; index += 1) payload[index] = payload[index]! ^ mask[index % 4]!;
  return Buffer.concat([header, mask, payload]);
}

it("keeps an uploaded mission connected when progress, diagnostics and its result share a TCP read", async () => {
  const port = await availablePort();
  const server = RelayServer.create({
    address: { host: "127.0.0.1", port },
    transport: NodeWebSocketRelayTransport.create({ pingIntervalMs: 0 }),
    scheduler: { setTimeout, clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout) },
    handshakeTimeoutMs: 1_000,
    maxConnections: 1,
    createConnectionId: () => "connection-1",
    createSessionId: () => "session-1",
  });
  const received: RelayFrame[] = [];
  const closed: string[] = [];
  let paired!: () => void;
  let finished!: () => void;
  const pairing = new Promise<void>((resolve) => { paired = resolve; });
  const completion = new Promise<void>((resolve) => { finished = resolve; });
  server.subscribe((event) => {
    if (event.kind === "connection-paired") paired();
    if (event.kind === "connection-closed") { closed.push(event.reason); finished(); }
    if (event.kind === "frame") {
      received.push(event.frame);
      if (event.frame.type === "command-result" && event.frame.id === "upload-1") finished();
    }
  });
  expect((await server.start()).ok).toBe(true);
  const socket = connect(port, "127.0.0.1");
  try {
    await once(socket, "connect");
    const upgraded = once(socket, "data");
    socket.write("GET /relay HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n");
    expect(String((await upgraded)[0])).toContain("101 Switching Protocols");
    socket.on("data", () => undefined);
    socket.write(maskedFrame({ type: "hello", deviceId: "phone-1", protocolVersion: "1" }));
    await pairing;

    const burst: RelayFrame[] = [];
    for (let sequence = 1; sequence <= 16; sequence += 1) {
      burst.push({
        type: "diagnostic-report", runId: "run-1",
        events: [{ sequence, timestampMillis: sequence, level: "INFO", module: "wayline-mission", eventCode: "WAYLINE_STATE_CHANGED", operationId: null, safeDetail: `upload progress ${sequence}` }],
      });
      burst.push({
        type: "telemetry", capabilities: { kind: "object", fields: {} },
        payload: { kind: "object", fields: {
          telemetrySequence: { kind: "number", value: String(sequence) },
          missionRevision: { kind: "number", value: "1" },
          missionUploadProgress: { kind: "number", value: String(Math.min(sequence * 7, 100)) },
        } },
      });
    }
    burst.push({ type: "mission-result", id: "mission-1", ok: true, detail: "Mission staged" });
    burst.push({ type: "command-result", id: "upload-1", ok: true, detail: "Mission uploaded" });
    socket.write(Buffer.concat(burst.map(maskedFrame)));
    await completion;

    expect(closed).toEqual([]);
    expect(received).toEqual(burst);
    expect(server.snapshot().connections).toEqual([expect.objectContaining({ phase: "paired", sessionId: "session-1" })]);
  } finally {
    const disconnected = once(socket, "close");
    socket.destroy();
    await disconnected;
    await server.stop();
  }
});
