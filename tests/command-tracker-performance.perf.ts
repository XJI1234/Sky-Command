import { expect, it } from "vitest";
import { CommandTracker } from "../src/modules/relay-link/command-tracker/index.js";

it("command-tracker completes bounded command lifecycles without quadratic work", () => {
  let nextTimer = 0;
  const scheduler = { setTimeout: () => ++nextTimer, clearTimeout: () => undefined };
  const tracker = CommandTracker.create({ scheduler, timeoutMs: 1000 });
  const startedAt = performance.now();
  for (let index = 0; index < 2_000; index += 1) tracker.begin({ connectionId: `connection-${index}`, commandId: `command-${index}` });
  for (let index = 0; index < 2_000; index += 1) expect(tracker.resolve({ connectionId: `connection-${index}`, commandId: `command-${index}`, ok: true, detail: "ok" })).toMatchObject({ ok: true });
  expect(performance.now() - startedAt).toBeLessThan(500);
});
