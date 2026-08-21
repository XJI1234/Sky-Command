import { describe, expect, it } from "vitest";
import { WhepPlayback } from "../src/modules/webrtc-media/whep-playback/index.js";

const target = { kind: "whep" as const, url: "http://127.0.0.1:18889/live/drone-a/whep" };

function fixture(options: { readonly setTarget?: (input: Readonly<{ readonly deviceId: string; readonly url: string }>, onReady: () => void, onFatal: (error: unknown) => void) => void; readonly clear?: () => void } = {}) {
  const targets: Array<Readonly<{ readonly deviceId: string; readonly url: string }>> = [];
  const readies: Array<() => void> = [];
  const fatals: Array<(error: unknown) => void> = [];
  let clears = 0;
  const player = WhepPlayback.create({
    setTarget: (input, onReady, onFatal) => { targets.push(input); readies.push(onReady); fatals.push(onFatal); options.setTarget?.(input, onReady, onFatal); },
    clear: () => { clears += 1; options.clear?.(); }
  });
  return { player, targets, readies, fatals, clears: () => clears };
}

describe("whep-playback 契约", () => {
  it("将合法目标交给适配器，并在首帧回调后进入 playing", () => {
    const { player, targets, readies } = fixture();
    expect(player.snapshot()).toEqual({ phase: "idle", deviceId: null, revision: 0, diagnostic: null });
    expect(player.select({ deviceId: "drone-a", target })).toEqual({ ok: true, value: { phase: "connecting", deviceId: "drone-a", revision: 1, diagnostic: null } });
    expect(targets).toEqual([{ deviceId: "drone-a", url: target.url }]);
    readies[0]!();
    expect(player.snapshot()).toEqual({ phase: "playing", deviceId: "drone-a", revision: 2, diagnostic: null });
  });

  it("拒绝非回环、非 WHEP 和带敏感部分的目标", () => {
    const { player, targets } = fixture();
    const invalid = [
      null,
      {},
      { deviceId: "drone-a", target: { kind: "hls", url: target.url } },
      { deviceId: "drone-a", target: { kind: "whep", url: "http://192.168.1.20:18889/live/drone-a/whep" } },
      { deviceId: "drone-a", target: { kind: "whep", url: "http://user:pass@127.0.0.1:18889/live/drone-a/whep" } },
      { deviceId: "drone-a", target: { kind: "whep", url: `${target.url}?token=secret` } },
      { deviceId: "drone-a", target: { kind: "whep", url: `${target.url}#fragment` } },
      { deviceId: "drone-a", target: { kind: "whep", url: "http://127.0.0.1:18889/live/other/whep" } },
      { deviceId: "drone-a", target: { kind: "whep", url: "not-url" } }
    ];
    for (const input of invalid) expect(player.select(input)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(targets).toHaveLength(0);
  });

  it("隔离旧代次，并把同步和异步故障转换为固定诊断", () => {
    const { player, readies, fatals } = fixture();
    player.select({ deviceId: "drone-a", target });
    player.select({ deviceId: "drone-b", target: { ...target, url: "https://localhost:18889/live/drone-b/whep" } });
    readies[0]!();
    expect(player.snapshot()).toMatchObject({ phase: "connecting", deviceId: "drone-b" });
    fatals[0]!(new Error("old secret"));
    expect(player.snapshot()).toMatchObject({ phase: "connecting", deviceId: "drone-b" });
    fatals[1]!(new Error("secret"));
    expect(player.snapshot()).toEqual({ phase: "failed", deviceId: "drone-b", revision: 3, diagnostic: "WHEP 播放器无法建立连接。请检查桌面媒体服务。" });

    let fail = true;
    const second = fixture({ setTarget: (_input, _ready, _fatal) => { if (fail) throw new Error("secret"); } });
    expect(second.player.select({ deviceId: "drone-a", target })).toMatchObject({ ok: false, code: "SOURCE_FAILED", value: { phase: "failed" } });
    fail = false;
    expect(second.player.select({ deviceId: "drone-a", target })).toMatchObject({ ok: true, value: { phase: "connecting" } });
  });

  it("清理会使回调失效，清理失败后允许重试", () => {
    let fail = true;
    const { player, readies, clears } = fixture({ clear: () => { if (fail) throw new Error("secret"); } });
    player.select({ deviceId: "drone-a", target });
    expect(player.clear()).toMatchObject({ ok: false, code: "CLEAR_FAILED", value: { phase: "failed", deviceId: null } });
    fail = false;
    expect(player.clear()).toMatchObject({ ok: true, value: { phase: "idle", deviceId: null } });
    readies[0]!();
    expect(player.snapshot()).toMatchObject({ phase: "idle" });
    expect(clears()).toBe(2);
  });
});
