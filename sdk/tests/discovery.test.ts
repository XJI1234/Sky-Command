import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createRelayDiscovery, loadOrCreateServerId } from '../src/entries/desktop.js';
import { createRelayDiscovery as createNodeDiscovery } from '../src/node.js';

it('exposes persistent discovery identity and broadcaster lifecycle through Node-only SDK entries', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sky-sdk-discovery-'));
  try {
    const serverId = loadOrCreateServerId(directory);
    expect(loadOrCreateServerId(directory)).toBe(serverId);
    expect(createNodeDiscovery).toBe(createRelayDiscovery);
    const sent: Array<{ announcement: { serverId: string; relayPort: number }; port: number }> = [];
    let closed = 0, cancelled = 0;
    const discovery = createRelayDiscovery(serverId, '22222222-2222-4222-8222-222222222222', 8080, {
      queries: () => () => undefined,
      interfaces: () => ({ 'Wi-Fi': [{ family: 'IPv4', address: '192.168.1.20', netmask: '255.255.255.0', internal: false }] }),
      socket: () => ({
        bind: (_address, ready) => ready(), enableBroadcast: () => undefined,
        send: (bytes, port, _destination, done) => { sent.push({ announcement: JSON.parse(bytes.toString()), port }); done(null); },
        close: () => { closed++; },
      }),
      repeat: () => () => { cancelled++; },
    });
    discovery.start();
    expect(sent).toHaveLength(2);
    expect(sent.every(item => item.port === 39082 && item.announcement.serverId === serverId && item.announcement.relayPort === 8080)).toBe(true);
    discovery.stop();
    discovery.stop();
    expect(closed).toBe(1);
    expect(cancelled).toBe(1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
