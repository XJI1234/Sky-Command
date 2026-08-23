import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { NodeRuntime } from "../src/production/node-runtime/index.js";
import { RelayFrameCodec } from "../src/modules/relay-link/protocol-core/index.js";

async function availablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function nextMessage(socket: WebSocket): Promise<Uint8Array> {
  const [payload] = await once(socket, "message");
  return payload instanceof Uint8Array ? payload : new Uint8Array(payload as ArrayBuffer);
}

async function nextMessageWithin(socket: WebSocket, milliseconds: number): Promise<Uint8Array | null> {
  return Promise.race([nextMessage(socket), new Promise<null>((resolve) => setTimeout(() => resolve(null), milliseconds))]);
}

describe("NodeRuntime", () => {
  it("creates an initially stopped relay backed by the Node transport", async () => {
    const relay = NodeRuntime.createRelay({ address: { host: "127.0.0.1", port: 0 }, handshakeTimeoutMs: 1_000, maxConnections: 1, commandTimeoutMs: 1_000, missionTimeoutMs: 1_000 });
    expect(relay.devices()).toEqual([]);
    await expect(relay.start()).resolves.toMatchObject({ ok: true, value: { state: "listening" } });
    await relay.stop();
  });

  it("creates isolated relay instances without sharing lifecycle state", async () => {
    const options = { address: { host: "127.0.0.1", port: 0 }, handshakeTimeoutMs: 1_000, maxConnections: 1, commandTimeoutMs: 1_000, missionTimeoutMs: 1_000 } as const;
    const first = NodeRuntime.createRelay(options);
    const second = NodeRuntime.createRelay(options);
    await expect(first.start()).resolves.toMatchObject({ ok: true, value: { state: "listening" } });
    expect(second.devices()).toEqual([]);
    await expect(second.start()).resolves.toMatchObject({ ok: true, value: { state: "listening" } });
    await Promise.all([first.stop(), second.stop()]);
    expect(first.devices()).toEqual([]);
    expect(second.devices()).toEqual([]);
  });

  it("uses the system timer and UUID factories during a real binary relay handshake", async () => {
    const port = await availablePort();
    const relay = NodeRuntime.createRelay({ address: { host: "127.0.0.1", port }, handshakeTimeoutMs: 1_000, maxConnections: 1, commandTimeoutMs: 1_000, missionTimeoutMs: 1_000 });
    await relay.start();
    const socket = new WebSocket(`ws://127.0.0.1:${port}/relay`);
    await once(socket, "open");
    const hello = RelayFrameCodec.encode({ type: "hello", deviceId: "phone-1", protocolVersion: "1" });
    if (!hello.ok) throw new Error("test setup failed");
    socket.send(hello.value);
    const paired = RelayFrameCodec.decode(await nextMessage(socket));
    expect(paired).toMatchObject({ kind: "decoded", frame: { type: "paired", protocolVersion: "1" } });
    expect(relay.devices()).toEqual([expect.objectContaining({ deviceId: "phone-1" })]);
    socket.close();
    await once(socket, "close");
    await relay.stop();
  });

  it("persists a mobile diagnostic report and acknowledges it through the real relay", async () => {
    const originalLocalAppData = process.env.LOCALAPPDATA;
    const localAppData = mkdtempSync(join(tmpdir(), "sky-command-runtime-"));
    process.env.LOCALAPPDATA = localAppData;
    const port = await availablePort();
    const relay = NodeRuntime.createRelay({ address: { host: "127.0.0.1", port }, handshakeTimeoutMs: 1_000, maxConnections: 1, commandTimeoutMs: 1_000, missionTimeoutMs: 1_000 });
    try {
      await relay.start();
      const socket = new WebSocket(`ws://127.0.0.1:${port}/relay`);
      await once(socket, "open");
      const hello = RelayFrameCodec.encode({ type: "hello", deviceId: "phone-1", protocolVersion: "1" });
      if (!hello.ok) throw new Error("test setup failed");
      socket.send(hello.value);
      await nextMessage(socket);
      const report = RelayFrameCodec.encode({ type: "diagnostic-report", runId: "run-1", events: [{ sequence: 1, timestampMillis: 1, level: "ERROR", module: "device-connection", eventCode: "SDK_FAILURE", operationId: "start-1", safeDetail: "registration failed" }] });
      if (!report.ok) throw new Error("test setup failed");
      socket.send(report.value);
      const acknowledgement = await nextMessageWithin(socket, 300);
      expect(acknowledgement).not.toBeNull();
      if (acknowledgement === null) throw new Error("diagnostic acknowledgement was not sent");
      expect(RelayFrameCodec.decode(acknowledgement)).toMatchObject({ kind: "decoded", frame: { type: "diagnostic-ack", runId: "run-1", acknowledgedSequence: 1 } });
      expect(readFileSync(join(localAppData, "Sky Command", "diagnostics", "relay-events.ndjson"), "utf8")).toContain("\"eventCode\":\"SDK_FAILURE\"");
      socket.close();
      await once(socket, "close");
    } finally {
      await relay.stop();
      if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = originalLocalAppData;
      rmSync(localAppData, { recursive: true, force: true });
    }
  });

  it("allows a test host to inject an isolated diagnostic sink", async () => {
    const received: unknown[] = [];
    const relay = NodeRuntime.createRelay({
      address: { host: "127.0.0.1", port: 0 }, handshakeTimeoutMs: 1_000, maxConnections: 1,
      commandTimeoutMs: 1_000, missionTimeoutMs: 1_000,
      diagnosticSink: { persist: (report) => { received.push(report); return true; } },
    });

    expect(received).toEqual([]);
    await relay.stop();
  });
});
