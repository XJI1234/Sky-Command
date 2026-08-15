import { expect, it } from "vitest";
import { TelemetryIntake } from "../src/modules/relay-link/telemetry-intake/index.js";

it("telemetry-intake replaces bounded snapshots predictably", () => {
  const intake = TelemetryIntake.create();
  const payload = { kind: "object" as const, fields: { state: { kind: "number" as const, value: "1" } } };
  const capabilities = { kind: "object" as const, fields: {} };
  const startedAt = performance.now();
  for (let index = 0; index < 2_000; index += 1) expect(intake.accept({ connectionId: `connection-${index % 100}`, payload, capabilities })).toMatchObject({ ok: true });
  expect(intake.snapshot()).toHaveLength(100);
  expect(performance.now() - startedAt).toBeLessThan(500);
});
