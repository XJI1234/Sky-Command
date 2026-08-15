import { ProtocolLimits, RelayFrameCodec, type DecodeResult, type ProtocolError, type RelayFrame } from "../protocol-core/index.js";

export interface ListenAddress { readonly host: string; readonly port: number; }

export interface RelayConnection {
  send(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  onMessage(listener: (bytes: Uint8Array) => void): () => void;
  onClose(listener: (reason?: string) => void): () => void;
  onError(listener: () => void): () => void;
}

export interface RelayTransport {
  listen(address: ListenAddress, onConnection: (connection: RelayConnection) => void): Promise<{ close(): Promise<void> }>;
}

export interface TimerScheduler {
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface RelayServerOptions {
  readonly address: ListenAddress;
  readonly transport: RelayTransport;
  readonly scheduler: TimerScheduler;
  readonly handshakeTimeoutMs: number;
  readonly maxConnections: number;
  readonly createConnectionId: () => string;
  readonly createSessionId: (deviceId: string) => string;
}

export type ConnectionPhase = "awaiting-hello" | "paired";
export interface ConnectionSnapshot {
  readonly connectionId: string;
  readonly phase: ConnectionPhase;
  readonly deviceId: string | null;
  readonly sessionId: string | null;
}
export type RelayServerState = "stopped" | "starting" | "listening" | "stopping";
export interface RelayServerSnapshot {
  readonly state: RelayServerState;
  readonly endpoint: ListenAddress | null;
  readonly connections: readonly ConnectionSnapshot[];
}

export type RelayServerErrorCode = "SERVER_ALREADY_STARTED" | "LISTEN_FAILED" | "NOT_CONNECTED" | "INVALID_FRAME" | "SEND_FAILED";
export interface RelayServerError { readonly code: RelayServerErrorCode; readonly message: string; }
export type StartResult = Readonly<{ readonly ok: true; readonly value: RelayServerSnapshot }> | Readonly<{ readonly ok: false; readonly error: RelayServerError }>;
export type SendResult = Readonly<{ readonly ok: true }> | Readonly<{ readonly ok: false; readonly error: RelayServerError }>;

export type RelayServerEvent =
  | Readonly<{ readonly kind: "state-changed"; readonly snapshot: RelayServerSnapshot }>
  | Readonly<{ readonly kind: "connection-opened"; readonly connection: ConnectionSnapshot }>
  | Readonly<{ readonly kind: "connection-paired"; readonly connection: ConnectionSnapshot }>
  | Readonly<{ readonly kind: "frame"; readonly connectionId: string; readonly frame: RelayFrame }>
  | Readonly<{ readonly kind: "connection-closed"; readonly connectionId: string; readonly reason: string }>
  | Readonly<{ readonly kind: "protocol-error"; readonly connectionId: string; readonly error: ProtocolError }>;

export interface RelayServerInstance {
  start(): Promise<StartResult>;
  stop(): Promise<void>;
  snapshot(): RelayServerSnapshot;
  subscribe(listener: (event: RelayServerEvent) => void): () => void;
  send(connectionId: string, bytes: Uint8Array): Promise<SendResult>;
}

const protocolError = (code: ProtocolError["code"], message: string): ProtocolError => Object.freeze({ code, message });
const serverError = (code: RelayServerErrorCode, message: string): RelayServerError => Object.freeze({ code, message });
const success = <T extends object>(value: T): Readonly<{ readonly ok: true } & T> => Object.freeze({ ok: true as const, ...value });
const failure = <T = never>(code: RelayServerErrorCode, message: string): Readonly<{ readonly ok: false; readonly error: RelayServerError }> => Object.freeze({ ok: false as const, error: serverError(code, message) });

function create(options: RelayServerOptions): RelayServerInstance {
  let state: RelayServerState = "stopped";
  let endpoint: ListenAddress | null = null;
  let listener: { close(): Promise<void> } | null = null;
  let startOperation: Promise<StartResult> | null = null;
  const connections = new Map<string, InternalConnection>();
  const subscribers = new Set<(event: RelayServerEvent) => void>();

  interface InternalConnection {
    readonly id: string;
    readonly transport: RelayConnection;
    phase: ConnectionPhase;
    deviceId: string | null;
    sessionId: string | null;
    timeout: unknown;
    closed: boolean;
    inbound: Promise<void> | null;
    outbound: Promise<void>;
    unsubscribe: readonly (() => void)[];
  }

  const snapshotConnection = (entry: InternalConnection): ConnectionSnapshot => Object.freeze({ connectionId: entry.id, phase: entry.phase, deviceId: entry.deviceId, sessionId: entry.sessionId });
  const snapshot = (): RelayServerSnapshot => Object.freeze({ state, endpoint, connections: Object.freeze([...connections.values()].map(snapshotConnection)) });
  const publish = (event: RelayServerEvent): void => {
    for (const subscriber of [...subscribers]) {
      try { subscriber(event); } catch { /* subscriber isolation is part of the seam */ }
    }
  };
  const changeState = (next: RelayServerState): void => { state = next; publish(Object.freeze({ kind: "state-changed" as const, snapshot: snapshot() })); };

  const finish = (entry: InternalConnection, reason: string): void => {
    if (entry.closed) return;
    entry.closed = true;
    options.scheduler.clearTimeout(entry.timeout);
    for (const unsubscribe of entry.unsubscribe) unsubscribe();
    connections.delete(entry.id);
    publish(Object.freeze({ kind: "connection-closed" as const, connectionId: entry.id, reason }));
    void entry.transport.close().catch(() => undefined);
  };

  const rejectProtocol = (entry: InternalConnection, error: ProtocolError): void => {
    publish(Object.freeze({ kind: "protocol-error" as const, connectionId: entry.id, error }));
    finish(entry, "protocol-error");
  };

  const sendDirect = async (entry: InternalConnection, bytes: Uint8Array): Promise<void> => {
    await entry.transport.send(bytes.slice());
  };

  const handleDecoded = async (entry: InternalConnection, result: DecodeResult): Promise<void> => {
    if (result.kind === "rejected") { rejectProtocol(entry, result.error); return; }
    if (result.kind === "ignored") {
      if (entry.phase === "awaiting-hello") rejectProtocol(entry, protocolError("INVALID_MESSAGE_TYPE", "First frame must be hello"));
      return;
    }
    const frame = result.frame;
    if (entry.phase === "awaiting-hello") {
      if (frame.type !== "hello") { rejectProtocol(entry, protocolError("INVALID_MESSAGE_TYPE", "First frame must be hello")); return; }
      for (const candidate of [...connections.values()]) {
        if (candidate !== entry && candidate.deviceId === frame.deviceId) finish(candidate, "session-replaced");
      }
      const occupied = [...connections.values()].filter((candidate) => candidate !== entry && candidate.phase === "paired").length;
      if (occupied >= options.maxConnections) { finish(entry, "capacity"); return; }
      const sessionId = options.createSessionId(frame.deviceId);
      const paired: RelayFrame = { type: "paired", sessionId, protocolVersion: "1" };
      const encoded = RelayFrameCodec.encode(paired);
      if (!encoded.ok) { rejectProtocol(entry, protocolError("INVALID_FIELD", "Pairing frame cannot be encoded")); return; }
      try { await sendDirect(entry, encoded.value); } catch { finish(entry, "send-failed"); return; }
      options.scheduler.clearTimeout(entry.timeout);
      entry.phase = "paired";
      entry.deviceId = frame.deviceId;
      entry.sessionId = sessionId;
      publish(Object.freeze({ kind: "connection-paired" as const, connection: snapshotConnection(entry) }));
      return;
    }
    if (frame.type === "hello" || frame.type === "paired") { rejectProtocol(entry, protocolError("INVALID_MESSAGE_TYPE", "Handshake frame is not allowed")); return; }
    publish(Object.freeze({ kind: "frame" as const, connectionId: entry.id, frame }));
  };

  const enqueueInbound = (entry: InternalConnection, bytes: Uint8Array): void => {
    const run = async (): Promise<void> => { if (!entry.closed) await handleDecoded(entry, RelayFrameCodec.decode(bytes)); };
    entry.inbound = (entry.inbound ?? Promise.resolve()).then(run, run);
  };

  const accept = (transportConnection: RelayConnection): void => {
    const unpaired = [...connections.values()].filter((candidate) => candidate.phase !== "paired").length;
    if (state !== "listening" || (connections.size >= options.maxConnections && unpaired > 0) || connections.size >= options.maxConnections + 1) {
      void transportConnection.close().catch(() => undefined);
      return;
    }
    const entry: InternalConnection = {
      id: options.createConnectionId(), transport: transportConnection, phase: "awaiting-hello", deviceId: null, sessionId: null,
      timeout: null, closed: false, inbound: null, outbound: Promise.resolve(), unsubscribe: []
    };
    connections.set(entry.id, entry);
    entry.timeout = options.scheduler.setTimeout(() => { if (entry.phase === "awaiting-hello") finish(entry, "handshake-timeout"); }, options.handshakeTimeoutMs);
    entry.unsubscribe = [
      transportConnection.onMessage((bytes) => enqueueInbound(entry, bytes.slice())),
      transportConnection.onClose((reason) => finish(entry, reason ?? "peer-closed")),
      transportConnection.onError(() => finish(entry, "transport-error"))
    ];
    publish(Object.freeze({ kind: "connection-opened" as const, connection: snapshotConnection(entry) }));
  };

  const start = (): Promise<StartResult> => {
    if (state !== "stopped") return Promise.resolve(failure("SERVER_ALREADY_STARTED", "Server is already started"));
    changeState("starting");
    const operation = (async (): Promise<StartResult> => {
      try {
        listener = await options.transport.listen(options.address, accept);
        endpoint = Object.freeze({ ...options.address });
        changeState("listening");
        return success({ value: snapshot() });
      } catch {
        listener = null; endpoint = null; changeState("stopped");
        return failure("LISTEN_FAILED", "Server could not listen");
      }
    })();
    startOperation = operation;
    void operation.finally(() => {
      /* c8 ignore next -- a second start cannot replace this operation while the server is starting. */
      if (startOperation === operation) startOperation = null;
    });
    return operation;
  };

  const stop = async (): Promise<void> => {
    if ((state as RelayServerState) === "stopped") return;
    if (state === "starting" && startOperation) await startOperation;
    if ((state as RelayServerState) === "stopped") return;
    changeState("stopping");
    const current = [...connections.values()];
    for (const entry of current) finish(entry, "server-stopped");
    const currentListener = listener; listener = null;
    /* c8 ignore next -- listening state is entered only after the listener has been committed. */
    if (currentListener) await currentListener.close().catch(() => undefined);
    endpoint = null; changeState("stopped");
  };

  const send = async (connectionId: string, bytes: Uint8Array): Promise<SendResult> => {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > ProtocolLimits.maxFrameBytes || RelayFrameCodec.decode(bytes).kind === "rejected") return failure("INVALID_FRAME", "Frame is invalid");
    const entry = connections.get(connectionId);
    if (!entry || entry.closed || entry.phase !== "paired") return failure("NOT_CONNECTED", "Connection is not paired");
    const copy = bytes.slice();
    let resolveResult!: (result: SendResult) => void;
    const result = new Promise<SendResult>((resolve) => { resolveResult = resolve; });
    entry.outbound = entry.outbound.then(
      async () => {
        if (entry.closed || entry.phase !== "paired") { resolveResult(failure("NOT_CONNECTED", "Connection is not paired")); return; }
        try { await entry.transport.send(copy.slice()); resolveResult(success({})); }
        catch { resolveResult(failure("SEND_FAILED", "Frame could not be sent")); finish(entry, "send-failed"); }
      },
      /* c8 ignore next -- every prior outbound branch resolves its error to the caller. */
      () => { resolveResult(failure("SEND_FAILED", "Frame could not be sent")); }
    );
    return result;
  };

  return Object.freeze({
    start,
    stop,
    snapshot,
    subscribe(listenerToAdd: (event: RelayServerEvent) => void): () => void { subscribers.add(listenerToAdd); let active = true; return () => { if (active) { active = false; subscribers.delete(listenerToAdd); } }; },
    send
  });
}

export const RelayServer = Object.freeze({ create });
