import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createSkyCommandGateway, createSkyCommandRelay } from '../src/node.js';
import { createSkyCommandClient, type ClientSocket } from '../src/client.js';
import { jsonFields } from '../src/json.js';
import { RelayFrameCodec, type RelayFrame } from '../../src/modules/relay-link/protocol-core/index.js';
import { sha256 } from '@noble/hashes/sha2.js';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const freePort = async () => { const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = (server.address() as { port: number }).port; await new Promise<void>(done => server.close(() => done())); return port; };
async function setup() {
  const port = await freePort();
  const relay = createSkyCommandRelay({ address: { host: '127.0.0.1', port }, commandTimeoutMs: 200 });
  cleanups.push(() => relay.stop());
  expect((await relay.start()).ok).toBe(true);
  const gateway = createSkyCommandGateway({ relay, port: 0 });
  const address = await gateway.start(); cleanups.push(() => gateway.stop());
  const phone = new WebSocket(`ws://127.0.0.1:${port}/relay`);
  cleanups.push(() => { phone.terminate(); });
  const frames: RelayFrame[] = [];
  phone.on('message', data => {
    const decoded = RelayFrameCodec.decode(new Uint8Array(data as Buffer));
    if (decoded.kind === 'decoded') frames.push(decoded.frame);
  });
  await once(phone, 'open');
  const send = (frame: RelayFrame) => { const encoded = RelayFrameCodec.encode(frame); if (!encoded.ok) throw new Error(encoded.error.code); phone.send(encoded.value); };
  send({ type: 'hello', deviceId: 'android', protocolVersion: '1' });
  await expect.poll(() => frames.some(frame => frame.type === 'paired')).toBe(true);
  const client = createSkyCommandClient({ url: address.url, socketFactory: url => new WebSocket(url) as unknown as ClientSocket, reconnect: false });
  cleanups.push(() => client.dispose()); await client.connect();
  return { relay, gateway, address, phone, client, frames, send };
}
describe('real Android → relay → SDK integration', () => {
  it('handshakes, publishes telemetry and associates command results', async () => {
    const { client, frames, send } = await setup();
    expect(client.devices()[0]?.deviceId).toBe('android');
    send({ type: 'telemetry', payload: { kind: 'object', fields: jsonFields({ battery: 87 }) }, capabilities: { kind: 'object', fields: jsonFields({ 'telemetry.read': true }) } });
    await expect.poll(() => client.latestTelemetry('android')).not.toBe(null);
    const command = client.sendCommand('android', { name: 'telemetry.read', fields: jsonFields({}) });
    await expect.poll(() => frames.find(frame => frame.type === 'command')).toBeDefined();
    const frame = frames.find(frame => frame.type === 'command')!;
    if (frame.type !== 'command') throw new Error('Missing command');
    send({ type: 'command-result', id: frame.id, ok: true, detail: 'read' });
    expect(await command).toMatchObject({ deviceId: 'android', commandId: frame.id, status: 'succeeded' });
    await expect(client.sendCommand('android', { name: 'flight.takeoff', fields: jsonFields({}) })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('transfers binary mission bytes through the original chunk protocol', async () => {
    const { client, frames, send } = await setup();
    const bytes = new Uint8Array(300000).fill(42);
    const hash = Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
    const mission = client.sendMission('android', { missionId: 'mission', fileName: 'route.kmz', bytes, size: bytes.length, sha256: hash });
    await expect.poll(() => frames.some(frame => frame.type === 'mission-complete')).toBe(true);
    const chunks = frames.flatMap(frame => frame.type === 'mission-chunk' ? [frame.data] : []);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(bytes));
    send({ type: 'mission-result', id: 'mission', ok: true, detail: 'stored' });
    expect((await mission).status).toBe('succeeded');
  });
  it('removes old telemetry and cancels pending commands when the phone disconnects', async () => {
    const { client, phone } = await setup();
    const command = client.sendCommand('android', { name: 'telemetry.read', fields: jsonFields({}) });
    const rejected = expect(command).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    phone.terminate(); await rejected;
    expect(client.devices()).toEqual([]);
  });
  it('blocks cross-origin uploads and unauthorized control connections', async () => {
    const relay = createSkyCommandRelay({ address: { host: '127.0.0.1', port: await freePort() } });
    cleanups.push(() => relay.stop());
    const gateway = createSkyCommandGateway({ relay, port: 0, authorize: () => false });
    const address = await gateway.start(); cleanups.push(() => gateway.stop());
    const denied = await fetch(address.url.replace('ws:', 'http:') + '/mission', { method: 'POST', headers: { Origin: 'https://other.example' } });
    expect(denied.status).toBe(403);
    const client = createSkyCommandClient({ url: address.url, reconnect: false, socketFactory: url => new WebSocket(url) as unknown as ClientSocket });
    cleanups.push(() => client.dispose());
    await expect(client.connect()).rejects.toMatchObject({ code: 'DISCONNECTED' });
  });
  it('rejects old session control requests and invalid mission digests before forwarding bytes', async () => {
    const { address, client, frames } = await setup();
    const socket = new WebSocket(address.url); cleanups.push(() => { socket.terminate(); });
    await once(socket, 'message');
    const response = once(socket, 'message');
    socket.send(JSON.stringify({ version: 1, type: 'request', id: 'old-session', method: 'probe', deviceId: 'android', sessionId: 'previous' }));
    expect(JSON.parse((await response)[0].toString())).toMatchObject({ ok: false, code: 'SESSION_CHANGED' });
    await expect(client.sendMission('android', { missionId: 'bad-hash', fileName: 'route.kmz', size: 3, bytes: new Uint8Array([1, 2, 3]), sha256: '0'.repeat(64) })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(frames.some(frame => frame.type === 'mission-begin')).toBe(false);
  });
  it('closes sockets still awaiting async authorization during shutdown', async () => {
    const relay = createSkyCommandRelay({ address: { host: '127.0.0.1', port: await freePort() } });
    const authorize = new Promise<boolean>(() => undefined);
    let entered!: () => void;
    const authorizing = new Promise<void>(resolve => { entered = resolve; });
    const gateway = createSkyCommandGateway({ relay, port: 0, authorize: () => { entered(); return authorize; } });
    const address = await gateway.start(); cleanups.push(() => gateway.stop());
    const socket = new WebSocket(address.url); socket.on('error', () => undefined); cleanups.push(() => { socket.terminate(); });
    const closed = new Promise<void>(resolve => socket.once('close', () => resolve()));
    await authorizing;
    await gateway.stop(); await closed;
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });
});
