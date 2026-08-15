# transcode-runner 二级模块契约

状态：已批准实施

## 唯一职责

`transcode-runner` 生命周期化管理**一条**图传流对应的转码进程：校验启动请求、调用注入的进程适配器、处理当前运行代次的退出回调、请求停止，并向组合根提供不泄露路径或命令行的冻结状态快照。

每条 `streamId` 必须由组合根创建一个独立实例。模块不管理流集合、不选择 FFmpeg、不构造 FFmpeg 命令行、不监听 RTMP、不检查 HLS 文件、不播放视频、不创建计时器、不解释“视频是否就绪或超时”，也不调用 `stream-health`。组合根把本模块的“已启动/异常退出/用户停止”事实报告给 `stream-health`。

## 公开接口

```ts
type TranscodePhase = "idle" | "running" | "stopping" | "stopped" | "failed";

interface TranscodeJob {
  readonly streamId: string;           // 1 至 128 个字符；不得含 NUL
  readonly executablePath: string;     // 仅传入适配器，绝不出现在快照或错误中
  readonly inputUrl: string;           // 仅传入适配器，绝不出现在快照或错误中
  readonly outputDirectory: string;    // 仅传入适配器，绝不出现在快照或错误中
}

interface ProcessExit {
  readonly kind: "exited" | "failed";
}

interface ProcessHandle {
  readonly terminate: () => void;
}

interface TranscoderProcessPort {
  readonly launch: (job: TranscodeJob, onExit: (event: ProcessExit) => void) => ProcessHandle;
}

interface TranscodeSnapshot {
  readonly streamId: string | null;
  readonly phase: TranscodePhase;
  readonly revision: number;
  readonly diagnostic: string | null;
}

type StartResult =
  | Readonly<{ readonly ok: true; readonly value: TranscodeSnapshot }>
  | Readonly<{ readonly ok: false; readonly code: "INVALID_INPUT" | "ALREADY_ACTIVE" | "LAUNCH_FAILED"; readonly value: TranscodeSnapshot }>;

type StopResult =
  | Readonly<{ readonly ok: true; readonly value: TranscodeSnapshot }>
  | Readonly<{ readonly ok: false; readonly code: "NOT_RUNNING" | "STOP_FAILED"; readonly value: TranscodeSnapshot }>;

interface TranscodeRunnerInstance {
  readonly start: (job: unknown) => StartResult;
  readonly stop: () => StopResult;
  readonly snapshot: () => TranscodeSnapshot;
}
```

`create(port)` 只接受含有 `launch` 函数的适配器；装配错误同步抛出 `TypeError`。`start` 接受未知值以隔离组合根的输入错误。所有结果和快照均为新建、冻结副本。

## 生命周期

1. 初始快照为 `idle`、`streamId: null`、`revision: 0`、无诊断。
2. 仅 `idle`、`stopped` 和 `failed` 可 `start`。请求无效返回 `INVALID_INPUT` 且不调用适配器；`running` 或 `stopping` 返回 `ALREADY_ACTIVE` 且不调用适配器。
3. `launch` 同步成功后进入 `running`；启动时立即发生的退出回调也必须被正确处理，不能留下悬挂句柄。
4. `launch` 抛出时进入 `failed`，返回 `LAUNCH_FAILED`。错误信息不得包含原始异常、路径、URL 或命令行。
5. `stop` 仅在 `running` 时有效。调用前先进入 `stopping`，再调用当前句柄的 `terminate()`；成功返回 `stopping` 快照，等待退出回调。`terminate` 抛出时回退 `running` 并返回 `STOP_FAILED`。
6. 当前代次退出回调：若处于 `stopping`，转为 `stopped` 且无诊断；若处于 `running`，无论事件标记为 `exited` 还是 `failed`，均转为 `failed` 并给出“转码进程异常结束”诊断。
7. 已结束进程的陈旧回调必须被忽略；它不得改写新一次运行的快照。`stop` 在非运行状态返回 `NOT_RUNNING`，不调用任何句柄。

## 诊断契约

| 场景 | 诊断 |
| --- | --- |
| 启动失败 | `转码进程未能启动。请检查 FFmpeg 与输入流。` |
| 未请求停止而退出 | `转码进程异常结束。请检查 FFmpeg 与输入流。` |
| 停止请求失败 | `无法停止转码进程。请检查 FFmpeg 与输入流。` |

成功、`idle`、`stopped` 和 `stopping` 的诊断为 `null`。诊断文本不得泄露 `executablePath`、`inputUrl`、`outputDirectory`、原始异常、退出码或进程参数。

## 依赖、所有权与并发

本模块不导入 Node、Electron、子进程、文件系统、网络、FFmpeg、UI 或其他二级模块。真实 `ChildProcess` 只能存在于组合根注入的 `TranscoderProcessPort` 适配器。

适配器拥有真实进程句柄；本模块只在当前一次运行期间保存其 `terminate` 能力。调用方拥有 `TranscodeJob`，模块只读取它。每次启动分配单调增加的内部代次，防止旧进程的延迟退出破坏新进程状态。所有公开方法同步执行，不创建 Promise、定时器或后台任务。

## 验收

测试必须覆盖：初始状态、合法启动、所有非法字段、启动期间重复调用、启动异常、提前退出、用户停止、停止异常、重复停止、同步退出、陈旧退出回调、重启、输入不变性、快照和结果冻结、诊断脱敏和独立实例隔离。实现还必须通过架构边界测试、类型检查、100% 行/分支/函数/语句覆盖率和 100% 变异测试。
