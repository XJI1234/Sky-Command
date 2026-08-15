import { describe, expect, it } from "vitest";
import { TranscodeRunner, type ProcessExit, type TranscodeJob } from "../src/modules/media-pipeline/transcode-runner/index.js";

const job: TranscodeJob = {
  streamId: "phone-1",
  executablePath: "C:/tools/ffmpeg.exe",
  inputUrl: "rtmp://192.168.1.8:19500/live/phone-1?token=private",
  outputDirectory: "C:/private/hls/phone-1"
};

function fixture(options: { readonly launch?: (job: TranscodeJob, onExit: (event: ProcessExit) => void) => { readonly terminate: () => void } } = {}) {
  const exits: Array<(event: ProcessExit) => void> = [];
  const launches: TranscodeJob[] = [];
  let terminations = 0;
  const runner = TranscodeRunner.create({ launch: (input, onExit) => {
    launches.push(input);
    exits.push(onExit);
    return options.launch ? options.launch(input, onExit) : { terminate: () => { terminations += 1; } };
  } });
  return { runner, exits, launches, terminations: () => terminations };
}

describe("媒体管线 transcode-runner 契约", () => {
  it("从冻结的空闲快照启动单条转码，并且不暴露敏感作业字段", () => {
    const { runner, launches } = fixture();
    expect(runner.snapshot()).toEqual({ streamId: null, phase: "idle", revision: 0, diagnostic: null });

    const result = runner.start(job);

    expect(result).toEqual({ ok: true, value: { streamId: "phone-1", phase: "running", revision: 1, diagnostic: null } });
    expect(launches).toEqual([job]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("C:/");
    expect(JSON.stringify(result)).not.toContain("token=private");
  });

  it("拒绝畸形作业和活动期间重复启动，且不创建额外进程", () => {
    const { runner, launches } = fixture();
    for (const invalid of [null, {}, { ...job, streamId: " " }, { ...job, streamId: "a\0b" }, { ...job, streamId: "a".repeat(129) }, { ...job, executablePath: " " }, { ...job, inputUrl: "" }, { ...job, outputDirectory: "" }]) {
      expect(runner.start(invalid)).toMatchObject({ ok: false, code: "INVALID_INPUT", value: { phase: "idle" } });
    }
    const boundary = TranscodeRunner.create({ launch: () => ({ terminate: () => undefined }) });
    expect(boundary.start({ ...job, streamId: "a".repeat(128) })).toMatchObject({ ok: true, value: { streamId: "a".repeat(128), phase: "running" } });
    const malformedHandle = TranscodeRunner.create({ launch: () => ({}) as never });
    expect(malformedHandle.start(job)).toEqual({ ok: false, code: "LAUNCH_FAILED", value: { streamId: "phone-1", phase: "failed", revision: 1, diagnostic: "转码进程未能启动。请检查 FFmpeg 与输入流。" } });
    runner.start(job);
    expect(runner.start({ ...job, streamId: "phone-2" })).toMatchObject({ ok: false, code: "ALREADY_ACTIVE", value: { phase: "running" } });
    expect(launches).toEqual([job]);
  });

  it("将启动异常和非预期退出映射为固定诊断，并允许失败后重启", () => {
    const failedLaunch = TranscodeRunner.create({ launch: () => { throw new Error(`cannot start ${job.inputUrl}`); } });
    expect(failedLaunch.start(job)).toEqual({ ok: false, code: "LAUNCH_FAILED", value: { streamId: "phone-1", phase: "failed", revision: 1, diagnostic: "转码进程未能启动。请检查 FFmpeg 与输入流。" } });

    const { runner, exits, launches } = fixture();
    runner.start(job);
    exits[0]!({ kind: "exited" });
    expect(runner.snapshot()).toEqual({ streamId: "phone-1", phase: "failed", revision: 2, diagnostic: "转码进程异常结束。请检查 FFmpeg 与输入流。" });
    expect(runner.start({ ...job, streamId: "phone-2" })).toMatchObject({ ok: true, value: { streamId: "phone-2", phase: "running", revision: 3 } });
    exits[0]!({ kind: "failed" });
    expect(runner.snapshot()).toMatchObject({ streamId: "phone-2", phase: "running", revision: 3 });
    expect(launches).toHaveLength(2);
  });

  it("请求停止后等待当前退出回调，并拒绝非运行状态的停止", () => {
    const { runner, exits, terminations } = fixture();
    expect(runner.stop()).toMatchObject({ ok: false, code: "NOT_RUNNING", value: { phase: "idle" } });
    runner.start(job);
    expect(runner.stop()).toEqual({ ok: true, value: { streamId: "phone-1", phase: "stopping", revision: 2, diagnostic: null } });
    expect(terminations()).toBe(1);
    expect(runner.stop()).toMatchObject({ ok: false, code: "NOT_RUNNING", value: { phase: "stopping" } });
    expect(runner.start({ ...job, streamId: "phone-2" })).toMatchObject({ ok: false, code: "ALREADY_ACTIVE", value: { phase: "stopping" } });
    exits[0]!({ kind: "exited" });
    expect(runner.snapshot()).toEqual({ streamId: "phone-1", phase: "stopped", revision: 3, diagnostic: null });
    exits[0]!({ kind: "failed" });
    expect(runner.snapshot()).toEqual({ streamId: "phone-1", phase: "stopped", revision: 3, diagnostic: null });
  });

  it("停止请求异常时保持运行态并返回固定诊断，之后可以重试停止", () => {
    let terminateFails = true;
    const runner = TranscodeRunner.create({ launch: () => ({ terminate: () => {
      if (terminateFails) throw new Error(`permission denied ${job.outputDirectory}`);
    } }) });
    runner.start(job);
    expect(runner.stop()).toEqual({ ok: false, code: "STOP_FAILED", value: { streamId: "phone-1", phase: "running", revision: 3, diagnostic: "无法停止转码进程。请检查 FFmpeg 与输入流。" } });
    terminateFails = false;
    expect(runner.stop()).toMatchObject({ ok: true, value: { phase: "stopping", revision: 4, diagnostic: null } });
  });

  it("正确处理 launch 返回前同步发生的退出，并拒绝无效装配依赖", () => {
    const runner = TranscodeRunner.create({ launch: (_input, onExit) => {
      onExit({ kind: "failed" });
      return { terminate: () => undefined };
    } });
    expect(runner.start(job)).toEqual({ ok: true, value: { streamId: "phone-1", phase: "failed", revision: 2, diagnostic: "转码进程异常结束。请检查 FFmpeg 与输入流。" } });
    for (const port of [null, {}, { launch: 7 }]) {
      expect(() => TranscodeRunner.create(port as never)).toThrow("Invalid transcoder process port");
    }
  });

  it("同步退出后即使适配器继续抛错，也以已确认的退出状态为准", () => {
    const runner = TranscodeRunner.create({ launch: (_input, onExit) => {
      onExit({ kind: "exited" });
      throw new Error("late launch failure");
    } });
    expect(runner.start(job)).toEqual({ ok: true, value: { streamId: "phone-1", phase: "failed", revision: 2, diagnostic: "转码进程异常结束。请检查 FFmpeg 与输入流。" } });

    let onExit: ((event: ProcessExit) => void) | null = null;
    const stopAfterExit = TranscodeRunner.create({ launch: (_input, exit) => {
      onExit = exit;
      return { terminate: () => { onExit!({ kind: "exited" }); throw new Error("late terminate failure"); } };
    } });
    stopAfterExit.start(job);
    expect(stopAfterExit.stop()).toEqual({ ok: true, value: { streamId: "phone-1", phase: "stopped", revision: 3, diagnostic: null } });
  });
});
