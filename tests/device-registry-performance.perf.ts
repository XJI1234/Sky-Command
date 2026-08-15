import { expect, it } from "vitest";
import { DeviceRegistry } from "../src/modules/relay-link/device-registry/index.js";

it("device-registry handles bounded registration and lookup work linearly", () => {
  const registry = DeviceRegistry.create();
  const startedAt = performance.now();
  for (let index = 0; index < 1_000; index += 1) {
    expect(registry.register({ connectionId: `connection-${index}`, deviceId: `phone-${index}`, sessionId: `session-${index}` })).toMatchObject({ ok: true });
  }
  for (let index = 0; index < 1_000; index += 1) expect(registry.getByDevice(`phone-${index}`)?.connectionId).toBe(`connection-${index}`);
  expect(performance.now() - startedAt).toBeLessThan(500);
});
