import { describe, expect, it } from "vitest";
import { WebRtcMedia, type ProcessExit } from "../src/modules/webrtc-media/index.js";

const options = {
  httpPort: 18_889,
  webRtcUdpPort: 8_189,
  apiPort: 9_997,
  pathPrefix: "/live",
  mode: "whip-whep" as const,
  publisherTimeoutMs: 1_000
};

const input = {
  interfaces: [{ name: "Wi-Fi", enabled: true, internal: false, kind: "wifi", ipv4: "192.168.1.20" }],
  manualHost: null,
  executablePath: "C:/private/tools/mediamtx.exe"
};

function fixture(config: {
  readonly launch?: (value: Readonly<{ readonly executablePath: string; readonly config: string }>, onExit: (event: ProcessExit) => void) => { readonly terminate: () => void };
  readonly clearPlayer?: () => void;
  readonly listPaths?: () => Promise<readonly string[]>;
} = {}) {
  let now = 0;
  let paths: readonly string[] = [];
  const exits: Array<(event: ProcessExit) => void> = [];
  const readies: Array<() => void> = [];
  const fatals: Array<(error: unknown) => void> = [];
  const targets: Array<Readonly<{ readonly deviceId: string; readonly url: string }>> = [];
  const calls: string[] = [];
  let terminations = 0;
  const media = WebRtcMedia.create({
    process: {
      launch: (value, onExit) => {
        calls.push("process-launch");
        exits.push(onExit);
        return config.launch?.(value, onExit) ?? { terminate: () => { calls.push("process-terminate"); terminations += 1; } };
      }
    },
    paths: { listPaths: async () => config.listPaths?.() ?? paths },
    player: {
      setTarget: (value, onReady, onFatal) => { targets.push(value); readies.push(onReady); fatals.push(onFatal); calls.push("player-set"); },
      clear: () => { calls.push("player-clear"); config.clearPlayer?.(); }
    },
    clock: () => now
  }, options);
  return {
    media,
    exits,
    readies,
    fatals,
    targets,
    calls,
    terminations: () => terminations,
    setPaths: (value: readonly string[]) => { paths = value; },
    setNow: (value: number) => { now = value; }
  };
}

describe("webrtc-media 一级组合根契约", () => {
  it("按顺序启动并提供脱敏快照、局域网 WHIP 和本机 WHEP 目标", () => {
    const { media, targets, calls } = fixture();
    expect(media.snapshot()).toEqual({ phase: "idle", revision: 0, streams: [], player: { phase: "idle", deviceId: null, revision: 0, diagnostic: null }, diagnostic: null });
    expect(media.start(input)).toMatchObject({ ok: true, value: { phase: "running", streams: [] } });
    expect(calls).toEqual(["process-launch"]);
    expect(media.publishTarget("drone-a")).toEqual({ ok: true, value: { kind: "whip", deviceId: "drone-a", url: "http://192.168.1.20:18889/live/drone-a/whip" } });
    expect(media.playback("drone-a")).toMatchObject({ ok: false, code: "UNKNOWN_DEVICE" });
    expect(JSON.stringify(media.snapshot())).not.toContain("192.168.1.20");
    expect(JSON.stringify(media.snapshot())).not.toContain("18889");
    expect(JSON.stringify(media.snapshot())).not.toContain("C:/private");
    expect(targets).toEqual([]);
  });

  it("观察多设备发布并只允许已发布设备选择播放器", async () => {
    const fixtureValue = fixture();
    const { media, setPaths, targets, readies } = fixtureValue;
    media.start(input);
    setPaths(["/live/drone-b", "/live/drone-a"]);
    expect((await media.evaluate(0))).toMatchObject({ ok: true, value: { phase: "running", streams: [{ deviceId: "drone-a", phase: "publisher-ready" }, { deviceId: "drone-b", phase: "publisher-ready" }] } });
    expect(media.playback("drone-a")).toEqual({ ok: true, value: { kind: "whep", deviceId: "drone-a", url: "http://127.0.0.1:18889/live/drone-a/whep" } });
    expect(media.selectPlayer("drone-a")).toMatchObject({ ok: true, value: { player: { phase: "connecting", deviceId: "drone-a" } } });
    expect(targets).toEqual([{ deviceId: "drone-a", url: "http://127.0.0.1:18889/live/drone-a/whep" }]);
    readies[0]!();
    expect(media.snapshot().player).toEqual({ phase: "playing", deviceId: "drone-a", revision: 2, diagnostic: null });
    expect(media.selectPlayer("missing")).toMatchObject({ ok: false, code: "UNKNOWN_DEVICE" });
  });

  it("把以数字开头的 UUID 设备标识视为已发布并给出 WHEP 目标", async () => {
    const { media, setPaths, targets } = fixture();
    const deviceId = "550e8400-e29b-41d4-a716-446655440000";
    media.start(input);
    setPaths([`/live/${encodeURIComponent(deviceId)}`]);
    expect((await media.evaluate(0))).toMatchObject({ ok: true, value: { streams: [{ deviceId, phase: "publisher-ready" }] } });
    expect(media.playback(deviceId)).toEqual({ ok: true, value: { kind: "whep", deviceId, url: `http://127.0.0.1:18889/live/${encodeURIComponent(deviceId)}/whep` } });
    expect(media.selectPlayer(deviceId)).toMatchObject({ ok: true, value: { player: { phase: "connecting", deviceId } } });
    expect(targets).toEqual([{ deviceId, url: `http://127.0.0.1:18889/live/${encodeURIComponent(deviceId)}/whep` }]);
  });

  it("把断开和超时隔离到对应设备", async () => {
    const { media, setPaths } = fixture();
    media.start(input);
    setPaths(["/live/drone-a", "/live/drone-b"]);
    await media.evaluate(0);
    setPaths(["/live/drone-b"]);
    expect((await media.evaluate(100))).toMatchObject({ ok: true, value: { streams: [{ deviceId: "drone-a", phase: "awaiting-publisher", diagnostic: "WebRTC 媒体发布已中断。请检查手机端和局域网连接。" }, { deviceId: "drone-b", phase: "publisher-ready" }] } });
    expect((await media.evaluate(1_101))).toMatchObject({ ok: true, value: { streams: [{ deviceId: "drone-a", phase: "failed" }, { deviceId: "drone-b", phase: "publisher-ready" }] } });
  });

  it("超时失败后重新发布可以再次选择播放器", async () => {
    const { media, setPaths } = fixture();
    media.start(input);
    setPaths(["/live/drone-a"]);
    await media.evaluate(0);
    setPaths([]);
    expect((await media.evaluate(100))).toMatchObject({ ok: true, value: { streams: [{ deviceId: "drone-a", phase: "awaiting-publisher" }] } });
    expect((await media.evaluate(1_101))).toMatchObject({ ok: true, value: { streams: [{ deviceId: "drone-a", phase: "failed" }] } });
    expect(media.selectPlayer("drone-a")).toMatchObject({ ok: false, code: "VIDEO_NOT_READY" });
    setPaths(["/live/drone-a"]);
    expect((await media.evaluate(1_200))).toMatchObject({ ok: true, value: { streams: [{ deviceId: "drone-a", phase: "publisher-ready" }] } });
    expect(media.selectPlayer("drone-a")).toMatchObject({ ok: true, value: { player: { phase: "connecting", deviceId: "drone-a" } } });
  });

  it("路径观察失败和进程退出都会给出稳定失败，不泄露适配器异常", async () => {
    let listFails = true;
    const failedPaths = fixture({ listPaths: async () => { if (listFails) throw new Error("http://127.0.0.1:9997/private-token"); return []; } });
    failedPaths.media.start(input);
    expect(await failedPaths.media.evaluate(0)).toMatchObject({ ok: false, code: "PATH_MONITOR_FAILED", value: { phase: "failed", diagnostic: "无法读取 MediaMTX 发布路径。请检查桌面媒体服务。" } });
    expect(JSON.stringify(failedPaths.media.snapshot())).not.toContain("private-token");

    const running = fixture();
    running.media.start(input);
    running.setPaths(["/live/drone-a"]);
    await running.media.evaluate(0);
    running.exits[0]!({ kind: "failed" });
    expect(running.media.snapshot()).toMatchObject({ phase: "failed", streams: [{ deviceId: "drone-a", phase: "failed", diagnostic: "MediaMTX 进程异常结束。请检查桌面媒体服务。" }] });
    listFails = false;
  });

  it("停止按播放器、观察器、进程的反向顺序推进，并隔离旧进程回调", async () => {
    const { media, exits, calls, terminations, setPaths } = fixture();
    media.start(input);
    setPaths(["/live/drone-a"]);
    await media.evaluate(0);
    expect(media.stop()).toMatchObject({ ok: true, value: { phase: "stopping" } });
    expect(calls).toEqual(["process-launch", "player-clear", "process-terminate"]);
    expect(terminations()).toBe(1);
    exits[0]!({ kind: "exited" });
    expect(media.snapshot()).toMatchObject({ phase: "idle", streams: [], player: { phase: "idle" } });
    exits[0]!({ kind: "failed" });
    expect(media.snapshot()).toMatchObject({ phase: "idle" });
  });

  it("停止时即使播放器清理失败也继续停止进程，并允许下一次清理", () => {
    let fail = true;
    const { media, exits, calls } = fixture({ clearPlayer: () => { if (fail) throw new Error("C:/private/player"); } });
    media.start(input);
    expect(media.stop()).toMatchObject({ ok: false, code: "PLAYER_FAILED", value: { phase: "failed" } });
    expect(calls).toEqual(["process-launch", "player-clear", "process-terminate"]);
    exits[0]!({ kind: "exited" });
    fail = false;
    expect(media.stop()).toMatchObject({ ok: true, value: { phase: "idle" } });
  });

  it("拒绝无效网卡、端点前的操作和重复启动，且支持人工私网地址优先", () => {
    const { media, calls } = fixture();
    expect(media.start({ ...input, interfaces: [], manualHost: null })).toMatchObject({ ok: false, code: "HOST_UNAVAILABLE", value: { phase: "failed" } });
    expect(media.start({ ...input, interfaces: [], manualHost: "10.0.0.8" })).toMatchObject({ ok: true, value: { phase: "running" } });
    expect(media.publishTarget("drone/a")).toEqual({ ok: true, value: { kind: "whip", deviceId: "drone/a", url: "http://10.0.0.8:18889/live/drone%2Fa/whip" } });
    expect(media.start(input)).toMatchObject({ ok: false, code: "ALREADY_ACTIVE" });
    expect(calls).toEqual(["process-launch"]);
  });

  it("处置后使所有资源回调失效", () => {
    const { media, exits, calls } = fixture();
    media.start(input);
    media.dispose();
    exits[0]!({ kind: "failed" });
    expect(media.snapshot()).toMatchObject({ phase: "disposed" });
    expect(calls).toEqual(["process-launch", "player-clear", "process-terminate"]);
    expect(media.start(input)).toMatchObject({ ok: false, code: "DISPOSED" });
    expect(media.stop()).toMatchObject({ ok: false, code: "DISPOSED" });
  });
});
