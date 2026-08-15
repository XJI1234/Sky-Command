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

  it("canonicalizes uncompressed IPv6 and a zero run at the end", () => {
    expect(NetworkSettings.create({ listenPort: 19500, manualHost: "fd00:1:2:3:4:5:6:7" })).toMatchObject({
      ok: true,
      value: { manualHost: "fd00:1:2:3:4:5:6:7" }
    });
    expect(NetworkSettings.create({ listenPort: 19500, manualHost: "fd00:1:2:0:0:0:0:0" })).toMatchObject({
      ok: true,
      value: { manualHost: "fd00:1:2::" }
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
    [{ listenPort: 19500, manualHost: "fd00::1::" }, "manualHost", "invalid-ip"],
    [{ listenPort: 19500, manualHost: "zz::1" }, "manualHost", "invalid-ip"],
    [{ listenPort: 19500, manualHost: "fd00::zz" }, "manualHost", "invalid-ip"],
    [{ listenPort: 19500, manualHost: "fd00:1:2:3:4:5:6:7x" }, "manualHost", "invalid-ip"],
    [{ listenPort: 19500, manualHost: "fd00:1:2:3:4:5:6:7::" }, "manualHost", "invalid-ip"],
    [{ listenPort: 19500, manualHost: "[fd00::1" }, "manualHost", "invalid-ip"],
    [{ listenPort: 19500, manualHost: "fd00::1]" }, "manualHost", "invalid-ip"],
    [{ listenPort: 19500, manualHost: "[]" }, "manualHost", "invalid-ip"]
  ])("preserves exact rejection details for %j", (input, field, reason) => {
    expect(NetworkSettings.create(input)).toMatchObject({
      ok: false,
      error: { code: "INVALID_NETWORK_SETTINGS", details: { field, reason } }
    });
  });

  it("uses the leftmost longest IPv6 zero run and only accepts a true loopback", () => {
    expect(NetworkSettings.create({ listenPort: 19500, manualHost: "::1" })).toMatchObject({
      ok: true,
      value: { manualHost: "::1" }
    });
    expect(NetworkSettings.create({ listenPort: 19500, manualHost: "fd00::1" })).toMatchObject({
      ok: true,
      value: { manualHost: "fd00::1" }
    });
    expect(NetworkSettings.create({ listenPort: 19500, manualHost: "fd00:1::2" })).toMatchObject({
      ok: true,
      value: { manualHost: "fd00:1::2" }
    });
    expect(NetworkSettings.create({ listenPort: 19500, manualHost: "fd00:0:0:1:0:0:2:3" })).toMatchObject({
      ok: true,
      value: { manualHost: "fd00::1:0:0:2:3" }
    });
    expect(NetworkSettings.create({ listenPort: 19500, manualHost: "::2" })).toMatchObject({
      ok: false,
      error: { details: { field: "manualHost", reason: "not-local" } }
    });
    expect(NetworkSettings.create({ listenPort: 19500, manualHost: "0:0:0:0:0:0:2:1" })).toMatchObject({
      ok: false,
      error: { details: { field: "manualHost", reason: "not-local" } }
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
