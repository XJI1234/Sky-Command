import { describe, expect, it } from "vitest";
import { NetworkSettings } from "../src/modules/desktop-settings/network-settings/index.js";

describe("desktop-settings network-settings defensive coverage", () => {
  it.each([
    null,
    7,
    { listenPort: 19500, manualHost: 7 },
    { listenPort: 19500, manualHost: "192.168.1.256" },
    { listenPort: 19500, manualHost: "fd00:::1" },
    { listenPort: 19500, manualHost: "fd00:1:2:3:4:5:6" },
    { listenPort: 19500, manualHost: "fd00:1:2:3:4:5:6:7::" },
    { listenPort: 19500, manualHost: "fd00:1:2:3:4:5:6:zzzz" },
    { listenPort: 19500, manualHost: "[fd00::1" },
    { listenPort: 19500, manualHost: "[]" }
  ])("rejects every malformed container or address shape", (input) => {
    expect(NetworkSettings.create(input)).toMatchObject({ ok: false });
  });

  it("rejects IPv6 publish hosts, including canonical unique-local forms", () => {
    expect(NetworkSettings.create({ listenPort: 19500, manualHost: "fd00:1:2:3:4:5:6:7" })).toMatchObject({
      ok: false,
      error: { details: { field: "manualHost", reason: "ipv6-unsupported" } }
    });
    expect(NetworkSettings.create({ listenPort: 19500, manualHost: "fd00:1:2:0:0:0:0:0" })).toMatchObject({
      ok: false,
      error: { details: { field: "manualHost", reason: "ipv6-unsupported" } }
    });
  });

  it("treats explicit undefined patch fields as absent", () => {
    const current = NetworkSettings.create({ listenPort: 19500, manualHost: "10.0.0.2" });
    if (!current.ok) throw current.error;
    expect(NetworkSettings.patch(current.value, { listenPort: undefined, manualHost: undefined })).toMatchObject({
      ok: true,
      value: current.value
    });
    expect(NetworkSettings.patch(current.value, { manualHost: null })).toMatchObject({
      ok: true,
      value: { listenPort: 19500, manualHost: null }
    });
  });

  it.each([
    [null, "input", "invalid-container"],
    [7, "input", "invalid-container"],
    [{ listenPort: "19500", manualHost: null }, "listenPort", "not-safe-integer"],
    [{ listenPort: 65536, manualHost: null }, "listenPort", "out-of-range"],
    [{ listenPort: 19500, manualHost: 7 }, "manualHost", "invalid-type"],
    [{ listenPort: 19500, manualHost: "192.168.1" }, "manualHost", "invalid-ip"],
    [{ listenPort: 19500, manualHost: "192.168.x.1" }, "manualHost", "invalid-ip"],
    [{ listenPort: 19500, manualHost: "172.15.0.1" }, "manualHost", "not-local"],
    [{ listenPort: 19500, manualHost: "172.32.0.1" }, "manualHost", "not-local"],
    [{ listenPort: 19500, manualHost: "8.16.0.1" }, "manualHost", "not-local"],
    [{ listenPort: 19500, manualHost: "192.167.0.1" }, "manualHost", "not-local"],
    [{ listenPort: 19500, manualHost: "193.168.0.1" }, "manualHost", "not-local"],
    [{ listenPort: 19500, manualHost: "fd00::1::" }, "manualHost", "ipv6-unsupported"],
    [{ listenPort: 19500, manualHost: "zz::1" }, "manualHost", "ipv6-unsupported"],
    [{ listenPort: 19500, manualHost: "fd00::zz" }, "manualHost", "ipv6-unsupported"],
    [{ listenPort: 19500, manualHost: "fd00:1:2:3:4:5:6:7x" }, "manualHost", "ipv6-unsupported"],
    [{ listenPort: 19500, manualHost: "fd00:1:2:3:4:5:6:7::" }, "manualHost", "ipv6-unsupported"],
    [{ listenPort: 19500, manualHost: "[fd00::1" }, "manualHost", "invalid-ip"],
    [{ listenPort: 19500, manualHost: "fd00::1]" }, "manualHost", "invalid-ip"],
    [{ listenPort: 19500, manualHost: "[]" }, "manualHost", "invalid-ip"]
  ])("preserves exact rejection details for %j", (input, field, reason) => {
    expect(NetworkSettings.create(input)).toMatchObject({
      ok: false,
      error: { code: "INVALID_NETWORK_SETTINGS", details: { field, reason } }
    });
  });

  it("rejects IPv6 and loopback as publish hosts", () => {
    expect(NetworkSettings.create({ listenPort: 19500, manualHost: "::1" })).toMatchObject({
      ok: false,
      error: { details: { field: "manualHost", reason: "ipv6-unsupported" } }
    });
    expect(NetworkSettings.create({ listenPort: 19500, manualHost: "fd00::1" })).toMatchObject({
      ok: false,
      error: { details: { field: "manualHost", reason: "ipv6-unsupported" } }
    });
    expect(NetworkSettings.create({ listenPort: 19500, manualHost: "[fd00::1]" })).toMatchObject({
      ok: false,
      error: { details: { field: "manualHost", reason: "ipv6-unsupported" } }
    });
    expect(NetworkSettings.create({ listenPort: 19500, manualHost: "fd00:1::2" })).toMatchObject({
      ok: false,
      error: { details: { field: "manualHost", reason: "ipv6-unsupported" } }
    });
    expect(NetworkSettings.create({ listenPort: 19500, manualHost: "fd00:0:0:1:0:0:2:3" })).toMatchObject({
      ok: false,
      error: { details: { field: "manualHost", reason: "ipv6-unsupported" } }
    });
    expect(NetworkSettings.create({ listenPort: 19500, manualHost: "::2" })).toMatchObject({
      ok: false,
      error: { details: { field: "manualHost", reason: "ipv6-unsupported" } }
    });
    expect(NetworkSettings.create({ listenPort: 19500, manualHost: "0:0:0:0:0:0:2:1" })).toMatchObject({
      ok: false,
      error: { details: { field: "manualHost", reason: "ipv6-unsupported" } }
    });
  });

  it("rejects primitive and null patch current values", () => {
    expect(NetworkSettings.patch(null as never, {})).toMatchObject({
      ok: false,
      error: { code: "INVALID_CONFIGURATION", details: { field: "current", reason: "untrusted" } }
    });
    expect(NetworkSettings.patch(7 as never, {})).toMatchObject({
      ok: false,
      error: { code: "INVALID_CONFIGURATION", details: { field: "current", reason: "untrusted" } }
    });
  });
});
