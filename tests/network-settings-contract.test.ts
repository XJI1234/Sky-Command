import { describe, expect, it } from "vitest";
import { NetworkSettings } from "../src/modules/desktop-settings/network-settings/index.js";

describe("desktop-settings network-settings public contract", () => {
  it("creates a frozen, canonical private IPv4 configuration", () => {
    const result = NetworkSettings.create({ listenPort: 19500, manualHost: "192.168.001.010" });

    expect(result).toMatchObject({ ok: true, value: { listenPort: 19500, manualHost: "192.168.1.10" } });
    if (!result.ok) throw result.error;
    expect(result.value.relayPort).toBe(8080);
    expect(Object.isFrozen(result.value)).toBe(true);
  });

  it("keeps the WebSocket relay port independent from the RTMP listen port", () => {
    expect(NetworkSettings.create({ listenPort: 19500, relayPort: 18080, manualHost: null })).toMatchObject({
      ok: true,
      value: { listenPort: 19500, relayPort: 18080, manualHost: null }
    });
    expect(NetworkSettings.create({ listenPort: 19500, relayPort: null, manualHost: null })).toMatchObject({
      ok: false,
      error: { code: "INVALID_NETWORK_SETTINGS", details: { field: "relayPort", reason: "not-safe-integer" } }
    });
    expect(NetworkSettings.create({ listenPort: 19500, relayPort: 80, manualHost: null })).toMatchObject({
      ok: false,
      error: { code: "INVALID_NETWORK_SETTINGS", details: { field: "relayPort", reason: "out-of-range" } }
    });
    expect(NetworkSettings.create({ listenPort: 19500, relayPort: 8080.5, manualHost: null })).toMatchObject({
      ok: false,
      error: { code: "INVALID_NETWORK_SETTINGS", details: { field: "relayPort", reason: "not-safe-integer" } }
    });
    const current = NetworkSettings.create({ listenPort: 19500, relayPort: 18080, manualHost: null });
    if (!current.ok) throw current.error;
    expect(NetworkSettings.patch(current.value, { relayPort: 18081 })).toMatchObject({
      ok: true,
      value: { listenPort: 19500, relayPort: 18081, manualHost: null }
    });
  });

  it.each([
    ["minimum", 1024],
    ["maximum", 65535]
  ])("accepts the %s non-privileged port boundary", (_, listenPort) => {
    expect(NetworkSettings.create({ listenPort, manualHost: null })).toMatchObject({
      ok: true,
      value: { listenPort, manualHost: null }
    });
  });

  it.each([
    ["loopback IPv4", "127.0.0.1", "127.0.0.1"],
    ["10/8 IPv4", "10.0.0.1", "10.0.0.1"],
    ["172.16 lower boundary", "172.16.0.1", "172.16.0.1"],
    ["172.16/12 IPv4", "172.31.255.254", "172.31.255.254"],
    ["192.168/16 IPv4", "192.168.1.5", "192.168.1.5"],
    ["IPv6 loopback", "[0:0:0:0:0:0:0:1]", "::1"],
    ["IPv6 unique local", "FD00:0:0:0000:0:0:0:ABCD", "fd00::abcd"],
    ["IPv6 link local", "FE80:0:0:0:0:0:0:2", "fe80::2"]
  ])("accepts and canonicalizes %s", (_, manualHost, expected) => {
    expect(NetworkSettings.create({ listenPort: 19500, manualHost })).toMatchObject({
      ok: true,
      value: { manualHost: expected }
    });
  });

  it.each([
    ["privileged port", { listenPort: 80, manualHost: null }, "listenPort", "out-of-range"],
    ["fractional port", { listenPort: 1024.5, manualHost: null }, "listenPort", "not-safe-integer"],
    ["public IPv4", { listenPort: 19500, manualHost: "8.8.8.8" }, "manualHost", "not-local"],
    ["hostname", { listenPort: 19500, manualHost: "relay.local" }, "manualHost", "invalid-ip"],
    ["address with port", { listenPort: 19500, manualHost: "192.168.1.2:19500" }, "manualHost", "invalid-ip"],
    ["CIDR", { listenPort: 19500, manualHost: "192.168.1.2/24" }, "manualHost", "invalid-ip"],
    ["whitespace", { listenPort: 19500, manualHost: " 192.168.1.2" }, "manualHost", "unsafe-text"],
    ["IPv4-mapped IPv6", { listenPort: 19500, manualHost: "::ffff:192.168.1.2" }, "manualHost", "invalid-ip"],
    ["public IPv6", { listenPort: 19500, manualHost: "2001:4860:4860::8888" }, "manualHost", "not-local"]
  ])("rejects %s without echoing the unsafe input", (_, input, field, reason) => {
    const result = NetworkSettings.create(input);

    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_NETWORK_SETTINGS", details: { field, reason } } });
    if (result.ok) throw new Error("expected rejection");
    if (input.manualHost !== null) expect(JSON.stringify(result.error)).not.toContain(input.manualHost);
  });

  it("patches a trusted current value without mutating it and rejects forged current values", () => {
    const current = NetworkSettings.create({ listenPort: 19500, manualHost: "10.0.0.2" });
    if (!current.ok) throw current.error;

    expect(NetworkSettings.patch(current.value, { listenPort: 19501 })).toMatchObject({
      ok: true,
      value: { listenPort: 19501, relayPort: 8080, manualHost: "10.0.0.2" }
    });
    expect(current.value).toMatchObject({ listenPort: 19500, manualHost: "10.0.0.2" });
    expect(NetworkSettings.patch({ listenPort: 19500, manualHost: null }, {})).toMatchObject({
      ok: false,
      error: { code: "INVALID_CONFIGURATION", details: { field: "current", reason: "untrusted" } }
    });
  });

  it("does not throw when input or patch getters are hostile", () => {
    const unreadable = new Proxy({}, { get() { throw new Error("untrusted"); } });
    expect(NetworkSettings.create(unreadable)).toMatchObject({
      ok: false,
      error: { code: "INVALID_NETWORK_SETTINGS", details: { field: "input", reason: "unreadable" } }
    });

    const current = NetworkSettings.create({ listenPort: 19500, manualHost: null });
    if (!current.ok) throw current.error;
    expect(NetworkSettings.patch(current.value, unreadable)).toMatchObject({
      ok: false,
      error: { code: "INVALID_NETWORK_SETTINGS", details: { field: "input", reason: "unreadable" } }
    });
  });
});
