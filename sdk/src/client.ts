import { ProtocolLimits, RelayFrameCodec } from '../../src/modules/relay-link/protocol-core/index.js';
import type { CommandOutcome, CommandRequest, LinkProbeReport, MissionOutcome, MissionPayload, RelayDeviceSnapshot, RelayLinkSnapshot, RelayPhotoProgress, RelayTelemetrySnapshot } from '../../src/modules/relay-link/index.js';
import { SkyCommandError, deepFreeze, isRecord, readCommandOutcome, readMissionOutcome, readPhotoProgress, readProbe, readRelaySnapshot, validId, type SdkErrorCode } from './shared.js';

export interface ClientSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: any) => void): void;
}
export interface SkyCommandClientOptions {
  /** Control gateway URL; this is /sdk, never the Android /relay endpoint. */
  readonly url: string;
  readonly socketFactory?: (url: string) => ClientSocket;
  readonly fetch?: typeof globalThis.fetch;
  readonly requestTimeoutMs?: number;
  readonly missionTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
  readonly reconnect?: false | { readonly delayMs?: number; readonly maxAttempts?: number };
  readonly credentials?: RequestCredentials;
  readonly uploadHeaders?: () => HeadersInit | Promise<HeadersInit>;
}
export interface SkyCommandSnapshot {
  readonly status: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'disposed';
  readonly relay: RelayLinkSnapshot | null;
  readonly error: Readonly<{ readonly code: SdkErrorCode; readonly message: string }> | null;
}
export interface SkyCommandClient {
  connect(): Promise<void>;
  disconnect(): void;
  dispose(): void;
  getSnapshot(): SkyCommandSnapshot;
  subscribe(listener: (snapshot: SkyCommandSnapshot) => void): () => void;
  devices(): readonly RelayDeviceSnapshot[];
  latestTelemetry(deviceId: string): RelayTelemetrySnapshot | null;
  sendCommand(deviceId: string, request: CommandRequest): Promise<CommandOutcome>;
  sendMission(deviceId: string, payload: MissionPayload): Promise<MissionOutcome>;
  measurePhoneLink(deviceId: string): Promise<LinkProbeReport>;
}
const errorCodes = new Set<SdkErrorCode>(['INVALID_INPUT', 'NOT_CONNECTED', 'DISCONNECTED', 'DISPOSED', 'TIMED_OUT', 'PROTOCOL_ERROR', 'SESSION_CHANGED', 'FORBIDDEN', 'BUSY', 'DEPENDENCY_FAILURE']);
const positive = (value: number): boolean => Number.isFinite(value) && value > 0;
const maxControlBytes = 4 * 1024 * 1024;

function abortable<T>(operation: Promise<T>, signal: AbortSignal, code: () => SdkErrorCode): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new SkyCommandError(code()));
    if (signal.aborted) { void operation.catch(() => undefined); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    void operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function createSkyCommandClient(options: SkyCommandClientOptions): SkyCommandClient {
  let url: URL;
  try { url = new URL(options.url); } catch { throw new SkyCommandError('INVALID_INPUT', 'Expected a ws/wss gateway URL'); }
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash) throw new SkyCommandError('INVALID_INPUT', 'Expected a ws/wss gateway URL');
  const requestTimeout = options.requestTimeoutMs ?? 35000;
  const missionTimeout = options.missionTimeoutMs ?? 120000;
  const connectTimeout = options.connectTimeoutMs ?? 10000;
  const reconnectDelay = options.reconnect === false ? 0 : options.reconnect?.delayMs ?? 1000;
  const maxAttempts = options.reconnect === false ? 0 : options.reconnect?.maxAttempts ?? 10;
  if (![requestTimeout, missionTimeout, connectTimeout].every(positive) || !Number.isSafeInteger(maxAttempts) || maxAttempts < 0 || (maxAttempts > 0 && !positive(reconnectDelay))) throw new SkyCommandError('INVALID_INPUT');
  let state: SkyCommandSnapshot = deepFreeze({ status: 'idle', relay: null, error: null });
  const listeners = new Set<(snapshot: SkyCommandSnapshot) => void>();
  let socket: ClientSocket | null = null;
  let connecting: { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0, sequence = 0;
  let wanted = false, disposed = false;
  const pending = new Map<string, { deviceId: string; sessionId: string; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; onPhotoProgress?: (progress: RelayPhotoProgress) => void }>();
  const uploads = new Map<AbortController, { deviceId: string; sessionId: string; code: SdkErrorCode }>();
  const publish = (status: SkyCommandSnapshot['status'], relay: RelayLinkSnapshot | null, error: SkyCommandError | null = null): void => {
    state = deepFreeze({ status, relay, error: error === null ? null : { code: error.code, message: error.message } });
    for (const listener of [...listeners]) { try { listener(state); } catch { /* user subscribers cannot break the transport */ } }
  };
  const finishConnect = (error?: SkyCommandError): void => {
    const current = connecting; connecting = null;
    if (current) { clearTimeout(current.timer); if (error) current.reject(error); else current.resolve(); }
  };
  const cancelRequests = (code: SdkErrorCode): void => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new SkyCommandError(code)); }
    pending.clear();
    for (const [controller, entry] of uploads) { entry.code = code; controller.abort(); }
  };
  const loseConnection = (current: ClientSocket | null, error: SkyCommandError): void => {
    if (current !== socket) return;
    socket = null;
    finishConnect(error); cancelRequests(error.code);
    try { current?.close(); } catch { /* already detached */ }
    if (wanted && !disposed && attempts < maxAttempts) {
      const delay = Math.min(reconnectDelay * 2 ** attempts++, 30000);
      reconnectTimer = setTimeout(() => { reconnectTimer = null; if (wanted && !disposed) void open().catch(() => undefined); }, delay);
      publish('reconnecting', null, error);
    } else { wanted = false; publish(disposed ? 'disposed' : 'disconnected', null, error); }
  };
  const session = (deviceId: string): string => {
    if (disposed) throw new SkyCommandError('DISPOSED');
    if (state.status !== 'connected') throw new SkyCommandError('NOT_CONNECTED');
    const device = state.relay?.devices.find(item => item.deviceId === deviceId);
    if (!validId(deviceId) || !device) throw new SkyCommandError('NOT_CONNECTED', 'Device is not connected');
    return device.sessionId;
  };
  const receive = (current: ClientSocket, data: unknown): void => {
    if (socket !== current) return;
    try {
      if (typeof data !== 'string' || data.length > maxControlBytes) throw new SkyCommandError('PROTOCOL_ERROR');
      const message: unknown = JSON.parse(data);
      if (!isRecord(message) || message.version !== 1) throw new SkyCommandError('PROTOCOL_ERROR');
      if (message.type === 'snapshot') {
        const relay = readRelaySnapshot(message.snapshot);
        const sessions = new Map(relay.devices.map(item => [item.deviceId, item.sessionId]));
        for (const [id, entry] of pending) if (sessions.get(entry.deviceId) !== entry.sessionId) { clearTimeout(entry.timer); pending.delete(id); entry.reject(new SkyCommandError('SESSION_CHANGED')); }
        for (const [controller, entry] of uploads) if (sessions.get(entry.deviceId) !== entry.sessionId) { entry.code = 'SESSION_CHANGED'; controller.abort(); }
        attempts = 0; publish('connected', relay); finishConnect(); return;
      }
      if (message.type === 'progress') {
        if (!validId(message.id)) throw new SkyCommandError('PROTOCOL_ERROR');
        const entry = pending.get(message.id);
        if (!entry) return;
        const progress = readPhotoProgress(message.progress);
        try { entry.onPhotoProgress?.(progress); } catch { /* caller progress cannot break the socket */ }
        return;
      }
      if (message.type !== 'result' || !validId(message.id) || typeof message.ok !== 'boolean') throw new SkyCommandError('PROTOCOL_ERROR');
      const entry = pending.get(message.id);
      if (!entry) return; // Late responses to timed-out requests have no owner.
      pending.delete(message.id); clearTimeout(entry.timer);
      if (message.ok) entry.resolve(message.value);
      else entry.reject(new SkyCommandError(errorCodes.has(message.code as SdkErrorCode) ? message.code as SdkErrorCode : 'PROTOCOL_ERROR'));
    } catch { loseConnection(current, new SkyCommandError('PROTOCOL_ERROR')); }
  };
  const open = (): Promise<void> => {
    if (connecting) return connecting.promise;
    let resolve!: () => void, reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const timer = setTimeout(() => loseConnection(socket, new SkyCommandError('TIMED_OUT')), connectTimeout);
    connecting = { promise, resolve, reject, timer };
    publish(attempts > 0 ? 'reconnecting' : 'connecting', null);
    if (!wanted || disposed || !connecting) return promise;
    try {
      const current = options.socketFactory ? options.socketFactory(url.toString()) : new globalThis.WebSocket(url.toString());
      socket = current;
      current.addEventListener('message', event => receive(current, event.data));
      current.addEventListener('close', () => loseConnection(current, new SkyCommandError('DISCONNECTED')));
      current.addEventListener('error', () => loseConnection(current, new SkyCommandError('DISCONNECTED')));
    } catch { loseConnection(socket, new SkyCommandError('DEPENDENCY_FAILURE', 'WebSocket could not be created')); }
    return promise;
  };
  const rpc = (deviceId: string, method: 'command' | 'probe', request?: CommandRequest, waitMs = requestTimeout, onPhotoProgress?: (progress: RelayPhotoProgress) => void): Promise<unknown> => {
    const sessionId = session(deviceId);
    if (!socket || socket.readyState !== 1) throw new SkyCommandError('NOT_CONNECTED');
    if (pending.size >= 64 || socket.bufferedAmount > maxControlBytes) throw new SkyCommandError('BUSY');
    const id = `sdk-${++sequence}`;
    const message = JSON.stringify({ version: 1, type: 'request', id, deviceId, sessionId, method, ...(request ? { request } : {}) });
    if (message.length > maxControlBytes) throw new SkyCommandError('INVALID_INPUT');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new SkyCommandError('TIMED_OUT')); }, waitMs);
      pending.set(id, { deviceId, sessionId, resolve, reject, timer, ...(onPhotoProgress === undefined ? {} : { onPhotoProgress }) });
      try { socket!.send(message); } catch { clearTimeout(timer); pending.delete(id); reject(new SkyCommandError('DISCONNECTED')); }
    });
  };
  const disconnect = (): void => {
    wanted = false; attempts = 0;
    if (reconnectTimer) clearTimeout(reconnectTimer); reconnectTimer = null;
    const old = socket; socket = null;
    finishConnect(new SkyCommandError(disposed ? 'DISPOSED' : 'DISCONNECTED'));
    cancelRequests(disposed ? 'DISPOSED' : 'DISCONNECTED');
    try { old?.close(); } catch { /* detached socket */ }
    publish(disposed ? 'disposed' : 'disconnected', null);
  };
  return Object.freeze<SkyCommandClient>({
    connect: () => {
      if (disposed) throw new SkyCommandError('DISPOSED');
      if (state.status === 'connected') return Promise.resolve();
      if (reconnectTimer) clearTimeout(reconnectTimer); reconnectTimer = null;
      wanted = true; return open();
    },
    disconnect,
    dispose: () => { if (disposed) return; disposed = true; disconnect(); listeners.clear(); },
    getSnapshot: () => state,
    subscribe: listener => { if (disposed) return () => undefined; listeners.add(listener); return () => { listeners.delete(listener); }; },
    devices: () => state.relay?.devices ?? Object.freeze([]),
    latestTelemetry: deviceId => state.relay?.telemetry.find(item => item.deviceId === deviceId) ?? null,
    sendCommand: async (deviceId, request) => {
      const timeoutMs = request.timeoutMs;
      if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000)) throw new SkyCommandError('INVALID_INPUT');
      const command = { name: request.name, fields: request.fields };
      if (!RelayFrameCodec.encode({ type: 'command', id: 'sdk-validation', command }).ok) throw new SkyCommandError('INVALID_INPUT');
      const wire = timeoutMs === undefined ? command : { ...command, timeoutMs };
      const outcome = readCommandOutcome(await rpc(deviceId, 'command', wire, timeoutMs === undefined ? requestTimeout : Math.max(requestTimeout, timeoutMs), request.onPhotoProgress));
      if (outcome.deviceId !== deviceId) throw new SkyCommandError('PROTOCOL_ERROR');
      return outcome;
    },
    measurePhoneLink: async deviceId => readProbe(await rpc(deviceId, 'probe')),
    sendMission: async (deviceId, payload) => {
      const sessionId = session(deviceId);
      if (!(payload.bytes instanceof Uint8Array) || payload.size !== payload.bytes.byteLength || payload.size > ProtocolLimits.maxMissionBytes || !RelayFrameCodec.encode({ type: 'mission-begin', id: payload.missionId, fileName: payload.fileName, size: payload.size, sha256: payload.sha256 }).ok) throw new SkyCommandError('INVALID_INPUT');
      const target = new URL(url); target.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'; target.pathname = `${url.pathname.replace(/\/$/, '')}/mission`;
      for (const [key, value] of Object.entries({ deviceId, sessionId, missionId: payload.missionId, fileName: payload.fileName, sha256: payload.sha256 })) target.searchParams.set(key, value);
      const controller = new AbortController();
      const entry = { deviceId, sessionId, code: 'TIMED_OUT' as SdkErrorCode }; uploads.set(controller, entry);
      const timer = setTimeout(() => controller.abort(), missionTimeout);
      try {
        const headers = new Headers(await abortable(Promise.resolve(options.uploadHeaders?.()), controller.signal, () => entry.code)); headers.set('Content-Type', 'application/octet-stream');
        if (controller.signal.aborted) throw new SkyCommandError(entry.code);
        const response = await abortable((options.fetch ?? globalThis.fetch)(target, { method: 'POST', body: payload.bytes.slice().buffer, headers, credentials: options.credentials ?? 'same-origin', signal: controller.signal }), controller.signal, () => entry.code);
        const body: unknown = await abortable(response.json(), controller.signal, () => entry.code);
        if (!isRecord(body) || body.version !== 1 || typeof body.ok !== 'boolean') throw new SkyCommandError('PROTOCOL_ERROR');
        if (!response.ok || !body.ok) throw new SkyCommandError(errorCodes.has(body.code as SdkErrorCode) ? body.code as SdkErrorCode : 'DEPENDENCY_FAILURE');
        if (session(deviceId) !== sessionId) throw new SkyCommandError('SESSION_CHANGED');
        const outcome = readMissionOutcome(body.value);
        if (outcome.deviceId !== deviceId || outcome.missionId !== payload.missionId) throw new SkyCommandError('PROTOCOL_ERROR');
        return outcome;
      } catch (error) {
        if (controller.signal.aborted) throw new SkyCommandError(entry.code);
        if (error instanceof SkyCommandError) throw error;
        throw new SkyCommandError('DEPENDENCY_FAILURE');
      } finally { clearTimeout(timer); uploads.delete(controller); }
    }
  });
}
