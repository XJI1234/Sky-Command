import { describe, expect, it } from "vitest";
import { LowLatencyMedia } from "../src/production/low-latency-media/index.js";

const mediaFixture = (calls: string[]) => {
  let phase: "idle" | "running" = "idle";
  return {
  start: (input: unknown) => { calls.push(`media.start:${String(input)}`); phase = "running"; return { ok: true, value: { phase, revision: 1, streams: [], player: { phase: "idle" }, diagnostic: null } }; },
  stop: () => { calls.push("media.stop"); phase = "idle"; return { ok: true, value: { phase, revision: 2, streams: [], player: { phase: "idle" }, diagnostic: null } }; },
  evaluate: async (now: unknown) => { calls.push(`media.refresh:${String(now)}`); return { ok: true, value: { phase: "running", revision: 3, streams: [], player: { phase: "idle" }, diagnostic: null } }; },
  publishTarget: () => ({ ok: true, value: { kind: "whip", deviceId: "phone-1", url: "http://192.168.1.20:8889/live/phone-1/whip" } }),
  playback: () => ({ ok: true, value: { kind: "whep", deviceId: "phone-1", url: "http://127.0.0.1:8889/live/phone-1/whep" } }),
  selectPlayer: (deviceId: unknown) => { calls.push(`media.select:${String(deviceId)}`); return { ok: true, value: { phase: "running" } }; },
  clearPlayer: () => { calls.push("media.clear"); return { ok: true, value: { phase: "running" } }; },
  snapshot: () => ({ phase, revision: 1, streams: [], player: { phase: "idle" }, diagnostic: null }),
  dispose: () => { calls.push("media.dispose"); },
  };
};

const controlFixture = (calls: string[]) => ({
  start: async (deviceId: string) => { calls.push(`stream.start:${deviceId}`); return { ok: true, operation: "start", state: { deviceId, phase: "streaming" } }; },
  stop: async (deviceId: string) => { calls.push(`stream.stop:${deviceId}`); return { ok: true, operation: "stop", state: { deviceId, phase: "idle" } }; },
  check: () => ({ ok: true }),
  get: (deviceId: string) => ({ deviceId, phase: deviceId === "phone-1" ? "streaming" : "idle" }),
  list: () => [{ deviceId: "phone-1", phase: "streaming" }, { deviceId: "phone-2", phase: "idle" }],
  recordDisconnected: () => null,
  forget: () => false,
  subscribe: () => () => undefined,
});

describe("LowLatencyMedia", () => {
  it("keeps MediaMTX start separate from WHIP command start", async () => {
    const calls: string[] = [];
    const lowLatency = LowLatencyMedia.create({ media: mediaFixture(calls), control: controlFixture(calls), startInput: "input" });

    await expect(lowLatency.start()).resolves.toMatchObject({ ok: true });
    expect(calls).toEqual(["media.start:input"]);
    await expect(lowLatency.startStream("phone-1")).resolves.toMatchObject({ ok: true });
    expect(calls).toEqual(["media.start:input", "stream.start:phone-1"]);
  });

  it("stops every active WHIP device before MediaMTX and releases idempotently", async () => {
    const calls: string[] = [];
    const lowLatency = LowLatencyMedia.create({ media: mediaFixture(calls), control: controlFixture(calls), startInput: {} });

    await expect(lowLatency.stop()).resolves.toMatchObject({ ok: true });
    expect(calls).toEqual(["stream.stop:phone-1", "media.stop"]);
    await lowLatency.dispose();
    await lowLatency.dispose();
    expect(calls).toEqual(["stream.stop:phone-1", "media.stop", "media.dispose"]);
  });

  it("treats stopping an idle sidecar as a successful no-op", async () => {
    const calls: string[] = [];
    const lowLatency = LowLatencyMedia.create({
      media: mediaFixture(calls),
      control: {
        ...controlFixture(calls),
        list: () => [{ deviceId: "phone-1", phase: "idle", lastOperation: null, failureCode: null, reason: null }],
      },
      startInput: {},
    });

    await expect(lowLatency.stop()).resolves.toMatchObject({ ok: true });
    expect(calls).toEqual([]);
  });

  it("delegates refresh and player operations without exposing target addresses", async () => {
    const calls: string[] = [];
    const lowLatency = LowLatencyMedia.create({ media: mediaFixture(calls), control: controlFixture(calls), startInput: {} });

    await lowLatency.refresh(42);
    lowLatency.selectPlayer("phone-1");
    lowLatency.clearPlayer();
    expect(calls).toEqual(["media.refresh:42", "media.select:phone-1", "media.clear"]);
    expect(JSON.stringify(lowLatency.snapshot())).not.toContain("192.168.1.20");
  });

  it("stops a still-active WHIP publisher after health marks the stream failed", async () => {
    const calls: string[] = [];
    const media = {
      ...mediaFixture(calls),
      snapshot: () => ({
        phase: "running" as const,
        revision: 4,
        streams: [{ deviceId: "phone-1", phase: "failed" as const, diagnostic: "timeout" }],
        player: { phase: "idle" },
        diagnostic: null,
      }),
    };
    const lowLatency = LowLatencyMedia.create({ media, control: controlFixture(calls), startInput: {} });
    await lowLatency.refresh(15_000);
    expect(calls).toEqual(["media.refresh:15000", "stream.stop:phone-1"]);
  });

  it("路径健康失败时停止仍在推流的手机 WHIP", async () => {
    const calls: string[] = [];
    const media = {
      ...mediaFixture(calls),
      evaluate: async () => {
        calls.push("media.refresh:failed");
        return { ok: false, code: "PATH_MONITOR_FAILED", value: { phase: "failed" } };
      },
    };
    const lowLatency = LowLatencyMedia.create({ media, control: controlFixture(calls), startInput: {} });
    await expect(lowLatency.refresh(1)).resolves.toMatchObject({ ok: false, code: "PATH_MONITOR_FAILED" });
    expect(calls).toEqual(["media.refresh:failed", "stream.stop:phone-1"]);
  });

  it("WHEP 播放失败时停止对应设备的手机 WHIP", async () => {
    const calls: string[] = [];
    const media = {
      ...mediaFixture(calls),
      snapshot: () => ({
        phase: "running" as const,
        revision: 5,
        streams: [{ deviceId: "phone-1", phase: "publisher-ready" as const, diagnostic: null }],
        player: { phase: "failed" as const, deviceId: "phone-1" },
        diagnostic: null,
      }),
    };
    const lowLatency = LowLatencyMedia.create({ media, control: controlFixture(calls), startInput: {} });
    await lowLatency.refresh(20);
    expect(calls).toEqual(["media.refresh:20", "stream.stop:phone-1"]);
  });
});
