import { describe, expect, it } from "vitest";
import { MediaMtxProcess, type ProcessExit, type StartInput } from "../src/modules/webrtc-media/mediamtx-process/index.js";

const input: StartInput = {
  executablePath: "C:/private/tools/mediamtx.exe",
  httpPort: 18_889,
  webRtcUdpPort: 8_189,
  apiPort: 9_997,
  pathPrefix: "/live",
  publicHost: "192.168.1.20",
  mode: "whip-whep"
};

function fixture(options: {
  readonly launch?: (value: Readonly<{ readonly executablePath: string; readonly config: string }>, onExit: (event: ProcessExit) => void) => { readonly terminate: () => void };
  readonly onExit?: (event: ProcessExit) => void;
} = {}) {
  const launches: Array<Readonly<{ readonly executablePath: string; readonly config: string }>> = [];
  const exits: Array<(event: ProcessExit) => void> = [];
  let terminations = 0;
  const process = MediaMtxProcess.create({
    launch: (value, onExit) => {
      launches.push(value);
      exits.push(onExit);
      return options.launch?.(value, onExit) ?? { terminate: () => { terminations += 1; } };
    }
  });
  return { process, launches, exits, terminations: () => terminations };
}

describe("mediamtx-process 契约", () => {
  it("生成只开放 WHIP/WHEP 与本机 API 的确定性配置", () => {
    const { process, launches } = fixture();
    const events: ProcessExit[] = [];

    expect(process.snapshot()).toEqual({ phase: "idle", revision: 0, httpPort: null, webRtcUdpPort: null, apiPort: null, pathPrefix: null, diagnostic: null });
    expect(process.start(input, { onExit: (event) => events.push(event) })).toEqual({ ok: true, value: { phase: "running", revision: 2, httpPort: 18_889, webRtcUdpPort: 8_189, apiPort: 9_997, pathPrefix: "/live", diagnostic: null } });
    expect(launches).toHaveLength(1);
    expect(launches[0]).toEqual(expect.objectContaining({ executablePath: input.executablePath }));
    expect(Object.isFrozen(launches[0])).toBe(true);
    const config = launches[0]!.config;
    expect(config).toContain("webrtc: yes");
    expect(config).toContain("webrtcAddress: :18889");
    expect(config).toContain("webrtcLocalUDPAddress: :8189");
    expect(config).toContain("webrtcIPsFromInterfaces: no");
    expect(config).toContain("webrtcAdditionalHosts:\n  - 192.168.1.20");
    expect(config).toContain("api: yes");
    expect(config).toContain("apiAddress: 127.0.0.1:9997");
    expect(config).toContain('"~^live(?:/.*)?$"');
    expect(config).toContain("rtsp: no");
    expect(config).toContain("rtmp: no");
    expect(config).toContain("hls: no");
    expect(config).toContain("srt: no");
    expect(JSON.stringify(process.snapshot())).not.toContain("C:/private");
    expect(events).toEqual([]);
  });

  it("拒绝非法输入和活动期间重复启动，且不触碰进程端口", () => {
    const { process, launches } = fixture();
    const invalidInputs: unknown[] = [
      null,
      {},
      { ...input, executablePath: " " },
      { ...input, httpPort: 1023 },
      { ...input, webRtcUdpPort: 65_536 },
      { ...input, apiPort: 18_889 },
      { ...input, pathPrefix: "live" },
      { ...input, pathPrefix: "/live/other" },
      { ...input, pathPrefix: "/live?token=secret" },
      { ...input, publicHost: "192.168.1.999" },
      { ...input, publicHost: "192.168.1.20:18889" },
      { ...input, mode: "rtmp" }
    ];
    for (const value of invalidInputs) expect(process.start(value, { onExit: () => undefined })).toMatchObject({ ok: false, code: "INVALID_INPUT", value: { phase: "idle" } });
    expect(launches).toHaveLength(0);

    process.start(input, { onExit: () => undefined });
    expect(process.start({ ...input, httpPort: 18_890 }, { onExit: () => undefined })).toMatchObject({ ok: false, code: "ALREADY_ACTIVE", value: { phase: "running", httpPort: 18_889 } });
    expect(launches).toHaveLength(1);
  });

  it("将启动异常和启动期退出转换为固定诊断，并支持失败后重启", () => {
    let fail = true;
    const events: ProcessExit[] = [];
    const { process, launches } = fixture({ launch: (_value, _onExit) => {
      if (fail) throw new Error("C:/private/mediamtx config");
      return { terminate: () => undefined };
    } });
    const first = process.start(input, { onExit: (event) => events.push(event) });
    expect(first).toEqual({ ok: false, code: "START_FAILED", value: { phase: "failed", revision: 2, httpPort: null, webRtcUdpPort: null, apiPort: null, pathPrefix: null, diagnostic: "MediaMTX 进程未能启动。请检查桌面媒体服务。" } });
    expect(JSON.stringify(first)).not.toContain("private");
    fail = false;
    expect(process.start(input, { onExit: (event) => events.push(event) })).toMatchObject({ ok: true, value: { phase: "running", revision: 4 } });
    expect(launches).toHaveLength(2);

    let synchronousExit: ((event: ProcessExit) => void) | null = null;
    const exited = MediaMtxProcess.create({ launch: (_value, onExit) => {
      synchronousExit = onExit;
      onExit({ kind: "exited" });
      return { terminate: () => undefined };
    } });
    expect(exited.start(input, { onExit: () => undefined })).toMatchObject({ ok: false, code: "START_FAILED", value: { phase: "failed", diagnostic: "MediaMTX 进程未能启动。请检查桌面媒体服务。" } });
    synchronousExit!({ kind: "failed" });
    expect(exited.snapshot()).toMatchObject({ phase: "failed", revision: 2 });
  });

  it("把当前进程退出通知外层，隔离旧代次退出", () => {
    const events: ProcessExit[] = [];
    const { process, exits } = fixture();
    process.start(input, { onExit: (event) => events.push(event) });
    exits[0]!({ kind: "failed" });
    expect(process.snapshot()).toEqual({ phase: "failed", revision: 3, httpPort: null, webRtcUdpPort: null, apiPort: null, pathPrefix: null, diagnostic: "MediaMTX 进程异常结束。请检查桌面媒体服务。" });
    expect(events).toEqual([{ kind: "failed" }]);

    process.start({ ...input, httpPort: 18_890 }, { onExit: (event) => events.push(event) });
    exits[0]!({ kind: "failed" });
    expect(process.snapshot()).toMatchObject({ phase: "running", httpPort: 18_890, revision: 5 });
    exits[1]!({ kind: "exited" });
    expect(process.snapshot()).toMatchObject({ phase: "failed", httpPort: null, revision: 6 });
    expect(events).toEqual([{ kind: "failed" }, { kind: "exited" }]);
  });

  it("停止时等待退出事实，停止异常可重试，并继续隔离实例", () => {
    let fail = true;
    const first = fixture({ launch: (_value, _onExit) => ({ terminate: () => { if (fail) throw new Error("private"); } }) });
    first.process.start(input, { onExit: () => undefined });
    expect(first.process.stop()).toEqual({ ok: false, code: "STOP_FAILED", value: { phase: "running", revision: 4, httpPort: 18_889, webRtcUdpPort: 8_189, apiPort: 9_997, pathPrefix: "/live", diagnostic: "无法停止 MediaMTX 进程。请检查桌面媒体服务。" } });
    fail = false;
    expect(first.process.stop()).toMatchObject({ ok: true, value: { phase: "stopping", revision: 5 } });
    expect(first.terminations()).toBe(0);

    first.exits[0]!({ kind: "exited" });
    expect(first.process.snapshot()).toEqual({ phase: "idle", revision: 6, httpPort: null, webRtcUdpPort: null, apiPort: null, pathPrefix: null, diagnostic: null });
    expect(first.process.stop()).toMatchObject({ ok: false, code: "NOT_RUNNING" });

    const second = fixture();
    second.process.start({ ...input, httpPort: 18_891 }, { onExit: () => undefined });
    expect(second.process.snapshot()).toMatchObject({ phase: "running", httpPort: 18_891 });
    expect(first.process.snapshot()).toMatchObject({ phase: "idle" });
  });

  it("失败态可完成清理，处置会使迟到回调失效", () => {
    const { process, exits, terminations } = fixture();
    process.start(input, { onExit: () => undefined });
    exits[0]!({ kind: "failed" });
    expect(process.stop()).toMatchObject({ ok: true, value: { phase: "idle" } });
    process.start(input, { onExit: () => undefined });
    process.dispose();
    expect(terminations()).toBe(1);
    exits[1]!({ kind: "failed" });
    expect(process.snapshot()).toEqual({ phase: "disposed", revision: 7, httpPort: null, webRtcUdpPort: null, apiPort: null, pathPrefix: null, diagnostic: null });
    expect(process.start(input, { onExit: () => undefined })).toMatchObject({ ok: false, code: "DISPOSED", value: { phase: "disposed" } });
    expect(process.stop()).toMatchObject({ ok: false, code: "DISPOSED", value: { phase: "disposed" } });
    process.dispose();
    expect(process.snapshot().revision).toBe(7);
  });

  it("拒绝不完整的进程端口和事件端口", () => {
    for (const port of [null, {}, { launch: 7 }]) expect(() => MediaMtxProcess.create(port as never)).toThrow("Invalid MediaMTX process port");
    const { process, launches } = fixture();
    expect(process.start(input, null)).toMatchObject({ ok: false, code: "INVALID_INPUT", value: { phase: "idle" } });
    expect(launches).toHaveLength(0);
  });
});
