import { RelayServer, type RelayConnection, type RelayServerEvent, type RelayTransport, type TimerScheduler } from "../src/modules/relay-link/relay-server/index.js";

declare const transport: RelayTransport;
declare const connection: RelayConnection;
declare const scheduler: TimerScheduler;

const server = RelayServer.create({
  address: { host: "127.0.0.1", port: 8765 },
  transport,
  scheduler,
  handshakeTimeoutMs: 1000,
  maxConnections: 2,
  createConnectionId: () => "connection",
  createSessionId: () => "session"
});

server.subscribe((event: RelayServerEvent) => void event);
void server.start();
void server.stop();
void server.snapshot();
void connection;

// @ts-expect-error Transport connections only accept byte arrays.
void server.send("connection", "not-bytes");
void RelayServer;
