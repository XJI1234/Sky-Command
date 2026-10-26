import { describe, expect, it, vi } from 'vitest';
import { createSkyCommandClient, type ClientSocket } from '../src/client.js';
import { emptyRelaySnapshot } from '../src/shared.js';
import { jsonFields } from '../src/json.js';

class Socket implements ClientSocket {
  readyState = 1; bufferedAmount = 0;
  sent: string[] = [];
  listeners = new Map<string, ((event: any) => void)[]>();
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; this.emit('close', {}); }
  addEventListener(type: string, callback: (event: any) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]); }
  emit(type: string, event: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  message(value: unknown) { this.emit('message', { data: JSON.stringify(value) }); }
}
const relay = { ...emptyRelaySnapshot, state: 'listening', devices: [{ deviceId: 'phone', sessionId: 'session' }] };

describe('client lifecycle', () => {
  it('waits for validated snapshot, correlates RPC and clears stale devices on disconnect', async () => {
    const socket = new Socket();
    const client = createSkyCommandClient({ url: 'ws://localhost:9000/sdk', socketFactory: () => socket, reconnect: false });
    const ready = client.connect();
    expect(client.connect()).toBe(ready);
    socket.message({ version: 1, type: 'snapshot', snapshot: relay });
    await ready;
    const outcome = client.sendCommand('phone', { name: 'telemetry.read', fields: jsonFields({}) });
    const request = JSON.parse(socket.sent[0]!);
    expect(request.sessionId).toBe('session');
    socket.message({ version: 1, type: 'result', id: request.id, ok: true, value: { deviceId: 'phone', commandId: 'cmd', status: 'succeeded', detail: '' } });
    expect((await outcome).status).toBe('succeeded');
    const pending = client.measurePhoneLink('phone');
    const rejected = expect(pending).rejects.toMatchObject({ code: 'DISCONNECTED' });
    socket.close();
    await rejected;
    expect(client.devices()).toEqual([]);
    client.dispose();
    expect(() => client.connect()).toThrow();
  });
  it('does not retry an action after its response times out', async () => {
    vi.useFakeTimers();
    try {
      const socket = new Socket();
      const client = createSkyCommandClient({ url: 'ws://localhost/sdk', socketFactory: () => socket, requestTimeoutMs: 50, reconnect: false });
      const ready = client.connect(); socket.message({ version: 1, type: 'snapshot', snapshot: relay }); await ready;
      const request = client.sendCommand('phone', { name: 'telemetry.read', fields: jsonFields({}) });
      const rejected = expect(request).rejects.toMatchObject({ code: 'TIMED_OUT' });
      await vi.advanceTimersByTimeAsync(51); await rejected;
      expect(socket.sent).toHaveLength(1);
      client.dispose();
    } finally { vi.useRealTimers(); }
  });
  it('rejects malformed snapshots and isolates subscriber exceptions', async () => {
    const socket = new Socket();
    const client = createSkyCommandClient({ url: 'ws://localhost/sdk', socketFactory: () => socket, reconnect: false });
    client.subscribe(() => { throw new Error('subscriber'); });
    const ready = client.connect();
    const rejected = expect(ready).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
    socket.message({ version: 1, type: 'snapshot', snapshot: { ...relay, telemetry: [{}] } });
    await rejected;
    expect(client.devices()).toEqual([]);
    client.dispose();
  });
  it('reconnects with a new socket and never replays old requests or accepts old snapshots', async () => {
    vi.useFakeTimers();
    try {
      const sockets = [new Socket(), new Socket()]; let index = 0;
      const client = createSkyCommandClient({ url: 'ws://localhost/sdk', socketFactory: () => sockets[index++]!, reconnect: { delayMs: 10, maxAttempts: 1 } });
      const ready = client.connect(); sockets[0]!.message({ version: 1, type: 'snapshot', snapshot: relay }); await ready;
      const request = client.measurePhoneLink('phone'); const rejected = expect(request).rejects.toMatchObject({ code: 'DISCONNECTED' });
      sockets[0]!.close(); await rejected;
      expect(client.getSnapshot().status).toBe('reconnecting');
      await vi.advanceTimersByTimeAsync(10);
      sockets[1]!.message({ version: 1, type: 'snapshot', snapshot: { ...relay, devices: [{ deviceId: 'phone', sessionId: 'new-session' }] } });
      await vi.advanceTimersByTimeAsync(0);
      expect(client.devices()[0]?.sessionId).toBe('new-session');
      sockets[0]!.message({ version: 1, type: 'snapshot', snapshot: relay });
      expect(client.devices()[0]?.sessionId).toBe('new-session');
      expect(sockets[1]!.sent).toEqual([]); client.dispose();
    } finally { vi.useRealTimers(); }
  });
  it('ends old-session requests even while the gateway connection stays open', async () => {
    const socket = new Socket();
    const client = createSkyCommandClient({ url: 'ws://localhost/sdk', socketFactory: () => socket, reconnect: false });
    const ready = client.connect(); socket.message({ version: 1, type: 'snapshot', snapshot: relay }); await ready;
    const request = client.measurePhoneLink('phone'); const rejected = expect(request).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    socket.message({ version: 1, type: 'snapshot', snapshot: { ...relay, devices: [{ deviceId: 'phone', sessionId: 'replacement' }] } });
    await rejected; expect(client.getSnapshot().status).toBe('connected'); client.dispose();
  });
  it('does not leak a socket if a subscriber disconnects during connect', async () => {
    const factory = vi.fn(() => new Socket());
    const client = createSkyCommandClient({ url: 'ws://localhost/sdk', socketFactory: factory, reconnect: false });
    client.subscribe(snapshot => { if (snapshot.status === 'connecting') client.disconnect(); });
    await expect(client.connect()).rejects.toMatchObject({ code: 'DISCONNECTED' });
    expect(factory).not.toHaveBeenCalled(); client.dispose();
  });
  it('aborts mission upload on a device session change', async () => {
    const socket = new Socket();
    const fetcher = vi.fn((_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const client = createSkyCommandClient({ url: 'ws://localhost/sdk', socketFactory: () => socket, fetch: fetcher as typeof fetch, reconnect: false });
    const ready = client.connect(); socket.message({ version: 1, type: 'snapshot', snapshot: relay }); await ready;
    const uploading = client.sendMission('phone', { missionId: 'mission', fileName: 'route.kmz', bytes: new Uint8Array([1]), size: 1, sha256: '0'.repeat(64) });
    const rejected = expect(uploading).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    socket.message({ version: 1, type: 'snapshot', snapshot: emptyRelaySnapshot });
    await rejected; client.dispose();
  });
  it('rejects telemetry without an active owning device session', async () => {
    const socket = new Socket();
    const client = createSkyCommandClient({ url: 'ws://localhost/sdk', socketFactory: () => socket, reconnect: false });
    const ready = client.connect(); const rejected = expect(ready).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
    socket.message({ version: 1, type: 'snapshot', snapshot: { ...emptyRelaySnapshot, telemetry: [{ deviceId: 'unknown', payload: { kind: 'object', fields: {} }, capabilities: { kind: 'object', fields: {} }, receivedAtMs: 1 }] } });
    await rejected; client.dispose();
  });
  it('forwards photo progress without putting the callback on the wire', async () => {
    const socket = new Socket();
    const client = createSkyCommandClient({ url: 'ws://localhost/sdk', socketFactory: () => socket, reconnect: false });
    const ready = client.connect(); socket.message({ version: 1, type: 'snapshot', snapshot: relay }); await ready;
    const seen: unknown[] = [];
    const outcome = client.sendCommand('phone', { name: 'camera.photo.fetch', fields: jsonFields({}), timeoutMs: 60000, onPhotoProgress: progress => seen.push(progress) });
    const request = JSON.parse(socket.sent[0]!);
    expect(request.request.timeoutMs).toBe(60000);
    expect(request.request.onPhotoProgress).toBeUndefined();
    socket.message({ version: 1, type: 'progress', id: request.id, progress: { stage: 'listing', photoIndex: 0, completedCount: 0, fileName: null, transferredBytes: 0, totalBytes: null } });
    expect(seen).toEqual([{ stage: 'listing', photoIndex: 0, completedCount: 0, fileName: null, transferredBytes: 0, totalBytes: null }]);
    socket.message({ version: 1, type: 'result', id: request.id, ok: true, value: { deviceId: 'phone', commandId: 'cmd', status: 'succeeded', detail: '' } });
    expect((await outcome).status).toBe('succeeded');
    client.dispose();
  });
  it('drops the socket when photo progress is malformed', async () => {
    const socket = new Socket();
    const client = createSkyCommandClient({ url: 'ws://localhost/sdk', socketFactory: () => socket, reconnect: false });
    const ready = client.connect(); socket.message({ version: 1, type: 'snapshot', snapshot: relay }); await ready;
    const outcome = client.sendCommand('phone', { name: 'camera.photo.fetch', fields: jsonFields({}) });
    const rejected = expect(outcome).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
    const request = JSON.parse(socket.sent[0]!);
    socket.message({ version: 1, type: 'progress', id: request.id, progress: { stage: 'listing', photoIndex: 1, completedCount: 0, fileName: null, transferredBytes: 0, totalBytes: null } });
    await rejected;
    expect(client.getSnapshot().status).toBe('disconnected');
    client.dispose();
  });
  it('bounds the entire upload lifetime even when a credential provider stalls', async () => {
    vi.useFakeTimers();
    try {
      const socket = new Socket(), fetcher = vi.fn();
      const client = createSkyCommandClient({ url: 'ws://localhost/sdk', socketFactory: () => socket, reconnect: false, missionTimeoutMs: 50,
        uploadHeaders: () => new Promise<HeadersInit>(() => undefined), fetch: fetcher as typeof fetch });
      const ready = client.connect(); socket.message({ version: 1, type: 'snapshot', snapshot: relay }); await ready;
      const upload = client.sendMission('phone', { missionId: 'mission', fileName: 'route.kmz', bytes: new Uint8Array([1]), size: 1, sha256: '0'.repeat(64) });
      const rejected = expect(upload).rejects.toMatchObject({ code: 'TIMED_OUT' });
      await vi.advanceTimersByTimeAsync(51); await rejected;
      expect(fetcher).not.toHaveBeenCalled(); client.dispose();
    } finally { vi.useRealTimers(); }
  });
});
