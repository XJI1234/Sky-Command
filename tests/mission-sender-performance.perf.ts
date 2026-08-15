import { sha256 } from "@noble/hashes/sha2.js";
import { expect, it } from "vitest";
import { MissionSender } from "../src/modules/relay-link/mission-sender/index.js";

it("mission-sender chunks bounded payloads without excessive overhead", async () => {
  const bytes = new Uint8Array(48 * 1024 + 1);
  const digest = Array.from(sha256(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
  const sender = MissionSender.create({ scheduler: { setTimeout: () => 1, clearTimeout: () => undefined }, timeoutMs: 10_000 });
  const frames: unknown[] = [];
  const startedAt = performance.now();
  const outcome = sender.send("connection", { missionId: "mission", fileName: "route.kmz", bytes, size: bytes.byteLength, sha256: digest }, { send: async (frame) => { frames.push(frame); } });
  await Promise.resolve();
  sender.acceptResult("connection", { missionId: "mission", ok: true, detail: "ok" });
  await expect(outcome).resolves.toMatchObject({ status: "succeeded" });
  expect(frames).toHaveLength(4);
  expect(performance.now() - startedAt).toBeLessThan(500);
});
