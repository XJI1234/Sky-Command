import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { afterEach, expect, it, vi } from "vitest";
import { createPlaybackProgress } from "../src/production/operator-console/renderer/playback-progress.js";

const source = readFileSync(new URL("../src/production/operator-console/renderer/main.ts", import.meta.url), "utf8");
const code = transformSync(source.slice(source.indexOf("let flvPlayer:"), source.indexOf("const accepted ="))
  + source.slice(source.indexOf("type MonitorPlayer ="), source.indexOf("async function ensureMonitorPlayback")), { loader: "ts" }).code;

function harness(workspace = "flight") {
  vi.useFakeTimers(); vi.setSystemTime(50_000);
  const visibility = new Set<() => void>();
  const document = { hidden: false, body: { append: vi.fn() }, getElementById: () => null, querySelector: () => video,
    createElement: () => ({ textContent: "" }), addEventListener: (_event: string, callback: () => void) => visibility.add(callback) };
  let frames = 24;
  const video = Object.assign(new EventTarget(), {
    currentTime: 1, readyState: 4, paused: false, videoWidth: 1920, videoHeight: 1080, seeking: false, ended: false, error: null,
    buffered: { length: 1, start: (): number => 0, end: (): number => 1.5 },
    getVideoPlaybackQuality: () => ({ totalVideoFrames: frames }),
    play: vi.fn(async () => { video.paused = false }), load: vi.fn(), setAttribute: vi.fn(), removeAttribute: vi.fn(),
  });
  let currentTime = 1;
  const seeks: number[] = [];
  Object.defineProperty(video, "currentTime", { get: () => currentTime, set: value => { currentTime = value; seeks.push(value) } });
  const playTimes: number[] = [];
  video.play.mockImplementation(async () => { playTimes.push(video.currentTime); video.paused = false });
  const configs: Record<string, unknown>[] = [];
  const players: { emit: (event: string) => void; destroy: ReturnType<typeof vi.fn> }[] = [];
  const mpegts = { isSupported: () => true, Events: { MEDIA_INFO: "info", ERROR: "error", LOADING_COMPLETE: "complete" },
    createPlayer: (_source: unknown, config: Record<string, unknown>) => {
      configs.push(config);
      const listeners = new Map<string, (...args: unknown[]) => void>();
      const player = { on: (event: string, callback: (...args: unknown[]) => void) => listeners.set(event, callback),
        emit: (event: string) => listeners.get(event)?.("NetworkError", "EarlyEof"),
        pause: vi.fn(), unload: vi.fn(), detachMediaElement: vi.fn(), destroy: vi.fn(), attachMediaElement: vi.fn(), load: vi.fn() };
      players.push(player); return player;
    } };
  const record = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
  const api = runInNewContext(`${code}\n({attachVideo, detachVideo, watchPlaybackStall, attachMonitorPlayer, releaseMonitorSlot, chaseLiveEdge})`, {
    mpegts, document, window: { setTimeout, clearTimeout, setInterval, clearInterval }, Date, URL, console,
    HTMLMediaElement: { HAVE_CURRENT_DATA: 2 }, HTMLVideoElement: EventTarget, state: { workspace, streamDeviceId: "fixture" },
    createPlaybackProgress, el: () => video,
    safeRenderInvoke: record, show: vi.fn(), showPlaybackHealth: vi.fn(), lastPlaybackIdentity: "off",
  }) as { attachVideo(url: string): void; detachVideo(): void; watchPlaybackStall(element: typeof video): void;
    attachMonitorPlayer(slot: number, deviceId: string, url: string): void; releaseMonitorSlot(slot: number): void;
    chaseLiveEdge(element: Pick<typeof video, "currentTime" | "buffered" | "seeking">): void };
  if (workspace === "monitor") api.attachMonitorPlayer(0, "fixture", "http://127.0.0.1:18080/live/fixture.flv");
  else { api.attachVideo("http://127.0.0.1:18080/live/fixture.flv"); api.watchPlaybackStall(video); }
  return { api, players, video, document, record, seeks, playTimes, configs, setVisible: (visible: boolean) => { document.hidden = !visible; visibility.forEach(callback => callback()) },
    progress: () => { frames++; video.currentTime += 1; api.watchPlaybackStall(video) } };
}
afterEach(() => { vi.useRealTimers() });

it("recovers an ended live transport without waiting for the first-frame timeout", () => {
  const h = harness();
  h.players[0]!.emit("complete");
  vi.advanceTimersByTime(1_000);
  expect(h.players).toHaveLength(2);
});

it("ignores late errors and completion from a replaced player", () => {
  const h = harness();
  h.api.attachVideo("http://127.0.0.1:18080/live/other.flv");
  h.players[0]!.emit("error"); h.players[0]!.emit("complete");
  vi.advanceTimersByTime(1_000);
  expect(h.players).toHaveLength(2);
  expect(h.players[1]!.destroy).not.toHaveBeenCalled();
});

it("preserves background playback and grants a fresh foreground grace period, then detects a real freeze", () => {
  const h = harness();
  h.setVisible(false);
  vi.advanceTimersByTime(40_000);
  expect(h.players).toHaveLength(1);
  h.setVisible(true);
  vi.advanceTimersByTime(10_000);
  expect(h.players).toHaveLength(1);
  vi.advanceTimersByTime(6_000);
  expect(h.players).toHaveLength(2);
});

it("records monitor media stalls and removes listeners when the slot is released", () => {
  const h = harness("monitor");
  h.video.dispatchEvent(new Event("waiting"));
  expect(h.record.mock.calls.some(call => {
    const input = call[1] as { reason: string };
    const value = JSON.parse(input.reason);
    return value.event === "media-event" && value.reason === "waiting" && value.slot === 0;
  })).toBe(true);
  h.api.releaseMonitorSlot(0);
  h.record.mockClear();
  h.video.dispatchEvent(new Event("waiting"));
  expect(h.record).not.toHaveBeenCalled();
});

it("ignores a replaced monitor player's media info, errors and completion", () => {
  const h = harness("monitor");
  h.api.attachMonitorPlayer(0, "other", "http://127.0.0.1:18080/live/other.flv");
  h.video.play.mockClear();
  for (const event of ["info", "error", "complete"]) h.players[0]!.emit(event);
  expect(h.video.play).not.toHaveBeenCalled();
  expect(h.players[1]!.destroy).not.toHaveBeenCalled();
});

it.each(["flight", "monitor"])("%s removes avoidable input batching for live video", workspace => {
  const h = harness(workspace);
  expect(h.configs[0]?.enableStashBuffer).toBe(false);
  expect(h.configs[0]?.stashInitialSize).toBeUndefined();
});

it.each(["flight", "monitor"])("%s corrects two seconds of lag within 250ms even without timeupdate", workspace => {
  const h = harness(workspace);
  h.video.buffered.end = () => 3;
  vi.advanceTimersByTime(250);
  expect(3 - h.video.currentTime).toBeCloseTo(0.3);
  expect(h.players).toHaveLength(1);
});

it.each(["flight", "monitor"])("%s resumes a background-paused video at the live edge before playing", workspace => {
  const h = harness(workspace);
  h.setVisible(false);
  h.video.paused = true;
  h.video.buffered.start = () => 330;
  h.video.buffered.end = () => 360;
  vi.advanceTimersByTime(60_000);
  expect(h.seeks).toHaveLength(0);
  h.playTimes.length = 0;
  h.setVisible(true);
  vi.advanceTimersByTime(0);
  expect(h.video.currentTime).toBeCloseTo(359.7);
  expect(h.playTimes).toEqual([359.7]);
  expect(h.players).toHaveLength(1);
});

it.each(["flight", "monitor"])("%s never seeks during normal low-latency playback", workspace => {
  const h = harness(workspace);
  for (let i = 0; i < 30; i++) {
    h.video.dispatchEvent(new Event("timeupdate"));
    vi.advanceTimersByTime(250);
  }
  expect(h.seeks).toHaveLength(0);
  expect(h.players).toHaveLength(1);
});

it.each(["flight", "monitor"])("%s protects an in-progress seek and resumes chasing after its bounded cooldown", workspace => {
  const h = harness(workspace);
  h.video.buffered.end = () => 3;
  h.video.seeking = true;
  vi.advanceTimersByTime(250);
  expect(h.seeks).toHaveLength(0);
  h.video.seeking = false;
  vi.advanceTimersByTime(250);
  expect(h.seeks).toHaveLength(1);
  h.video.buffered.end = () => 5;
  h.video.dispatchEvent(new Event("timeupdate"));
  expect(h.seeks).toHaveLength(1);
  vi.advanceTimersByTime(500);
  expect(h.seeks).toHaveLength(2);
  expect(h.video.currentTime).toBeCloseTo(4.7);
});

it("keeps each video's seek cooldown independent and clamps short disjoint buffered ranges", () => {
  const h = harness("monitor");
  const first = { currentTime: 1, seeking: false, buffered: { length: 1, start: () => 0, end: () => 3 } };
  const second = { currentTime: 1, seeking: false, buffered: { length: 2, start: () => 9.9, end: () => 10 } };
  h.api.chaseLiveEdge(first);
  h.api.chaseLiveEdge(second);
  expect(first.currentTime).toBeCloseTo(2.7);
  expect(second.currentTime).toBeCloseTo(9.9);
});

it.each(["flight", "monitor"])("%s unbinds latency checks when released", workspace => {
  const h = harness(workspace);
  if (workspace === "flight") h.api.detachVideo();
  else h.api.releaseMonitorSlot(0);
  h.video.buffered.end = () => 100;
  for (const event of ["timeupdate", "loadeddata", "canplay"]) h.video.dispatchEvent(new Event(event));
  vi.advanceTimersByTime(250);
  expect(h.seeks).toHaveLength(0);
});
