import { describe, expect, it } from "vitest";
import { VideoPlayer } from "../src/modules/media-pipeline/video-player/index.js";

const source = { deviceId: "drone-a", url: "http://127.0.0.1:18080/live/drone-a.flv" };
const SOURCE_FAILED = "播放器无法加载视频源。请检查图传流与本地图传服务。";
const CLEAR_FAILED = "播放器无法清理当前视频源。请检查播放器状态。";
const FATAL = "播放器报告了致命错误。请检查图传流与本地图传服务。";

function fixture(options: { readonly setSource?: (input: Readonly<typeof source>, onFatal: (error: unknown) => void) => void; readonly clear?: () => void } = {}) {
  const sources: Array<Readonly<typeof source>> = [];
  const callbacks: Array<(error: unknown) => void> = [];
  let clears = 0;
  const player = VideoPlayer.create({
    setSource: (input, onFatal) => { sources.push(input); callbacks.push(onFatal); options.setSource?.(input, onFatal); },
    clear: () => { clears += 1; options.clear?.(); }
  });
  return { player, sources, callbacks, clears: () => clears };
}

describe("media-pipeline video-player 契约", () => {
  it("将合法 HTTP-FLV 地址交给适配器并支持替换设备", () => {
    const { player, sources } = fixture();
    expect(player.snapshot()).toEqual({ phase: "idle", deviceId: null, revision: 0, diagnostic: null });
    const input = { ...source };
    expect(player.select(input)).toEqual({ ok: true, value: { phase: "playing", deviceId: "drone-a", revision: 1, diagnostic: null } });
    input.deviceId = "changed";
    expect(sources[0]).toEqual(source);
    expect(player.select({ deviceId: "drone-b", url: "https://localhost:1/live.flv" })).toEqual({ ok: true, value: { phase: "playing", deviceId: "drone-b", revision: 2, diagnostic: null } });
  });

  it("拒绝畸形输入并且不触碰适配器", () => {
    const { player, sources, clears } = fixture();
    const callableInput = Object.assign(() => undefined, source);
    const coercibleUrl = { toString: () => source.url };
    const invalid: readonly unknown[] = [null, 1, {}, callableInput, { deviceId: " ", url: source.url }, { deviceId: "a\0b", url: source.url }, { deviceId: "a".repeat(129), url: source.url }, { deviceId: "a", url: 1 }, { deviceId: "a", url: coercibleUrl }, { deviceId: "a", url: "ftp://localhost.flv" }, { deviceId: "a", url: "http://user:pass@localhost.flv" }, { deviceId: "a", url: "http://user@localhost.flv" }, { deviceId: "a", url: "http://:pass@localhost.flv" }, { deviceId: "a", url: "http://localhost.flv?token=secret" }, { deviceId: "a", url: "http://localhost.flv#part" }, { deviceId: "a", url: "http://localhost/live/stream.m3u8" }, { deviceId: "a", url: "not-url" }];
    for (const value of invalid) expect(player.select(value)).toEqual({ ok: false, code: "INVALID_INPUT", value: player.snapshot() });
    expect(sources).toHaveLength(0);
    expect(player.select({ deviceId: "a".repeat(128), url: source.url })).toMatchObject({ ok: true, value: { deviceId: "a".repeat(128) } });
    expect(player.clear()).toEqual({ ok: true, value: { phase: "idle", deviceId: null, revision: 2, diagnostic: null } });
    expect(clears()).toBe(1);
  });

  it("拒绝已封存 HLS 播放列表，生产播放器只接收 HTTP-FLV", () => {
    const { player, sources } = fixture();
    expect(player.select({ deviceId: "drone-a", url: "http://127.0.0.1:18080/live/index.m3u8" })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      value: player.snapshot(),
    });
    expect(sources).toHaveLength(0);
  });

  it("将源加载异常转换为脱敏失败并允许重新选择", () => {
    let fail = true;
    const { player, sources } = fixture({ setSource: () => { if (fail) throw new Error("secret url / token"); } });
    expect(player.select(source)).toEqual({ ok: false, code: "SOURCE_FAILED", value: { phase: "failed", deviceId: "drone-a", revision: 2, diagnostic: SOURCE_FAILED } });
    expect(JSON.stringify(player.snapshot())).not.toContain("secret");
    fail = false;
    expect(player.select({ deviceId: "drone-b", url: source.url })).toMatchObject({ ok: true, value: { phase: "playing", deviceId: "drone-b" } });
    expect(sources).toHaveLength(2);
  });

  it("只接受当前代次的致命回调并将故障脱敏", () => {
    const { player, callbacks } = fixture();
    player.select(source);
    const old = callbacks[0]!;
    player.select({ deviceId: "drone-b", url: source.url });
    old(new Error("old secret"));
    expect(player.snapshot()).toMatchObject({ phase: "playing", deviceId: "drone-b", revision: 2 });
    callbacks[1]!(new Error("new secret"));
    expect(player.snapshot()).toEqual({ phase: "failed", deviceId: "drone-b", revision: 3, diagnostic: FATAL });
    callbacks[1]!(new Error("repeat"));
    expect(player.snapshot().revision).toBe(3);
    expect(JSON.stringify(player.snapshot())).not.toContain("secret");
  });

  it("同步致命回调归入本次选择，清理会使回调失效", () => {
    const { player, callbacks } = fixture({ setSource: (_input, onFatal) => onFatal(new Error("sync")) });
    expect(player.select(source)).toEqual({ ok: true, value: { phase: "failed", deviceId: "drone-a", revision: 2, diagnostic: FATAL } });
    expect(player.clear()).toEqual({ ok: true, value: { phase: "idle", deviceId: null, revision: 3, diagnostic: null } });
    callbacks[0]!(new Error("late"));
    expect(player.snapshot()).toMatchObject({ phase: "idle", deviceId: null, revision: 3 });
  });

  it("清理异常进入失败并且之后可以重试", () => {
    let fail = true;
    const { player, clears } = fixture({ clear: () => { if (fail) throw new Error("secret clear"); } });
    player.select(source);
    expect(player.clear()).toEqual({ ok: false, code: "CLEAR_FAILED", value: { phase: "failed", deviceId: null, revision: 2, diagnostic: CLEAR_FAILED } });
    fail = false;
    expect(player.clear()).toEqual({ ok: true, value: { phase: "idle", deviceId: null, revision: 3, diagnostic: null } });
    expect(clears()).toBe(2);
  });

  it("冻结所有公开对象并隔离实例", () => {
    const first = fixture().player;
    const second = fixture().player;
    const result = first.select(source);
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(first.snapshot())).toBe(true);
    expect(first.snapshot()).not.toBe(second.snapshot());
    expect(second.snapshot()).toEqual({ phase: "idle", deviceId: null, revision: 0, diagnostic: null });
  });

  it("拒绝不完整的播放器适配器", () => {
    const callablePort = Object.assign(() => undefined, { setSource: () => undefined, clear: () => undefined });
    for (const port of [null, 1, {}, callablePort, { setSource: () => undefined }, { clear: () => undefined }, { setSource: 1, clear: 2 }]) {
      expect(() => VideoPlayer.create(port as never)).toThrow("Invalid video player port");
    }
  });
});
