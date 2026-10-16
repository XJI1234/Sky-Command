import { randomUUID } from "node:crypto";
import { createSocket } from "node:dgram";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

export const DISCOVERY_PORT = 39_082;
export const ANNOUNCEMENT_INTERVAL_MS = 1_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function loadOrCreateServerId(userData: string): string {
  mkdirSync(userData, { recursive: true });
  const path = join(userData, "discovery-server-id");
  try {
    writeFileSync(path, `${randomUUID()}\n`, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const id = readFileSync(path, "utf8").trim();
  if (!uuid.test(id)) throw new Error("Invalid discovery identity");
  return id;
}

export function encodeAnnouncement(serverId: string, instanceId: string, relayPort: number): Buffer {
  if (!uuid.test(serverId) || !uuid.test(instanceId) || !Number.isInteger(relayPort) || relayPort < 1 || relayPort > 65_535) {
    throw new Error("Invalid announcement configuration");
  }
  const bytes = Buffer.from(JSON.stringify({
    kind: "SKY_COMMAND_RELAY_ANNOUNCEMENT", discoveryVersion: 1,
    serverId, instanceId, protocolVersion: "1", relayPort, relayPath: "/relay",
  }), "utf8");
  if (bytes.length > 512) throw new Error("Announcement too large");
  return bytes;
}

export interface DiscoveryAddress { readonly address: string; readonly netmask: string; readonly broadcast: string }
export interface NetworkAddress { readonly family: string | number; readonly address: string; readonly netmask: string; readonly internal: boolean }
export type NetworkSnapshot = Readonly<Record<string, readonly NetworkAddress[] | undefined>>;

const ipv4 = (text: string): number | null => {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(text)) return null;
  const parts = text.split(".").map(Number);
  if (parts.some((part) => part > 255)) return null;
  return parts.reduce((result, part) => ((result << 8) | part) >>> 0, 0);
};
const dotted = (value: number): string => [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");

export function wlanAddresses(interfaces: NetworkSnapshot): readonly DiscoveryAddress[] {
  const result = new Map<string, DiscoveryAddress>();
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!/wi-?fi|wlan|wireless|无线/i.test(name) || /virtual|vmware|vmnet|vbox|vethernet|hyper-v|loopback|docker|wsl|tailscale|tun|vpn|wireguard|clash|mihomo|zerotier|hamachi|radmin/i.test(name)) continue;
    for (const card of addresses ?? []) {
      if (card.internal || (card.family !== "IPv4" && card.family !== 4)) continue;
      const address = ipv4(card.address);
      const mask = ipv4(card.netmask);
      if (address === null || mask === null) continue;
      const first = address >>> 24;
      const second = (address >>> 16) & 255;
      if (!(first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168))) continue;
      const hostMask = (~mask) >>> 0;
      if (mask === 0 || hostMask < 3 || (hostMask & (hostMask + 1)) !== 0) continue;
      const host = (address & hostMask) >>> 0;
      if (host === 0 || host === hostMask) continue;
      result.set(`${card.address}/${card.netmask}`, {
        address: card.address, netmask: card.netmask, broadcast: dotted((address | hostMask) >>> 0),
      });
    }
  }
  return [...result.values()];
}

export interface AnnouncementSocket {
  bind(address: string, ready: () => void): void;
  enableBroadcast(): void;
  send(bytes: Buffer, port: number, destination: string, done: (error: Error | null) => void): void;
  close(): void;
}
export type DiscoveryDiagnostic = "DISCOVERY_NETWORK_UNAVAILABLE" | "DISCOVERY_SOCKET_FAILED" | "DISCOVERY_SEND_FAILED" | "DISCOVERY_INTERFACE_FAILED";
export interface DiscoveryDependencies {
  readonly interfaces: () => NetworkSnapshot;
  readonly socket: (failed: () => void) => AnnouncementSocket;
  readonly repeat: (work: () => void, intervalMs: number) => () => void;
  readonly now: () => number;
  readonly diagnostic: (code: DiscoveryDiagnostic) => void;
}

export const createNodeAnnouncementSocket = (failed: () => void): AnnouncementSocket => {
  const socket = createSocket("udp4");
  socket.on("error", failed);
  return {
    bind: (address, ready) => socket.bind(0, address, ready),
    enableBroadcast: () => socket.setBroadcast(true),
    send: (bytes, port, destination, done) => socket.send(bytes, port, destination, done),
    close: () => socket.close(),
  };
};

interface Channel { readonly card: DiscoveryAddress; socket: AnnouncementSocket | null; ready: boolean }

/** The host starts this only after its relay listener is ready. */
export function createRelayDiscovery(
  serverId: string,
  instanceId: string,
  relayPort: number,
  overrides: Partial<DiscoveryDependencies> = {},
): { start(): void; stop(): void } {
  const bytes = encodeAnnouncement(serverId, instanceId, relayPort);
  const dependencies: DiscoveryDependencies = {
    interfaces: networkInterfaces,
    socket: createNodeAnnouncementSocket,
    repeat: (work, delay) => { const timer = setInterval(work, delay); return () => clearInterval(timer); },
    now: () => performance.now(), diagnostic: () => undefined, ...overrides,
  };
  const channels = new Map<string, Channel>();
  const diagnostics = new Map<DiscoveryDiagnostic, number>();
  let started = false;
  let stopped = false;
  let cancel: (() => void) | null = null;
  const key = (card: DiscoveryAddress): string => `${card.address}/${card.netmask}`;
  const current = (channel: Channel): boolean => !stopped && channels.get(key(channel.card)) === channel;
  const report = (code: DiscoveryDiagnostic): void => {
    const now = dependencies.now();
    const last = diagnostics.get(code);
    if (last !== undefined && now - last < 30_000) return;
    diagnostics.set(code, now);
    try { dependencies.diagnostic(code); } catch { /* Diagnostics never block discovery. */ }
  };
  const discard = (channel: Channel): void => {
    if (channels.get(key(channel.card)) === channel) channels.delete(key(channel.card));
    channel.ready = false;
    try { channel.socket?.close(); } catch { /* An unbound or failed socket may already be closed. */ }
  };
  const fail = (channel: Channel, code: DiscoveryDiagnostic): void => {
    if (!current(channel)) return;
    discard(channel);
    report(code);
  };
  const send = (channel: Channel): void => {
    for (const destination of new Set([channel.card.broadcast, "255.255.255.255"])) {
      if (!current(channel) || !channel.ready) return;
      try {
        channel.socket?.send(bytes, DISCOVERY_PORT, destination, (error) => {
          if (error !== null) fail(channel, "DISCOVERY_SEND_FAILED");
        });
      } catch { fail(channel, "DISCOVERY_SEND_FAILED"); }
    }
  };
  const tick = (): void => {
    if (stopped) return;
    let cards: readonly DiscoveryAddress[];
    try { cards = wlanAddresses(dependencies.interfaces()); }
    catch { report("DISCOVERY_INTERFACE_FAILED"); return; }
    const available = new Set(cards.map(key));
    for (const channel of channels.values()) if (!available.has(key(channel.card))) discard(channel);
    if (cards.length === 0) report("DISCOVERY_NETWORK_UNAVAILABLE");
    for (const card of cards) {
      const previous = channels.get(key(card));
      if (previous !== undefined) { if (previous.ready) send(previous); continue; }
      const channel: Channel = { card, socket: null, ready: false };
      channels.set(key(card), channel);
      try {
        channel.socket = dependencies.socket(() => fail(channel, "DISCOVERY_SOCKET_FAILED"));
        channel.socket.bind(card.address, () => {
          if (!current(channel)) return;
          try {
            channel.socket?.enableBroadcast();
            channel.ready = true;
            send(channel);
          } catch { fail(channel, "DISCOVERY_SOCKET_FAILED"); }
        });
      } catch { fail(channel, "DISCOVERY_SOCKET_FAILED"); }
    }
  };
  return {
    start: () => {
      if (started || stopped) return;
      started = true;
      cancel = dependencies.repeat(tick, ANNOUNCEMENT_INTERVAL_MS);
      tick();
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      cancel?.();
      cancel = null;
      for (const channel of channels.values()) discard(channel);
    },
  };
}
