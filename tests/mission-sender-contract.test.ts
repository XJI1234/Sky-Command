import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";
import { MissionSender, type MissionPayload, type MissionSink, type TimerScheduler } from "../src/modules/relay-link/mission-sender/index.js";

class Scheduler implements TimerScheduler {
  private next = 1;
  private timers = new Map<number, () => void>();
  setTimeout(callback: () => void, _milliseconds: number): number { const id = this.next++; this.timers.set(id, callback); return id; }
  clearTimeout(handle: number): void { this.timers.delete(handle); }
  fireAll(): void { for (const callback of [...this.timers.values()]) callback(); this.timers.clear(); }
}
class Sink implements MissionSink {
  readonly frames: unknown[] = [];
  fail = false;
  async send(frame: unknown): Promise<void> { if (this.fail) throw new Error("send failed"); this.frames.push(frame); }
}
const data = new Uint8Array([1, 2, 3, 4, 5]);
const payload = (overrides: Partial<MissionPayload> = {}): MissionPayload => ({ missionId: "mission-1", fileName: "route.kmz", bytes: data, size: data.byteLength, sha256: Buffer.from(sha256(data)).toString("hex"), ...overrides });
const create = (scheduler = new Scheduler()) => ({ sender: MissionSender.create({ scheduler, timeoutMs: 10 }), scheduler });
const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe("mission-sender contract", () => {
  it("streams begin/chunks/complete and resolves only on phone success", async () => {
    const { sender } = create(); const sink = new Sink();
    const result = sender.send("connection-1", payload(), sink);
    await flush();
    expect((sink.frames as Array<{ type: string }>).map((frame) => frame.type)).toEqual(["mission-begin", "mission-chunk", "mission-complete"]);
    sender.acceptResult("connection-1", { missionId: "mission-1", ok: true, detail: "uploaded" });
    await expect(result).resolves.toMatchObject({ status: "succeeded", detail: "uploaded" });
  });

  it("reports phone rejection and rejects size or digest mismatches before sending", async () => {
    const { sender } = create(); const sink = new Sink();
    const rejected = sender.send("connection-1", payload(), sink);
    await flush();
    sender.acceptResult("connection-1", { missionId: "mission-1", ok: false, detail: "unsupported" });
    await expect(rejected).resolves.toMatchObject({ status: "rejected" });
    expect(await sender.send("connection-2", payload({ size: 99 }), new Sink())).toMatchObject({ status: "rejected" });
    expect(await sender.send("connection-3", payload({ sha256: "a".repeat(64) }), new Sink())).toMatchObject({ status: "rejected" });
    expect(await sender.send("connection-4", null as never, new Sink())).toMatchObject({ status: "rejected" });
  });

  it("times out, cancels on disconnect, and rejects duplicate active transfers", async () => {
    const { sender, scheduler } = create(); const sink = new Sink();
    const first = sender.send("connection-1", payload(), sink);
    expect(await sender.send("connection-1", payload({ missionId: "mission-2" }), new Sink())).toMatchObject({ status: "rejected" });
    scheduler.fireAll();
    await flush();
    await expect(first).resolves.toMatchObject({ status: "timed-out" });
    const second = sender.send("connection-1", payload({ missionId: "mission-3" }), sink);
    sender.acceptResult(" ", { missionId: "mission-3", ok: true, detail: "bad" });
    sender.acceptResult("connection-1", { missionId: "missing", ok: true, detail: "missing" });
    sender.cancelConnection("connection-2", "unrelated");
    expect(sender.snapshot()).toEqual([{ connectionId: "connection-1", missionId: "mission-3" }]);
    sender.cancelConnection("connection-1", "disconnected");
    await expect(second).resolves.toMatchObject({ status: "disconnected" });
  });

  it("contains sink/listener failures and detaches input bytes", async () => {
    const { sender } = create(); const sink = new Sink(); sink.fail = true;
    sender.subscribe(() => { throw new Error("listener failure"); });
    let outcomes = 0;
    const unsubscribe = sender.subscribe(() => { outcomes += 1; });
    unsubscribe();
    unsubscribe();
    const result = sender.send("connection-1", payload(), sink);
    data[0] = 99;
    await expect(result).resolves.toMatchObject({ status: "transport-failed" });
    sender.cancelConnection(" ", "bad");
    sender.cancelConnection("connection-2", "");
    expect(sender.snapshot()).toEqual([]);
    expect(outcomes).toBe(0);
  });

  it("ignores a late timeout callback after completion", async () => {
    const callbacks: Array<() => void> = [];
    const sender = MissionSender.create({ scheduler: { setTimeout: (callback) => { callbacks.push(callback); return callbacks.length; }, clearTimeout: () => undefined }, timeoutMs: 10 });
    const sink = new Sink();
    const result = sender.send("connection-1", payload(), sink);
    await flush();
    sender.acceptResult("connection-1", { missionId: "mission-1", ok: true, detail: "done" });
    callbacks[0]?.();
    await expect(result).resolves.toMatchObject({ status: "succeeded" });
  });

  it("rejects path traversal file names before sending any mission frame", async () => {
    const { sender } = create(); const sink = new Sink();
    const result = await sender.send("connection-1", payload({ fileName: "../route.kmz" }), sink);
    expect(result).toMatchObject({ status: "rejected" });
    expect(sink.frames).toEqual([]);
  });
});
