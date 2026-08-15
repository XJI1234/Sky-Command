import WebSocket from "ws";
import { NodeRuntime } from "../src/production/node-runtime/index.js";

const port = 18_082;
const relay = NodeRuntime.createRelay({
  address: { host: "127.0.0.1", port },
  handshakeTimeoutMs: 5_000,
  maxConnections: 1,
  commandTimeoutMs: 5_000,
  missionTimeoutMs: 5_000,
});

const started = await relay.start();
if (!started.ok) throw new Error(started.error.code);

const frame = (value: object): Buffer => Buffer.from(JSON.stringify(value), "utf8");
const client = new WebSocket(`ws://127.0.0.1:${port}/relay`);

try {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("diagnostic acknowledgement timed out")), 5_000);
    client.on("error", reject);
    client.on("open", () => client.send(frame({ type: "hello", deviceId: "diagnostic-runtime-probe", protocolVersion: "1" }), { binary: true }));
    client.on("message", (data) => {
      const inbound = JSON.parse(data.toString());
      if (inbound.type === "paired") {
        client.send(frame({
          type: "diagnostic-report",
          runId: "desktop-validation",
          events: [{ sequence: 1, timestampMillis: 1, level: "INFO", module: "validation", eventCode: "DESKTOP_LOG_CHAIN", operationId: null, safeDetail: "Synthetic desktop validation event" }],
        }), { binary: true });
      }
      if (inbound.type === "diagnostic-ack" && inbound.runId === "desktop-validation" && inbound.acknowledgedSequence === 1) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  process.stdout.write("Diagnostic runtime probe passed.\n");
} finally {
  client.close();
  await relay.stop();
}
