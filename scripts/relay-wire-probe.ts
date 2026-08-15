import WebSocket from "ws";
import { NodeWebSocketRelayTransport } from "../src/adapters/node-websocket-relay/index.js";
import { RelayServer } from "../src/modules/relay-link/relay-server/index.js";

const port = 18_081;
const server = RelayServer.create({
  address: { host: "127.0.0.1", port },
  transport: NodeWebSocketRelayTransport.create(),
  scheduler: { setTimeout, clearTimeout },
  handshakeTimeoutMs: 5_000,
  maxConnections: 1,
  createConnectionId: () => "probe-connection",
  createSessionId: () => "probe-session",
});

server.subscribe((event) => process.stdout.write(`${JSON.stringify(event)}\n`));
const started = await server.start();
if (!started.ok) throw new Error(started.error.code);

const frame = (value: object): Buffer => Buffer.from(JSON.stringify(value), "utf8");
const client = new WebSocket(`ws://127.0.0.1:${port}/relay`);
const finish = async (exitCode: number): Promise<void> => {
  client.close();
  await server.stop();
  process.exitCode = exitCode;
};
const timeout = setTimeout(() => { void finish(1); }, 5_000);

client.on("error", () => { void finish(1); });
client.on("open", () => client.send(frame({ type: "hello", deviceId: "probe-phone", protocolVersion: "1" }), { binary: true }));
client.on("message", (data) => {
  const inbound = JSON.parse(data.toString());
  process.stdout.write(`${JSON.stringify({ clientReceived: inbound })}\n`);
  if (inbound.type === "paired") {
    client.send(frame({
      type: "diagnostic-report",
      runId: "probe-run",
      events: [{ sequence: 1, timestampMillis: 1, level: "INFO", module: "probe", eventCode: "WIRE_CHECK", operationId: null, safeDetail: "Protocol probe" }],
    }), { binary: true });
    setTimeout(() => { clearTimeout(timeout); void finish(0); }, 100);
  }
});
