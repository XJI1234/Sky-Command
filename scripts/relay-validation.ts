import { NodeRuntime } from "../src/production/node-runtime/index.js";

const relay = NodeRuntime.createRelay({
  address: { host: "0.0.0.0", port: 18_080 },
  handshakeTimeoutMs: 10_000,
  maxConnections: 4,
  commandTimeoutMs: 30_000,
  missionTimeoutMs: 60_000,
});

const started = await relay.start();
if (!started.ok) {
  process.stderr.write(`Relay listener could not start: ${started.error.code}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Relay validation listener active on ws://0.0.0.0:18080/relay\n");
  relay.subscribe((snapshot) => {
    process.stdout.write(`Relay state=${snapshot.state} devices=${snapshot.devices.length}\n`);
  });
  const stop = async (): Promise<void> => {
    await relay.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => { void stop(); });
  process.once("SIGTERM", () => { void stop(); });
}
