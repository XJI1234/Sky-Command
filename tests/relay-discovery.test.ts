import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSocket } from "node:dgram";
import { afterEach, describe, expect, it } from "vitest";
import {
  createNodeAnnouncementSocket, createRelayDiscovery, DISCOVERY_PORT, encodeAnnouncement, loadOrCreateServerId, wlanAddresses,
} from "../src/production/relay-discovery/index.js";
import type { AnnouncementSocket, DiscoveryDiagnostic, NetworkSnapshot } from "../src/production/relay-discovery/index.js";

const server = "11111111-1111-4111-8111-111111111111";
const instance = "22222222-2222-4222-8222-222222222222";
const card = (address = "10.20.168.217", netmask = "255.255.192.0") => ({ family: "IPv4", address, netmask, internal: false });

class FakeSocket implements AnnouncementSocket {
  address = "";
  ready: () => void = () => undefined;
  closed = 0;
  broadcast = false;
  bindThrows = false;
  sendThrows = false;
  broadcastThrows = false;
  sent: { bytes: Buffer; port: number; destination: string; done: (error: Error | null) => void }[] = [];
  constructor(readonly failed: () => void) {}
  bind(address: string, ready: () => void): void {
    if (this.bindThrows) throw new Error("bind");
    this.address = address; this.ready = ready;
  }
  enableBroadcast(): void { if (this.broadcastThrows) throw new Error("broadcast"); this.broadcast = true; }
  send(bytes: Buffer, port: number, destination: string, done: (error: Error | null) => void): void {
    if (this.sendThrows) throw new Error("send");
    this.sent.push({ bytes, port, destination, done });
  }
  close(): void { this.closed++; }
}

function harness() {
  let interfaces: NetworkSnapshot = { "Wi-Fi": [card()] };
  let now = 0;
  let work: () => void = () => undefined;
  let schedules = 0;
  let cancellations = 0;
  let configure: (socket: FakeSocket) => void = () => undefined;
  const sockets: FakeSocket[] = [];
  const diagnostics: DiscoveryDiagnostic[] = [];
  let query: (bytes: Buffer, address: string, port: number) => void = () => undefined;
  let queryClosed = 0;
  let queryFailed: () => void = () => undefined;
  let queryStarts = 0;
  const discovery = createRelayDiscovery(server, instance, 8080, {
    queries: (receive, failed) => { queryStarts++; query = receive; queryFailed = failed; return () => { queryClosed++; }; },
    interfaces: () => interfaces,
    now: () => now,
    repeat: (callback, delay) => { expect(delay).toBe(1000); work = callback; schedules++; return () => { cancellations++; }; },
    socket: (failed) => { const socket = new FakeSocket(failed); configure(socket); sockets.push(socket); return socket; },
    diagnostic: (code) => { diagnostics.push(code); },
  });
  return {
    discovery, sockets, diagnostics, query: (bytes: Buffer, address: string, port = DISCOVERY_PORT) => query(bytes, address, port),
    queryCloses: () => queryClosed,
    queryFailure: () => queryFailed, queryStarts: () => queryStarts,
    tick: () => { now += 1000; work(); },
    network: (next: NetworkSnapshot) => { interfaces = next; },
    configure: (next: (socket: FakeSocket) => void) => { configure = next; },
    counts: () => ({ schedules, cancellations }),
  };
}

describe("relay announcement contract", () => {
  it("encodes the shared UTF-8 fixture within the datagram limit", () => {
    const bytes = encodeAnnouncement(server, instance, 8080);
    expect(bytes.length).toBeLessThanOrEqual(512);
    expect(bytes.toString("utf8")).toBe('{"kind":"SKY_COMMAND_RELAY_ANNOUNCEMENT","discoveryVersion":1,"serverId":"11111111-1111-4111-8111-111111111111","instanceId":"22222222-2222-4222-8222-222222222222","protocolVersion":"1","relayPort":8080,"relayPath":"/relay"}');
    for (const port of [0, -1, 65536, 1.5, NaN]) expect(() => encodeAnnouncement(server, instance, port)).toThrow();
    expect(() => encodeAnnouncement("not-an-id", instance, 8080)).toThrow();
    expect(() => encodeAnnouncement(server, "not-an-id", 8080)).toThrow();
  });

  it("calculates the real subnet broadcast and filters non-WLAN/non-host addresses", () => {
    const good = card();
    expect(wlanAddresses({ "Wi-Fi": [good, good, card("192.168.42.12", "255.255.255.0")] })).toEqual([
      { address: good.address, netmask: good.netmask, broadcast: "10.20.191.255" },
      { address: "192.168.42.12", netmask: "255.255.255.0", broadcast: "192.168.42.255" },
    ]);
    for (const name of ["Ethernet", "Tailscale", "Virtual Wi-Fi", "VPN WLAN", "vEthernet Wireless"]) {
      expect(wlanAddresses({ [name]: [good] })).toEqual([]);
    }
    for (const invalid of [
      { ...good, internal: true }, { ...good, family: "IPv6" }, card("100.64.1.2"),
      card("127.0.0.1"), card("10.20.01.2"), card("10.20.300.1"), card("10.20.191.255"),
      card("10.20.128.0"), card("10.20.1.2", "255.0.255.0"), card("10.20.1.2", "0.0.0.0"),
      card("10.20.1.2", "255.255.255.254"), card("10.20.1.2", "255.255.255.255"),
    ]) expect(wlanAddresses({ WLAN: [invalid] })).toEqual([]);
    expect(wlanAddresses({ 无线网络: [{ ...good, family: 4 }] })).toHaveLength(1);
  });
});

describe("relay discovery ownership", () => {
  const request = Buffer.from("SKY_COMMAND_RELAY_DISCOVER_V1", "ascii");
  it("replies to a local discovery request by unicast and retains all candidates", () => {
    const h = harness(); h.discovery.start(); h.sockets[0]!.ready();
    h.query(request, "10.20.168.99");
    expect(h.sockets[0]!.sent.at(-1)).toMatchObject({ destination: "10.20.168.99", port: DISCOVERY_PORT });
    expect(h.sockets[0]!.sent.at(-1)!.bytes).toEqual(encodeAnnouncement(server, instance, 8080));
    h.query(request, "10.20.168.100");
    expect(h.sockets[0]!.sent.at(-1)!.destination).toBe("10.20.168.100");
    h.discovery.stop(); h.query(request, "10.20.168.101");
    expect(h.queryCloses()).toBe(1);
    expect(h.sockets[0]!.sent).toHaveLength(4);
  });
  it("bounds replies and ignores malformed, off-subnet, non-host and arbitrary-port requests", () => {
    const h = harness(); h.discovery.start(); h.sockets[0]!.ready();
    for (const source of ["127.0.0.1", "10.21.1.2", "10.20.128.0", "10.20.191.255", "255.255.255.255"]) h.query(request, source);
    h.query(Buffer.concat([request, Buffer.from("x")]), "10.20.168.99");
    h.query(request, "10.20.168.99", 1234);
    expect(h.sockets[0]!.sent).toHaveLength(2);
    for (let index = 0; index < 100; index++) h.query(request, `10.20.168.${index + 1}`);
    expect(h.sockets[0]!.sent).toHaveLength(34);
    h.query(request, "10.20.168.1");
    expect(h.sockets[0]!.sent).toHaveLength(34);
    h.tick(); h.query(request, "10.20.168.1");
    expect(h.sockets[0]!.sent.at(-1)!.destination).toBe("10.20.168.1");
  });
  it("recovers the query listener independently and ignores its retired callbacks", () => {
    const h = harness(); h.discovery.start(); h.sockets[0]!.ready();
    const failed = h.queryFailure(); failed();
    expect(h.queryCloses()).toBe(1);
    expect(h.diagnostics).toEqual(["DISCOVERY_QUERY_FAILED"]);
    h.tick(); failed();
    expect(h.queryStarts()).toBe(2);
    expect(h.sockets).toHaveLength(1);
    h.query(request, "10.20.168.99");
    expect(h.sockets[0]!.sent.at(-1)!.destination).toBe("10.20.168.99");
    h.discovery.stop(); h.queryFailure()();
    expect(h.queryCloses()).toBe(2);
  });
  it("waits for bind readiness, then repeats both targets without additional sockets", () => {
    const h = harness(); h.discovery.start(); h.discovery.start();
    const socket = h.sockets[0]!;
    h.tick(); expect(socket.sent).toHaveLength(0);
    socket.ready(); expect(socket.broadcast).toBe(true);
    expect(socket.sent.map((sent) => [sent.destination, sent.port])).toEqual([
      ["10.20.191.255", DISCOVERY_PORT], ["255.255.255.255", DISCOVERY_PORT],
    ]);
    h.tick(); expect(socket.sent).toHaveLength(4); expect(h.sockets).toHaveLength(1);
    expect(h.counts().schedules).toBe(1);
    expect(socket.sent.every((sent) => sent.bytes.equals(encodeAnnouncement(server, instance, 8080)))).toBe(true);
    h.discovery.stop(); h.discovery.stop(); h.discovery.start(); h.tick(); socket.ready(); socket.failed();
    expect(socket.closed).toBe(1); expect(socket.sent).toHaveLength(4);
    expect(h.counts().cancellations).toBe(1); expect(h.diagnostics).toEqual([]);
  });

  it("replaces address/mask owners and ignores their late callbacks", () => {
    const h = harness(); h.discovery.start(); const old = h.sockets[0]!;
    h.network({ "Wi-Fi": [card("10.20.168.218")] }); h.tick();
    expect(old.closed).toBe(1); old.ready(); old.failed(); expect(old.sent).toEqual([]);
    const next = h.sockets[1]!; next.ready();
    h.network({ WLAN: [card("10.20.168.218", "255.255.255.0")] }); h.tick();
    expect(next.closed).toBe(1);
    next.sent[0]!.done(new Error("late send error"));
    const changedMask = h.sockets[2]!; changedMask.ready();
    expect(changedMask.sent[0]!.destination).toBe("10.20.168.255");
    expect(h.diagnostics).toEqual([]); h.discovery.stop();
  });

  it("waits with no WLAN, limits diagnostics, and recovers on the next network snapshot", () => {
    const h = harness(); h.network({}); h.discovery.start();
    for (let index = 0; index < 29; index++) h.tick();
    expect(h.diagnostics).toEqual(["DISCOVERY_NETWORK_UNAVAILABLE"]);
    h.tick(); expect(h.diagnostics).toHaveLength(2); expect(h.sockets).toEqual([]);
    h.network({ "Wi-Fi": [card()] }); h.tick(); expect(h.sockets).toHaveLength(1);
    h.sockets[0]!.ready(); h.network({}); h.tick(); expect(h.sockets[0]!.closed).toBe(1);
    h.discovery.stop();
  });

  it("retries synchronous bind/broadcast/send failures without terminating the host", () => {
    for (const failure of ["bindThrows", "broadcastThrows", "sendThrows"] as const) {
      const h = harness(); h.configure((socket) => { socket[failure] = true; });
      h.discovery.start(); if (failure !== "bindThrows") h.sockets[0]!.ready();
      expect(h.sockets[0]!.closed).toBe(1); expect(h.diagnostics).toHaveLength(1);
      h.configure(() => undefined); h.tick(); h.sockets[1]!.ready();
      expect(h.sockets[1]!.sent).toHaveLength(2); h.discovery.stop();
    }
  });

  it("recovers from asynchronous socket and send errors, suppressing stale errors", () => {
    const h = harness(); h.discovery.start(); const failed = h.sockets[0]!; failed.failed(); failed.ready();
    h.tick(); const sender = h.sockets[1]!; sender.ready();
    sender.sent[0]!.done(new Error("failed")); sender.sent[1]!.done(new Error("same failure"));
    expect(sender.closed).toBe(1); h.tick(); h.sockets[2]!.ready();
    expect(h.diagnostics).toEqual(["DISCOVERY_SOCKET_FAILED", "DISCOVERY_SEND_FAILED"]);
    h.discovery.stop(); h.sockets[2]!.sent[0]!.done(new Error("stopped"));
    expect(h.diagnostics).toHaveLength(2);
  });

  it("maintains independent sockets for multiple WLAN addresses and stop-before-start is final", () => {
    const h = harness(); h.network({ WLAN: [card(), card("192.168.1.2", "255.255.255.0")] });
    h.discovery.start(); h.sockets.forEach((socket) => socket.ready());
    expect(h.sockets).toHaveLength(2); h.discovery.stop();
    expect(h.sockets.map((socket) => socket.closed)).toEqual([1, 1]);
    const unused = harness(); unused.discovery.stop(); unused.discovery.start();
    expect(unused.sockets).toEqual([]); expect(unused.counts().schedules).toBe(0);
  });

  it("contains interface enumeration, socket creation and diagnostic failures", () => {
    let tick: () => void = () => undefined;
    let networkFails = true;
    let socketFails = true;
    let closes = 0;
    const sockets: FakeSocket[] = [];
    const discovery = createRelayDiscovery(server, instance, 8080, {
      queries: () => () => undefined,
      interfaces: () => { if (networkFails) throw new Error("interfaces"); return { WLAN: [card()] }; },
      socket: (failed) => {
        if (socketFails) throw new Error("create");
        const socket = new FakeSocket(failed); sockets.push(socket);
        socket.close = () => { closes++; throw new Error("close"); };
        return socket;
      },
      repeat: (work) => { tick = work; return () => undefined; },
      diagnostic: () => { throw new Error("diagnostic"); },
    });
    expect(() => discovery.start()).not.toThrow();
    networkFails = false; expect(tick).not.toThrow();
    socketFails = false; tick(); sockets[0]!.ready(); expect(sockets[0]!.sent).toHaveLength(2);
    expect(() => discovery.stop()).not.toThrow(); tick();
    expect(closes).toBe(1); expect(sockets).toHaveLength(1);
  });
});

describe("computer identity persistence", () => {
  const directories: string[] = [];
  afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
  it("retains a generated ID across launches without changing the identity file", () => {
    const directory = mkdtempSync(join(tmpdir(), "sky-discovery-")); directories.push(directory);
    const id = loadOrCreateServerId(directory);
    expect(id).toMatch(/^[0-9a-f-]{36}$/); expect(loadOrCreateServerId(directory)).toBe(id);
    expect(readFileSync(join(directory, "discovery-server-id"), "utf8")).toBe(`${id}\n`);
  });
  it("rejects a corrupt identity instead of silently replacing it", () => {
    const directory = mkdtempSync(join(tmpdir(), "sky-discovery-")); directories.push(directory);
    writeFileSync(join(directory, "discovery-server-id"), "invalid");
    expect(() => loadOrCreateServerId(directory)).toThrow("Invalid discovery identity");
    expect(readFileSync(join(directory, "discovery-server-id"), "utf8")).toBe("invalid");
  });
});

it("uses the real Node UDP adapter to bind and deliver the exact datagram", async () => {
  const receiver = createSocket("udp4");
  let rejectFailure: (error: Error) => void = () => undefined;
  const received = new Promise<Buffer>((resolve, reject) => {
    rejectFailure = reject;
    receiver.once("error", reject);
    receiver.once("message", resolve);
  });
  const sender = createNodeAnnouncementSocket(() => rejectFailure(new Error("UDP adapter error")));
  const timeout = setTimeout(() => rejectFailure(new Error("UDP receive timeout")), 2000);
  try {
    await new Promise<void>((resolve) => receiver.bind(0, "127.0.0.1", resolve));
    const address = receiver.address();
    await new Promise<void>((resolve) => sender.bind("127.0.0.1", resolve));
    sender.enableBroadcast();
    const bytes = encodeAnnouncement(server, instance, 8080);
    await new Promise<void>((resolve, reject) => sender.send(bytes, address.port, "127.0.0.1", (error) => error === null ? resolve() : reject(error)));
    expect(await received).toEqual(bytes);
  } finally {
    clearTimeout(timeout); sender.close(); receiver.close();
  }
});
