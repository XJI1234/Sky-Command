import { expect, it } from "vitest";
import { RelayFrameCodec } from "../src/modules/relay-link/protocol-core/index.js";

it("relay-link protocol-core decodes bounded telemetry frames without quadratic work", () => {
  const payload: Record<string, number> = {};
  for (let index = 0; index < 4_000; index += 1) payload[`k${index}`] = index;
  const bytes = new TextEncoder().encode(JSON.stringify({ type: "telemetry", payload, capabilities: {} }));

  const startedAt = performance.now();
  for (let index = 0; index < 40; index += 1) expect(RelayFrameCodec.decode(bytes)).toMatchObject({ kind: "decoded" });
  expect(performance.now() - startedAt).toBeLessThan(1_500);
});
