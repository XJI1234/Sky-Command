import { describe, expect, it } from "vitest";
import { DesktopSettings, type SettingsStorage } from "../src/modules/desktop-settings/settings-store/index.js";

const defaults = {
  version: 1 as const,
  network: { listenPort: 19500, relayPort: 8080, manualHost: null },
  map: { basemap: "tianditu-vector" as const, credential: null }
};

class MemoryStorage implements SettingsStorage {
  bytes: Uint8Array | null = null;
  writes: Uint8Array[] = [];
  readError: unknown = null;
  writeError: unknown = null;
  async read(): Promise<Uint8Array | null> {
    if (this.readError !== null) throw this.readError;
    return this.bytes === null ? null : new Uint8Array(this.bytes);
  }
  async writeAtomically(bytes: Uint8Array): Promise<void> {
    this.writes.push(bytes);
    if (this.writeError !== null) throw this.writeError;
    this.bytes = new Uint8Array(bytes);
  }
}

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

describe("desktop-settings settings-store public contract", () => {
  it("starts with immutable defaults without reading storage", () => {
    const storage = new MemoryStorage();
    const instance = DesktopSettings.create(storage);

    expect(instance.snapshot()).toEqual(defaults);
    expect(Object.isFrozen(instance.snapshot())).toBe(true);
    expect(Object.isFrozen(instance.snapshot().network)).toBe(true);
    expect(Object.isFrozen(instance.snapshot().map)).toBe(true);
    expect(storage.writes).toHaveLength(0);
  });

  it("commits valid partial updates and keeps failures isolated", () => {
    const instance = DesktopSettings.create(new MemoryStorage());

    expect(instance.updateNetwork({ listenPort: 19501, manualHost: "192.168.1.8" })).toMatchObject({
      ok: true,
      value: { network: { listenPort: 19501, relayPort: 8080, manualHost: "192.168.1.8" } }
    });
    expect(instance.updateNetwork({ relayPort: 18080 })).toMatchObject({
      ok: true,
      value: { network: { listenPort: 19501, relayPort: 18080, manualHost: "192.168.1.8" } }
    });
    expect(instance.updateMap({ basemap: "tianditu-image", credential: "key-1" })).toMatchObject({
      ok: true,
      value: { map: { basemap: "tianditu-image", credential: "key-1" } }
    });

    const before = instance.snapshot();
    const failed = instance.updateNetwork({ listenPort: 80 });
    expect(failed).toMatchObject({ ok: false, error: { code: "INVALID_NETWORK_SETTINGS" } });
    expect(instance.snapshot()).toBe(before);
    const failedMap = instance.updateMap({ basemap: "unsupported" });
    expect(failedMap).toMatchObject({ ok: false, error: { code: "INVALID_MAP_SETTINGS" } });
    expect(instance.snapshot()).toBe(before);
  });

  it("recovers defaults when storage is missing", async () => {
    const storage = new MemoryStorage();
    const instance = DesktopSettings.create(storage);
    instance.updateNetwork({ listenPort: 19501 });

    await expect(instance.load()).resolves.toEqual({ status: "recovered", snapshot: defaults, reason: "missing" });
    expect(instance.snapshot()).toEqual(defaults);
  });

  it.each([
    ["invalid UTF-8", Uint8Array.from([0xc3, 0x28])],
    ["invalid JSON", encode("not-json")],
    ["non-object root", encode("[]")],
    ["invalid settings", encode(JSON.stringify({ version: 1, network: { listenPort: 80, manualHost: null }, map: defaults.map }))]
  ])("recovers defaults for %s", async (_, bytes) => {
    const storage = new MemoryStorage();
    storage.bytes = bytes;
    const instance = DesktopSettings.create(storage);

    await expect(instance.load()).resolves.toEqual({ status: "recovered", snapshot: defaults, reason: "corrupt" });
  });

  it("recovers defaults for an unsupported version", async () => {
    const storage = new MemoryStorage();
    storage.bytes = encode(JSON.stringify({ version: 9, network: defaults.network, map: defaults.map }));

    await expect(DesktopSettings.create(storage).load()).resolves.toEqual({
      status: "recovered",
      snapshot: defaults,
      reason: "unsupported-version"
    });
  });

  it("migrates a version-zero document and reports it as loaded", async () => {
    const storage = new MemoryStorage();
    storage.bytes = encode(JSON.stringify({ version: 0, port: 19501, host: "10.0.0.7" }));
    const instance = DesktopSettings.create(storage);

    const result = await instance.load();

    expect(result).toEqual({
      status: "loaded",
      snapshot: {
        version: 1,
        network: { listenPort: 19501, relayPort: 8080, manualHost: "10.0.0.7" },
        map: defaults.map
      }
    });
  });

  it("loads a valid version-one document and ignores unknown fields", async () => {
    const storage = new MemoryStorage();
    storage.bytes = encode(JSON.stringify({
      version: 1,
      network: { listenPort: 19501, manualHost: "[fd00::1]" },
      map: { basemap: "tianditu-image", credential: " key-2 " },
      unknown: "ignored"
    }));
    const instance = DesktopSettings.create(storage);

    await expect(instance.load()).resolves.toEqual({
      status: "loaded",
      snapshot: {
        version: 1,
        network: { listenPort: 19501, relayPort: 8080, manualHost: "fd00::1" },
        map: { basemap: "tianditu-image", credential: "key-2" }
      }
    });
  });

  it("returns a structured read failure without leaking the adapter error", async () => {
    const storage = new MemoryStorage();
    storage.readError = new Error("C:\\secret\\settings.json token=abc");

    const result = await DesktopSettings.create(storage).load();

    expect(result).toMatchObject({ status: "failed", error: { code: "STORAGE_READ_FAILED", details: { field: "storage", reason: "read-failed" } } });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("abc");
  });

  it("serializes a stable UTF-8 document and isolates adapter byte mutation", async () => {
    const storage = new MemoryStorage();
    const instance = DesktopSettings.create(storage);
    instance.updateNetwork({ listenPort: 19501, manualHost: "10.0.0.3" });
    instance.updateMap({ basemap: "tianditu-image", credential: "key-3" });

    const result = await instance.save();

    expect(result).toEqual({ ok: true, value: instance.snapshot() });
    expect(new TextDecoder().decode(storage.writes[0])).toBe(
      '{"version":1,"network":{"listenPort":19501,"relayPort":8080,"manualHost":"10.0.0.3"},"map":{"basemap":"tianditu-image","credential":"key-3"}}'
    );
    storage.writes[0]![0] = 0;
    expect(instance.snapshot().map.credential).toBe("key-3");
  });

  it("returns a structured write failure and preserves the snapshot", async () => {
    const storage = new MemoryStorage();
    storage.writeError = new Error("disk path and credential=abc");
    const instance = DesktopSettings.create(storage);
    instance.updateMap({ credential: "key-4" });
    const before = instance.snapshot();

    const result = await instance.save();

    expect(result).toMatchObject({ ok: false, error: { code: "STORAGE_WRITE_FAILED", details: { field: "storage", reason: "write-failed" } } });
    expect(JSON.stringify(result)).not.toContain("abc");
    expect(instance.snapshot()).toBe(before);
  });

  it("serializes saves in invocation order and captures each call's snapshot", async () => {
    const storage = new MemoryStorage();
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const writes: string[] = [];
    storage.writeAtomically = async (bytes) => {
      writes.push(new TextDecoder().decode(bytes));
      if (writes.length === 1) await firstGate;
    };
    const instance = DesktopSettings.create(storage);
    const first = instance.save();
    instance.updateNetwork({ listenPort: 19501 });
    const second = instance.save();
    releaseFirst!();

    await Promise.all([first, second]);

    expect(writes).toEqual([
      '{"version":1,"network":{"listenPort":19500,"relayPort":8080,"manualHost":null},"map":{"basemap":"tianditu-vector","credential":null}}',
      '{"version":1,"network":{"listenPort":19501,"relayPort":8080,"manualHost":null},"map":{"basemap":"tianditu-vector","credential":null}}'
    ]);
  });
});
