import { describe, expect, it } from "vitest";
import { DeviceRegistry, type DeviceRegistration } from "../src/modules/relay-link/device-registry/index.js";

const registration = (overrides: Partial<DeviceRegistration> = {}): DeviceRegistration => ({ connectionId: "connection-1", deviceId: "phone-1", sessionId: "session-1", ...overrides });

describe("device-registry contract", () => {
  it("starts empty and registers devices in insertion order", () => {
    const registry = DeviceRegistry.create();
    expect(registry.snapshot()).toMatchObject({ devices: [] });
    expect(registry.register(registration()).ok).toBe(true);
    expect(registry.register(registration({ connectionId: "connection-2", deviceId: "phone-2", sessionId: "session-2" })).ok).toBe(true);
    expect(registry.snapshot().devices.map((device) => device.deviceId)).toEqual(["phone-1", "phone-2"]);
  });

  it("rejects duplicate connection and device identities atomically", () => {
    const registry = DeviceRegistry.create();
    registry.register(registration());
    const before = registry.snapshot();
    expect(registry.register(registration({ deviceId: "phone-2" }))).toMatchObject({ ok: false, error: { code: "DUPLICATE_DEVICE" } });
    expect(registry.register(registration({ connectionId: "connection-2" }))).toMatchObject({ ok: false, error: { code: "DUPLICATE_DEVICE" } });
    expect(registry.snapshot()).toBe(before);
  });

  it("removes by either identity and permits device-id reuse", () => {
    const registry = DeviceRegistry.create();
    registry.register(registration());
    registry.register(registration({ connectionId: "connection-2", deviceId: "phone-2", sessionId: "session-2" }));
    expect(registry.removeByConnection("connection-1")).toMatchObject({ ok: true, value: { devices: [{ deviceId: "phone-2" }] } });
    expect(registry.removeByDevice("phone-2")).toMatchObject({ ok: true, value: { devices: [] } });
    expect(registry.register(registration({ connectionId: "connection-3", sessionId: "session-3" }))).toMatchObject({ ok: true, value: { deviceId: "phone-1" } });
  });

  it("returns immutable lookup and snapshot values", () => {
    const registry = DeviceRegistry.create();
    registry.register(registration());
    const snapshot = registry.snapshot();
    const device = registry.getByDevice("phone-1");
    expect(device).toBe(snapshot.devices[0]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.devices)).toBe(true);
    expect(Object.isFrozen(device)).toBe(true);
    expect(() => (snapshot.devices as unknown as Array<unknown>).pop()).toThrow();
    expect(registry.snapshot().devices).toHaveLength(1);
  });

  it("returns null for unknown lookups and stable errors for invalid IDs", () => {
    const registry = DeviceRegistry.create();
    expect(registry.getByConnection("missing")).toBeNull();
    expect(registry.getByDevice("missing")).toBeNull();
    expect(registry.getByConnection(" ")).toBeNull();
    expect(registry.getByDevice(" ")).toBeNull();
    expect(registry.removeByConnection(" ")).toMatchObject({ ok: false, error: { code: "DEVICE_NOT_FOUND" } });
    expect(registry.removeByDevice(" ")).toMatchObject({ ok: false, error: { code: "DEVICE_NOT_FOUND" } });
    expect(registry.removeByConnection("missing")).toMatchObject({ ok: false, error: { code: "DEVICE_NOT_FOUND" } });
    expect(registry.removeByDevice("missing")).toMatchObject({ ok: false, error: { code: "DEVICE_NOT_FOUND" } });
    expect(registry.register(null as never)).toMatchObject({ ok: false, error: { code: "INVALID_DEVICE" } });
    expect(registry.register("not-an-object" as never)).toMatchObject({ ok: false, error: { code: "INVALID_DEVICE" } });
  });

  it("contains listener failures, preserves order, and supports idempotent unsubscribe", () => {
    const registry = DeviceRegistry.create();
    const calls: string[] = [];
    registry.subscribe(() => { throw new Error("listener failure"); });
    const unsubscribe = registry.subscribe((snapshot) => calls.push(snapshot.devices.map((device) => device.deviceId).join(",")));
    const other = registry.subscribe((snapshot) => calls.push(`other:${snapshot.devices.length}`));
    registry.register(registration());
    unsubscribe(); unsubscribe();
    registry.register(registration({ connectionId: "connection-2", deviceId: "phone-2", sessionId: "session-2" }));
    other();
    registry.removeByDevice("phone-1");
    expect(calls).toEqual(["phone-1", "other:1", "other:2"]);
  });

  it("supports reentrant mutations after each committed snapshot", () => {
    const registry = DeviceRegistry.create();
    let nested = false;
    registry.subscribe((snapshot) => {
      if (!nested && snapshot.devices.length === 1) {
        nested = true;
        registry.register(registration({ connectionId: "connection-2", deviceId: "phone-2", sessionId: "session-2" }));
      }
    });
    registry.register(registration());
    expect(registry.snapshot().devices.map((device) => device.deviceId)).toEqual(["phone-1", "phone-2"]);
  });

  it("isolates instances and rejects hostile registration objects", () => {
    const first = DeviceRegistry.create();
    const second = DeviceRegistry.create();
    first.register(registration());
    expect(second.snapshot()).toMatchObject({ devices: [] });
    const hostile = new Proxy(registration(), { get() { throw new Error("sensitive"); } });
    expect(() => first.register(hostile)).not.toThrow();
    expect(first.register(hostile)).toMatchObject({ ok: false, error: { code: "INVALID_DEVICE" } });
  });

  it("preserves every documented registry error detail for malformed, duplicate, and missing identities", () => {
    const registry = DeviceRegistry.create();
    expect(registry.register(null as never)).toEqual({ ok: false, error: { code: "INVALID_DEVICE", message: "Device registration is invalid" } });
    expect(registry.register(registration())).toMatchObject({ ok: true });
    expect(registry.register(registration())).toEqual({ ok: false, error: { code: "DUPLICATE_DEVICE", message: "Device identity is already registered" } });
    expect(registry.removeByConnection("missing")).toEqual({ ok: false, error: { code: "DEVICE_NOT_FOUND", message: "Device is not registered" } });
    expect(registry.removeByDevice(" ")).toEqual({ ok: false, error: { code: "DEVICE_NOT_FOUND", message: "Device is not registered" } });
  });

  it("keeps hostile registration reads isolated and removes each subscription exactly once", () => {
    const registry = DeviceRegistry.create();
    const hostile = new Proxy(registration(), { get() { throw new Error("sensitive"); } });
    expect(registry.register(hostile)).toEqual({ ok: false, error: { code: "INVALID_DEVICE", message: "Device registration is invalid" } });
    let calls = 0;
    const unsubscribe = registry.subscribe(() => { calls += 1; });
    unsubscribe();
    unsubscribe();
    registry.register(registration());
    expect(calls).toBe(0);
  });

  it("validates every registration identity at whitespace, control-character, and length boundaries", () => {
    const valid = "v".repeat(128);
    const cases: DeviceRegistration[] = [
      registration({ connectionId: " " }),
      registration({ deviceId: " " }),
      registration({ sessionId: " " }),
      registration({ connectionId: "bad\u0000connection" }),
      registration({ deviceId: "d".repeat(129) }),
      registration({ sessionId: "s".repeat(129) }),
    ];
    for (const input of cases) {
      const registry = DeviceRegistry.create();
      expect(registry.register(input)).toMatchObject({ ok: false, error: { code: "INVALID_DEVICE" } });
      expect(registry.snapshot()).toEqual({ devices: [] });
    }
    const registry = DeviceRegistry.create();
    expect(registry.register({ connectionId: valid, deviceId: valid, sessionId: valid })).toMatchObject({ ok: true, value: { connectionId: valid, deviceId: valid, sessionId: valid } });
  });

  it("rejects a non-string value in each registration identity without committing a device", () => {
    const inputs = [
      registration({ connectionId: 1 as never }),
      registration({ deviceId: 1 as never }),
      registration({ sessionId: 1 as never }),
    ];
    for (const input of inputs) {
      const registry = DeviceRegistry.create();
      expect(registry.register(input)).toEqual({ ok: false, error: { code: "INVALID_DEVICE", message: "Device registration is invalid" } });
      expect(registry.snapshot()).toEqual({ devices: [] });
    }
  });

  it("preserves the documented message when string registration identities violate their bounds", () => {
    const registry = DeviceRegistry.create();
    expect(registry.register(registration({ deviceId: " " }))).toEqual({ ok: false, error: { code: "INVALID_DEVICE", message: "Device registration is invalid" } });
    expect(registry.snapshot()).toEqual({ devices: [] });
  });
});
