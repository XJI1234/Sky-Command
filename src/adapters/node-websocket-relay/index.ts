import { WebSocket, WebSocketServer } from "ws";
import type { ListenAddress, RelayConnection, RelayConnectionProbeResult, RelayTransport } from "../../modules/relay-link/relay-server/index.js";

export interface WebSocketLike {
  readonly readyState: number;
  readonly OPEN: number;
  send(data: Uint8Array, callback?: (error?: Error) => void): void;
  close(): void;
  ping?(payload?: Uint8Array): void;
  on(event: string, listener: (...args: any[]) => void): this;
  off?(event: string, listener: (...args: any[]) => void): this;
}

interface UpgradeRequestLike {
  readonly socket?: Readonly<{ readonly localAddress?: unknown }>;
}

export interface WebSocketServerLike {
  on(event: string, listener: (...args: any[]) => void): this;
  off?(event: string, listener: (...args: any[]) => void): this;
  close(callback?: (error?: Error) => void): void;
}

export interface WebSocketServerFactory {
  readonly openState: number;
  create(address: ListenAddress): WebSocketServerLike;
}

export interface RelayPingScheduler {
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
  setTimeout?(callback: () => void, milliseconds: number): unknown;
  clearTimeout?(handle: unknown): void;
}

export interface NodeWebSocketRelayOptions {
  readonly factory?: WebSocketServerFactory;
  readonly pingIntervalMs?: number;
  readonly probeTimeoutMs?: number;
  readonly scheduler?: RelayPingScheduler;
  readonly now?: () => number;
}

const productionFactory: WebSocketServerFactory = Object.freeze({
  openState: WebSocket.OPEN,
  create: (address: ListenAddress) => new WebSocketServer({ host: address.host, port: address.port, path: "/relay" })
});

const stableReason = (reason: string): string => reason === "server-closed" || reason === "transport-error" ? reason : "peer-closed";
const copyBytes = (data: unknown): Uint8Array | null => {
  if (data instanceof Uint8Array) return data.slice();
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  return null;
};
const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);

const ipv4Address = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/u.test(value)) return false;
  const parts = value.split(".").map(Number);
  return parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && parts[0] !== 0 && parts[0] !== 127 && parts[0]! < 224;
};
const ingressAddress = (request: UpgradeRequestLike | undefined): string | undefined => {
  try {
    const value = request?.socket?.localAddress;
    return ipv4Address(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

function adapt(socket: WebSocketLike, openState: number, localAddress: string | undefined, onClosed: (connection: RelayConnection) => void, ping: Readonly<{ readonly intervalMs: number; readonly probeTimeoutMs: number; readonly scheduler: RelayPingScheduler; readonly timeout: Readonly<{ readonly set: (callback: () => void, milliseconds: number) => unknown; readonly clear: (handle: unknown) => void }> }>, now: () => number): RelayConnection & { shutdown(reason: string): void } {
  const messageListeners = new Set<(bytes: Uint8Array) => void>();
  const closeListeners = new Set<(reason?: string) => void>();
  const errorListeners = new Set<() => void>();
  let closed = false;
  let awaitingPong: Uint8Array | null = null;
  let pingTimer: unknown = null;
  let pingSequence = 0;
  let activeProbe: Readonly<{ readonly startedAtMs: number; readonly payload: Uint8Array; readonly timeout: unknown | null; readonly resolve: (result: RelayConnectionProbeResult) => void; readonly operation: Promise<RelayConnectionProbeResult> }> | null = null;
  const nextPingPayload = (purpose: number): Uint8Array => {
    pingSequence = (pingSequence + 1) >>> 0;
    return Uint8Array.of(0x53, purpose, pingSequence >>> 24, (pingSequence >>> 16) & 0xff, (pingSequence >>> 8) & 0xff, pingSequence & 0xff);
  };
  const finishProbe = (result: RelayConnectionProbeResult): void => {
    const probe = activeProbe;
    if (probe === null) return;
    activeProbe = null;
    if (probe.timeout !== null) {
      // Probe scheduling is diagnostic-only. A broken timer implementation must
      // not strand the transport's probe state or escape a WebSocket callback.
      try { ping.timeout.clear(probe.timeout); } catch { /* best-effort cleanup */ }
    }
    probe.resolve(result);
  };
  const notifyClose = (reason: string): void => {
    if (closed) return;
    closed = true;
    finishProbe(Object.freeze({ status: "unavailable" }));
    if (pingTimer !== null) ping.scheduler.clearInterval(pingTimer);
    pingTimer = null;
    onClosed(connection);
    for (const listener of [...closeListeners]) { try { listener(stableReason(reason)); } catch { /* isolate caller */ } }
    messageListeners.clear(); errorListeners.clear();
  };
  const connection: RelayConnection & { shutdown(reason: string): void } = {
    ...(localAddress === undefined ? {} : { localAddress }),
    send: async (bytes) => {
      if (closed || socket.readyState !== openState || !(bytes instanceof Uint8Array)) throw new Error("transport unavailable");
      const copy = bytes.slice();
      await new Promise<void>((resolve, reject) => {
        try { socket.send(copy, (error) => error ? reject(new Error("transport send failed")) : resolve()); }
        catch { reject(new Error("transport send failed")); }
      });
    },
    close: async () => { connection.shutdown("peer-closed"); },
    onMessage: (listener) => { if (closed) return () => undefined; messageListeners.add(listener); let active = true; return () => { if (active) { active = false; messageListeners.delete(listener); } }; },
    onClose: (listener) => { closeListeners.add(listener); let active = true; return () => { if (active) { active = false; closeListeners.delete(listener); } }; },
    onError: (listener) => { errorListeners.add(listener); let active = true; return () => { if (active) { active = false; errorListeners.delete(listener); } }; },
    probeLink: (): Promise<RelayConnectionProbeResult> => {
      if (activeProbe !== null) return activeProbe.operation;
      if (closed || socket.readyState !== openState || typeof socket.ping !== "function") return Promise.resolve(Object.freeze({ status: "unavailable" }));
      let resolveProbe!: (result: RelayConnectionProbeResult) => void;
      const operation = new Promise<RelayConnectionProbeResult>((resolve) => { resolveProbe = resolve; });
      const payload = nextPingPayload(0x44);
      activeProbe = Object.freeze({ startedAtMs: now(), payload, timeout: null, resolve: resolveProbe, operation });
      let timeout: unknown;
      try {
        timeout = ping.timeout.set(() => {
          if (activeProbe?.operation === operation) finishProbe(Object.freeze({ status: "timed-out" }));
        }, ping.probeTimeoutMs);
      } catch {
        finishProbe(Object.freeze({ status: "unavailable" }));
        return operation;
      }
      if (activeProbe?.operation === operation) activeProbe = Object.freeze({ ...activeProbe, timeout });
      try { socket.ping(payload.slice()); }
      catch { finishProbe(Object.freeze({ status: "unavailable" })); }
      return operation;
    },
    shutdown: (reason) => { if (closed) return; notifyClose(reason); try { socket.close(); } catch { /* cleanup remains committed */ } }
  };
  socket.on("message", (data: unknown, isBinary?: boolean) => {
    if (closed) return;
    if (isBinary === false) { connection.shutdown("transport-error"); return; }
    const bytes = copyBytes(data);
    if (!bytes) { connection.shutdown("transport-error"); return; }
    for (const listener of [...messageListeners]) { try { listener(bytes.slice()); } catch { /* isolate caller */ } }
  });
  socket.on("error", () => {
    for (const listener of [...errorListeners]) { try { listener(); } catch { /* isolate caller */ } }
    connection.shutdown("transport-error");
  });
  socket.on("close", () => notifyClose("peer-closed"));
  socket.on("pong", (data: unknown) => {
    if (closed) return;
    const payload = copyBytes(data);
    if (payload === null) return;
    const probe = activeProbe;
    if (probe !== null && bytesEqual(payload, probe.payload)) {
      const elapsedMs = now() - probe.startedAtMs;
      finishProbe(Object.freeze({ status: "measured", rttMs: Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0 }));
      return;
    }
    if (awaitingPong !== null && bytesEqual(payload, awaitingPong)) awaitingPong = null;
  });
  if (ping.intervalMs > 0 && typeof socket.ping === "function") {
    pingTimer = ping.scheduler.setInterval(() => {
      if (closed) return;
      if (awaitingPong !== null) { connection.shutdown("peer-closed"); return; }
      const payload = nextPingPayload(0x4b);
      awaitingPong = payload;
      try { socket.ping!(payload.slice()); } catch { connection.shutdown("transport-error"); }
    }, ping.intervalMs);
  }
  return connection;
}

function create(options: NodeWebSocketRelayOptions = {}): RelayTransport {
  const factory = options.factory ?? productionFactory;
  const defaultScheduler = Object.freeze({
    setInterval: (callback: () => void, milliseconds: number) => setInterval(callback, milliseconds),
    clearInterval: (handle: unknown) => { clearInterval(handle as NodeJS.Timeout); },
    setTimeout: (callback: () => void, milliseconds: number) => setTimeout(callback, milliseconds),
    clearTimeout: (handle: unknown) => { clearTimeout(handle as NodeJS.Timeout); },
  });
  const scheduler = options.scheduler ?? defaultScheduler;
  const ping = Object.freeze({
    intervalMs: options.pingIntervalMs ?? 15_000,
    probeTimeoutMs: typeof options.probeTimeoutMs === "number" && Number.isFinite(options.probeTimeoutMs) && options.probeTimeoutMs > 0 ? Math.min(options.probeTimeoutMs, 5_000) : 1_000,
    scheduler,
    timeout: Object.freeze({
      set: scheduler.setTimeout ?? defaultScheduler.setTimeout,
      clear: scheduler.clearTimeout ?? defaultScheduler.clearTimeout,
    }),
  });
  const now = options.now ?? (() => performance.now());
  return Object.freeze({
    listen(address: ListenAddress, onConnection: (connection: RelayConnection) => void): Promise<{ close(): Promise<void> }> {
      return new Promise((resolve, reject) => {
        let server: WebSocketServerLike;
        let listening = false;
        const connections = new Set<RelayConnection & { shutdown(reason: string): void }>();
        try { server = factory.create({ ...address }); }
        catch { reject(new Error("relay listener could not start")); return; }
        const handleError = (): void => { if (!listening) reject(new Error("relay listener could not start")); };
        const handleConnection = (socket: WebSocketLike, request?: UpgradeRequestLike): void => {
          const connection = adapt(socket, factory.openState, ingressAddress(request), (closed) => connections.delete(closed as RelayConnection & { shutdown(reason: string): void }), ping, now);
          connections.add(connection);
          try { onConnection(connection); } catch { connection.shutdown("transport-error"); }
        };
        server.on("error", handleError).on("listening", () => {
          listening = true;
          let closePromise: Promise<void> | null = null;
          resolve({ close: async () => {
            if (closePromise) return closePromise;
            closePromise = new Promise<void>((done) => {
              for (const connection of [...connections]) connection.shutdown("server-closed");
              try { server.close(() => done()); } catch { done(); }
            });
            return closePromise;
          } });
        }).on("connection", handleConnection);
      });
    }
  });
}

export const NodeWebSocketRelayTransport = Object.freeze({ create });
