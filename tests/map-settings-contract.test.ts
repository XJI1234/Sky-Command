import { describe, expect, it } from "vitest";
import { MapSettings } from "../src/modules/desktop-settings/map-settings/index.js";

describe("desktop-settings map-settings public contract", () => {
  it.each([
    ["vector", "tianditu-vector"],
    ["image", "tianditu-image"]
  ])("accepts the %s basemap and null credential", (_, basemap) => {
    const result = MapSettings.create({ basemap, credential: null });

    expect(result).toMatchObject({ ok: true, value: { basemap, credential: null } });
    if (!result.ok) throw result.error;
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.value)).toBe(true);
  });

  it("trims a credential and preserves its Unicode code points", () => {
    const result = MapSettings.create({ basemap: "tianditu-vector", credential: "  key-杭州  " });

    expect(result).toMatchObject({ ok: true, value: { credential: "key-杭州" } });
  });

  it("accepts a credential at the 256-code-point boundary", () => {
    expect(MapSettings.create({ basemap: "tianditu-vector", credential: "a".repeat(256) })).toMatchObject({ ok: true });
  });

  it.each([
    ["unsupported basemap", { basemap: "osm", credential: null }, "basemap", "unsupported-basemap"],
    ["missing basemap", { credential: null }, "basemap", "invalid-type"],
    ["numeric basemap", { basemap: 1, credential: null }, "basemap", "invalid-type"],
    ["credential object", { basemap: "tianditu-vector", credential: {} }, "credential", "invalid-type"],
    ["empty credential", { basemap: "tianditu-vector", credential: " \t " }, "credential", "credential-empty"],
    ["long credential", { basemap: "tianditu-vector", credential: "a".repeat(257) }, "credential", "credential-too-long"],
    ["unsafe credential", { basemap: "tianditu-vector", credential: "key with spaces" }, "credential", "credential-unsafe-text"]
  ])("rejects %s with stable details", (_, input, field, reason) => {
    const result = MapSettings.create(input);

    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_MAP_SETTINGS", details: { field, reason } } });
    expect(JSON.stringify(result)).not.toContain("key with spaces");
  });

  it("rejects primitive and null containers", () => {
    expect(MapSettings.create(null)).toMatchObject({ ok: false, error: { code: "INVALID_MAP_SETTINGS", details: { field: "input", reason: "invalid-container" } } });
    expect(MapSettings.create("settings")).toMatchObject({ ok: false, error: { code: "INVALID_MAP_SETTINGS", details: { field: "input", reason: "invalid-container" } } });
  });

  it("does not throw for a hostile getter", () => {
    const unreadable = new Proxy({}, { get() { throw new Error("secret-token"); } });

    const result = MapSettings.create(unreadable);

    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_MAP_SETTINGS", details: { field: "input", reason: "unreadable" } } });
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("patches a trusted value without mutation and supports clearing the credential", () => {
    const current = MapSettings.create({ basemap: "tianditu-vector", credential: "abc" });
    if (!current.ok) throw current.error;

    const changed = MapSettings.patch(current.value, { basemap: "tianditu-image" });
    expect(changed).toMatchObject({ ok: true, value: { basemap: "tianditu-image", credential: "abc" } });
    expect(MapSettings.patch(current.value, { credential: null })).toMatchObject({ ok: true, value: { basemap: "tianditu-vector", credential: null } });
    expect(current.value).toEqual({ basemap: "tianditu-vector", credential: "abc" });
  });

  it("treats omitted and undefined patch fields as unchanged", () => {
    const current = MapSettings.create({ basemap: "tianditu-image", credential: "abc" });
    if (!current.ok) throw current.error;

    expect(MapSettings.patch(current.value, {})).toMatchObject({ ok: true, value: current.value });
    expect(MapSettings.patch(current.value, { basemap: undefined, credential: undefined })).toMatchObject({ ok: true, value: current.value });
  });

  it("rejects forged current values and invalid patches", () => {
    expect(MapSettings.patch({ basemap: "tianditu-vector", credential: null }, {})).toMatchObject({
      ok: false,
      error: { code: "INVALID_CONFIGURATION", details: { field: "current", reason: "untrusted" } }
    });

    const current = MapSettings.create({ basemap: "tianditu-vector", credential: "abc" });
    if (!current.ok) throw current.error;
    const result = MapSettings.patch(current.value, { credential: "bad key" });
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_MAP_SETTINGS" } });
    expect(current.value).toEqual({ basemap: "tianditu-vector", credential: "abc" });
  });

  it("does not throw for a hostile patch getter", () => {
    const current = MapSettings.create({ basemap: "tianditu-vector", credential: null });
    if (!current.ok) throw current.error;
    const unreadable = new Proxy({}, { get() { throw new Error("secret-token"); } });

    expect(MapSettings.patch(current.value, unreadable)).toMatchObject({
      ok: false,
      error: { code: "INVALID_MAP_SETTINGS", details: { field: "input", reason: "unreadable" } }
    });
  });
});
