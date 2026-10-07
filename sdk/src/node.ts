import { randomUUID, createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { NodeWebSocketRelayTransport } from '../../src/adapters/node-websocket-relay/index.js';
import { RelayLink, type RelayLinkInstance, type RelayLinkOptions, type RelayLinkSnapshot } from '../../src/modules/relay-link/index.js';
import { ProtocolLimits, RelayFrameCodec, validate } from '../../src/modules/relay-link/protocol-core/index.js';
import { SkyCommandError, emptyRelaySnapshot, isRecord, validId, type SdkErrorCode } from './shared.js';

export interface SkyCommandRelay extends RelayLinkInstance { getSnapshot(): RelayLinkSnapshot; }
export type SkyCommandRelayOptions = Pick<RelayLinkOptions, 'address' | 'diagnosticSink' | 'onPhoto'> & Partial<Pick<RelayLinkOptions, 'handshakeTimeoutMs' | 'maxConnections' | 'commandTimeoutMs' | 'missionTimeoutMs'>>;
export function createSkyCommandRelay(options: SkyCommandRelayOptions): SkyCommandRelay {
  const relay = RelayLink.create({
    ...options,
    handshakeTimeoutMs: options.handshakeTimeoutMs ?? 10000, maxConnections: options.maxConnections ?? 64,
    commandTimeoutMs: options.commandTimeoutMs ?? 30000, missionTimeoutMs: options.missionTimeoutMs ?? 90000,
    transport: NodeWebSocketRelayTransport.create(),
    scheduler: { setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds), clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    now: Date.now, createConnectionId: randomUUID, createSessionId: () => randomUUID(), createCommandId: randomUUID
  });
  let snapshot = emptyRelaySnapshot;
  relay.subscribe(value => { snapshot = value; });
  return Object.freeze({ ...relay, getSnapshot: () => snapshot });
}

export interface SkyCommandGatewayOptions {
  readonly relay: SkyCommandRelay;
  readonly host?: string;
  readonly port?: number;
  /** Exact browser origins, e.g. http://localhost:5176. No wildcard. */
  readonly allowedOrigins?: readonly string[];
  /** Validate your session/cookie/token and permissions; invoked for WS and uploads. */
  readonly authorize?: (request: IncomingMessage) => boolean | Promise<boolean>;
  readonly maxClients?: number;
  readonly maxConcurrentUploads?: number;
}
export interface SkyCommandGatewayAddress { readonly host: string; readonly port: number; readonly url: string; }
export interface SkyCommandGateway {
  start(): Promise<SkyCommandGatewayAddress>;
  /** Stops the control gateway. Stop the separately owned relay as well on shutdown. */
  stop(): Promise<void>;
}
export const productionCommands = Object.freeze([
  'telemetry.read', 'pairing.status',
  'wayline.upload', 'wayline.start', 'wayline.pause', 'wayline.resume', 'wayline.stop',
  'flight.takeoff', 'flight.land', 'flight.confirm-landing', 'flight.return-home', 'flight.stop-takeoff', 'flight.stop-auto-landing', 'flight.stop-go-home',
  'live-stream.start', 'live-stream.stop',
  'device.settings.transmission.read', 'device.settings.transmission.write', 'device.settings.camera.read', 'device.settings.camera.write',
  'camera.photo.capture', 'camera.photo.fetch'
] as const);
const controlLimit = 4 * 1024 * 1024;

export function createSkyCommandGateway(options: SkyCommandGatewayOptions): SkyCommandGateway {
  const host = options.host ?? '127.0.0.1', port = options.port ?? 8766;
  const maxClients = options.maxClients ?? 32, maxUploads = options.maxConcurrentUploads ?? 4;
  if (!host || !Number.isSafeInteger(port) || port < 0 || port > 65535 || ![maxClients, maxUploads].every(n => Number.isSafeInteger(n) && n > 0)) throw new SkyCommandError('INVALID_INPUT');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !options.authorize) throw new SkyCommandError('INVALID_INPUT', 'A network-exposed control gateway requires authorize');
  const origins = new Set(options.allowedOrigins ?? []);
  for (const origin of origins) if (new URL(origin).origin !== origin || origin === 'null') throw new SkyCommandError('INVALID_INPUT', 'Expected exact allowed origins');
  let server: Server | null = null, wss: WebSocketServer | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;
  let starting: Promise<SkyCommandGatewayAddress> | null = null, stopping: Promise<void> | null = null;
  let address: SkyCommandGatewayAddress | null = null;
  let uploadCount = 0;
  const activeRequests = new Set<IncomingMessage>();
  const pendingUpgrades = new Set<Duplex>();
  const alive = new WeakMap<WebSocket, boolean>();
  const allowed = async (request: IncomingMessage): Promise<boolean> => {
    const origin = request.headers.origin;
    if (origin !== undefined && !origins.has(origin)) return false;
    try { return options.authorize ? await options.authorize(request) === true : true; } catch { return false; }
  };
  const session = (deviceId: unknown, sessionId: unknown): string => {
    if (!validId(deviceId) || !validId(sessionId)) throw new SkyCommandError('INVALID_INPUT');
    if (options.relay.devices().find(item => item.deviceId === deviceId)?.sessionId !== sessionId) throw new SkyCommandError('SESSION_CHANGED');
    return deviceId;
  };
  const send = (socket: WebSocket, value: unknown): void => {
    if (socket.readyState !== WebSocket.OPEN) return;
    const message = JSON.stringify(value);
    if (Buffer.byteLength(message) > controlLimit || socket.bufferedAmount > controlLimit) { socket.close(1013, 'Control client is too slow'); return; }
    socket.send(message, error => { if (error) socket.terminate(); });
  };
  const sendSnapshot = (socket: WebSocket, snapshot: RelayLinkSnapshot): void => send(socket, { version: 1, type: 'snapshot', snapshot });
  const response = (res: ServerResponse, status: number, value: unknown): void => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ version: 1, ...value as object }));
  };
  const handleHttp = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const target = new URL(req.url ?? '/', 'http://gateway');
      if (target.pathname !== '/sdk/mission') { response(res, 404, { ok: false, code: 'INVALID_INPUT' }); return; }
      const origin = req.headers.origin;
      if (origin !== undefined && !origins.has(origin)) { response(res, 403, { ok: false, code: 'FORBIDDEN' }); return; }
      if (origin !== undefined) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Credentials', 'true'); }
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'POST'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); res.writeHead(204); res.end(); return;
      }
      if (!await allowed(req)) { response(res, 403, { ok: false, code: 'FORBIDDEN' }); return; }
      if (req.method !== 'POST' || req.headers['content-type'] !== 'application/octet-stream') throw new SkyCommandError('INVALID_INPUT');
      if (uploadCount >= maxUploads) throw new SkyCommandError('BUSY');
      const deviceId = session(target.searchParams.get('deviceId'), target.searchParams.get('sessionId'));
      const sessionId = target.searchParams.get('sessionId');
      const missionId = target.searchParams.get('missionId') ?? '', fileName = target.searchParams.get('fileName') ?? '', sha256 = target.searchParams.get('sha256') ?? '';
      const declaredSize = Number(req.headers['content-length']);
      if (!validate({ type: 'mission-begin', id: missionId, fileName, sha256, size: 1 }).ok || (!Number.isNaN(declaredSize) && (declaredSize < 1 || declaredSize > ProtocolLimits.maxMissionBytes))) throw new SkyCommandError('INVALID_INPUT');
      uploadCount++; activeRequests.add(req);
      try {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) {
          const bytes = Buffer.from(chunk); size += bytes.length;
          if (size > ProtocolLimits.maxMissionBytes) throw new SkyCommandError('INVALID_INPUT');
          chunks.push(bytes);
        }
        session(deviceId, sessionId);
        const bytes = Buffer.concat(chunks, size);
        if (size === 0 || createHash('sha256').update(bytes).digest('hex') !== sha256) throw new SkyCommandError('INVALID_INPUT');
        const value = await options.relay.sendMission(deviceId, { missionId, fileName, sha256, size, bytes });
        response(res, 200, { ok: true, value });
      } finally { uploadCount--; activeRequests.delete(req); }
    } catch (error) {
      const code = error instanceof SkyCommandError ? error.code : 'DEPENDENCY_FAILURE';
      response(res, code === 'BUSY' ? 429 : code === 'INVALID_INPUT' ? 400 : code === 'SESSION_CHANGED' ? 409 : 500, { ok: false, code });
    }
  };
  const handleClient = (socket: WebSocket): void => {
    alive.set(socket, true); socket.on('pong', () => alive.set(socket, true));
    sendSnapshot(socket, options.relay.getSnapshot());
    const inFlight = new Set<string>();
    socket.on('message', (bytes, binary) => {
      void (async () => {
        let id: string | null = null;
        try {
          if (binary) throw new SkyCommandError('INVALID_INPUT');
          const input: unknown = JSON.parse(bytes.toString());
          if (!isRecord(input) || input.version !== 1 || input.type !== 'request' || !validId(input.id)) throw new SkyCommandError('INVALID_INPUT');
          id = input.id;
          if (inFlight.has(id)) { socket.close(1008, 'Duplicate request'); return; }
          if (inFlight.size >= 64) throw new SkyCommandError('BUSY');
          inFlight.add(id);
          const deviceId = session(input.deviceId, input.sessionId);
          let value: unknown;
          if (input.method === 'command') {
            const request = input.request;
            if (!isRecord(request) || !productionCommands.includes(request.name as never) || !RelayFrameCodec.encode({ type: 'command', id, command: request } as never).ok) throw new SkyCommandError('INVALID_INPUT');
            const command = request as unknown as Parameters<SkyCommandRelay['sendCommand']>[1];
            if ((command.name.startsWith('flight.') || command.name.startsWith('wayline.')) && (command.fields.confirm?.kind !== 'boolean' || command.fields.confirm.value !== true)) throw new SkyCommandError('INVALID_INPUT');
            value = await options.relay.sendCommand(deviceId, command);
          } else if (input.method === 'probe') value = await options.relay.measurePhoneLink(deviceId);
          else throw new SkyCommandError('INVALID_INPUT');
          session(deviceId, input.sessionId);
          send(socket, { version: 1, type: 'result', id, ok: true, value });
        } catch (error) {
          const code: SdkErrorCode = error instanceof SkyCommandError ? error.code : 'DEPENDENCY_FAILURE';
          if (id) send(socket, { version: 1, type: 'result', id, ok: false, code });
          else socket.close(1008, 'Invalid control request');
        } finally { if (id) inFlight.delete(id); }
      })();
    });
  };
  const stop = async (): Promise<void> => {
    if (stopping) return stopping;
    stopping = (async () => {
      if (starting) { try { await starting; } catch { /* failed starts clean themselves up */ } }
      unsubscribe?.(); unsubscribe = null;
      if (heartbeat) clearInterval(heartbeat); heartbeat = null;
      for (const req of activeRequests) req.destroy();
      for (const socket of pendingUpgrades) socket.destroy();
      pendingUpgrades.clear();
      const oldWss = wss, oldServer = server;
      wss = null; server = null; address = null;
      if (oldWss) { for (const socket of oldWss.clients) socket.terminate(); await new Promise<void>(done => oldWss.close(() => done())); }
      if (oldServer) await new Promise<void>(done => { oldServer.close(() => done()); oldServer.closeAllConnections(); });
    })();
    try { await stopping; } finally { stopping = null; }
  };
  return Object.freeze({
    start: () => {
      if (stopping) return Promise.reject(new SkyCommandError('BUSY'));
      if (starting) return starting;
      if (address) return Promise.resolve(address);
      const current = createServer((req, res) => { void handleHttp(req, res); });
      current.requestTimeout = 120000;
      const sockets = new WebSocketServer({ noServer: true, maxPayload: controlLimit });
      server = current; wss = sockets;
      sockets.on('connection', handleClient);
      current.on('upgrade', (req, socket, head) => {
        if (pendingUpgrades.size + sockets.clients.size >= maxClients) { socket.destroy(); return; }
        pendingUpgrades.add(socket);
        socket.once('close', () => pendingUpgrades.delete(socket));
        void (async () => {
          if (new URL(req.url ?? '/', 'http://gateway').pathname !== '/sdk' || !await allowed(req)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
          if (server !== current || sockets.clients.size >= maxClients) { socket.destroy(); return; }
          sockets.handleUpgrade(req, socket, head, connection => sockets.emit('connection', connection, req));
        })().catch(() => socket.destroy()).finally(() => pendingUpgrades.delete(socket));
      });
      starting = new Promise<SkyCommandGatewayAddress>((resolve, reject) => {
        const failed = (): void => { server = null; wss = null; sockets.close(); reject(new SkyCommandError('DEPENDENCY_FAILURE', 'Gateway could not listen')); };
        current.once('error', failed);
        current.listen(port, host, () => {
          current.off('error', failed);
          current.on('error', () => { void stop(); });
          const actual = current.address() as { port: number };
          address = Object.freeze({ host, port: actual.port, url: `ws://${host.includes(':') ? `[${host}]` : host}:${actual.port}/sdk` });
          unsubscribe = options.relay.subscribe(snapshot => { for (const socket of sockets.clients) sendSnapshot(socket, snapshot); });
          heartbeat = setInterval(() => { for (const socket of sockets.clients) { if (alive.get(socket) === false) socket.terminate(); else { alive.set(socket, false); socket.ping(); } } }, 15000);
          resolve(address);
        });
      }).finally(() => { starting = null; });
      return starting;
    }, stop
  });
}

export { RelayLink, NodeWebSocketRelayTransport };
export type { RelayLinkInstance, RelayLinkOptions };
