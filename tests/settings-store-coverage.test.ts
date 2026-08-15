import { describe, expect, it } from "vitest";
import { DesktopSettings, type SettingsStorage } from "../src/modules/desktop-settings/settings-store/index.js";

class ControlledStorage implements SettingsStorage {
  constructor(public bytes: Uint8Array | null) {}
  async read(): Promise<Uint8Array | null> { return this.bytes === null ? null : new Uint8Array(this.bytes); }
  async writeAtomically(): Promise<void> {}
}

const json = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

describe("desktop-settings settings-store defensive coverage", () => {
  it.each([
    ["missing version", { network: { listenPort: 19500, manualHost: null }, map: { basemap: "tianditu-vector", credential: null } }],
    ["string version", { version: "1", network: { listenPort: 19500, manualHost: null }, map: { basemap: "tianditu-vector", credential: null } }],
    ["missing network", { version: 1, map: { basemap: "tianditu-vector", credential: null } }],
    ["missing map", { version: 1, network: { listenPort: 19500, manualHost: null } }]
  ])("recovers corrupt documents for %s", async (_, value) => {
    const result = await DesktopSettings.create(new ControlledStorage(json(value))).load();
    expect(result).toMatchObject({ status: "recovered", reason: "corrupt" });
  });

  it.each(["null", '"text"'])("recovers corrupt primitive JSON roots: %s", async (document) => {
    const result = await DesktopSettings.create(new ControlledStorage(new TextEncoder().encode(document))).load();
    expect(result).toMatchObject({ status: "recovered", reason: "corrupt" });
  });

  it("rejects invalid UTF-8 even when replacement decoding would form valid JSON", async () => {
    const prefix = new TextEncoder().encode('{"version":1,"network":{"listenPort":19500,"manualHost":null},"map":{"basemap":"tianditu-vector","credential":"');
    const suffix = new TextEncoder().encode('"}}');
    const bytes = new Uint8Array(prefix.length + 2 + suffix.length);
    bytes.set(prefix);
    bytes.set([0xc3, 0x28], prefix.length);
    bytes.set(suffix, prefix.length + 2);

    const result = await DesktopSettings.create(new ControlledStorage(bytes)).load();
    expect(result).toMatchObject({ status: "recovered", reason: "corrupt" });
  });

  it("migrates version zero with defaulted fields", async () => {
    const result = await DesktopSettings.create(new ControlledStorage(json({ version: 0, port: 19500, host: null }))).load();
    expect(result).toMatchObject({ status: "loaded", snapshot: { version: 1 } });
  });

  it("migrates version zero with both network fields defaulted", async () => {
    const result = await DesktopSettings.create(new ControlledStorage(json({ version: 0 }))).load();
    expect(result).toMatchObject({ status: "loaded", snapshot: { network: { listenPort: 19500, manualHost: null } } });
  });

  it("rejects an invalid version-zero document", async () => {
    const result = await DesktopSettings.create(new ControlledStorage(json({ version: 0, port: 80, host: null }))).load();
    expect(result).toMatchObject({ status: "recovered", reason: "corrupt" });
  });

  it("does not throw when the storage read rejects with a primitive", async () => {
    const storage: SettingsStorage = {
      read: async () => { throw "private-error"; },
      writeAtomically: async () => undefined
    };
    const result = await DesktopSettings.create(storage).load();
    expect(result).toMatchObject({ status: "failed", error: { code: "STORAGE_READ_FAILED", details: { field: "storage", reason: "read-failed" } } });
  });

});
