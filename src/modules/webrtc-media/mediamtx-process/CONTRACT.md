# mediamtx-process 二级模块契约

状态：已封存的 WebRTC/WHIP/WHEP 旁路源码与独立测试；不纳入生产组合根。

> 封存规则：本模块只保留给历史低延迟旁路的源码和测试。生产 `desktop-application`、Electron 宿主、IPC 和操作台不得创建、调用或暴露它；重新启用必须先取得业务批准，并同步更新两端根契约、生产装配和跨端验证。

## 唯一职责

`mediamtx-process` 只负责生成受控 MediaMTX 配置并管理一个 MediaMTX 进程的启动、运行事实和停止。它不解释设备状态、不生成命令、不播放视频、不管理 WHEP PeerConnection。

## 对外接口

```ts
type MediaMtxMode = "whip-whep";
type ProcessExit = Readonly<{ readonly kind: "exited" | "failed" }>;

interface ProcessHandle {
  readonly terminate: () => void;
}

interface ProcessPort {
  readonly launch: (
    input: Readonly<{ readonly executablePath: string; readonly config: string }>,
    onExit: (event: ProcessExit) => void
  ) => ProcessHandle;
}

interface ProcessEvents {
  readonly onExit: (event: ProcessExit) => void;
}

interface StartInput {
  readonly executablePath: string;
  readonly httpPort: number;
  readonly webRtcUdpPort: number;
  readonly apiPort: number;
  readonly pathPrefix: string;
  readonly publicHost: string;
  readonly mode: MediaMtxMode;
}

interface ProcessSnapshot {
  readonly phase: "idle" | "starting" | "running" | "stopping" | "failed" | "disposed";
  readonly revision: number;
  readonly httpPort: number | null;
  readonly webRtcUdpPort: number | null;
  readonly apiPort: number | null;
  readonly pathPrefix: string | null;
  readonly diagnostic: string | null;
}

MediaMtxProcess.create(port: ProcessPort) -> MediaMtxProcessInstance
instance.start(input: unknown, events: unknown) -> StartResult
instance.stop() -> StopResult
instance.snapshot() -> ProcessSnapshot
instance.dispose() -> Unit
```

`httpPort`、`webRtcUdpPort` 和 `apiPort` 必须是互不相同的 1024..65535 安全整数。`pathPrefix` 必须是一个以 `/` 开始、只含 ASCII 字母、数字、`.`、`_`、`-` 的 1..64 字符路径段；`publicHost` 必须是合法 IPv4 地址；`executablePath` 必须是非空字符串；`mode` 只能是 `whip-whep`。

MediaMTX 生成配置必须确定性地绑定：WHIP/WHEP HTTP 到所有接口的 `httpPort`，WebRTC UDP 到 `webRtcUdpPort`，管理 API 到 `127.0.0.1:apiPort`。配置只启用 WebRTC 和 API，关闭 RTSP、RTMP、HLS、SRT；动态路径只允许 `${pathPrefix}/...`，路径来源为 WHIP publisher。`publicHost` 只用于 WebRTC candidate 广播，不得改变 API 的回环绑定。配置必须关闭 `webrtcIPsFromInterfaces`，只把 `publicHost` 写入 `webrtcAdditionalHosts`，避免把 APIPA、虚拟网卡和其它本机接口当成 ICE 候选。

进程适配器通过注入的 `ProcessPort` 启动，不直接读取环境变量或创建无法测试的全局进程。`launch` 收到完整配置文本，适配器负责把它交给真实 MediaMTX 进程。完整命令行、进程路径、配置文本、原始 stderr 和凭据不得出现在公开结果。

## 状态与错误

状态为 `idle`、`starting`、`running`、`stopping`、`failed`、`disposed`。初始快照为 `idle`、修订号 0、所有配置字段为 `null`、诊断为 `null`。

`start` 只允许在 `idle` 或 `failed` 执行；运行中、启动中或停止中返回 `ALREADY_ACTIVE`，不触碰端口。合法启动先进入 `starting`，再以冻结的 `{ executablePath, config }` 调用一次 `launch`；成功取得进程句柄后进入 `running`。`launch` 同步抛错、返回没有 `terminate` 函数的句柄或当前进程在启动调用期间报告 `failed`，均返回 `START_FAILED` 并进入 `failed`。进程在启动调用期间报告正常 `exited` 也视为启动失败。失败诊断固定为：`MediaMTX 进程未能启动。请检查桌面媒体服务。`。

当前代次的进程异常退出使状态进入 `failed`，诊断固定为：`MediaMTX 进程异常结束。请检查桌面媒体服务。`，并向 `events.onExit` 报告不含其他字段的事件。停止阶段收到 `exited` 或 `failed` 时视为清理完成，进入 `idle`；迟到的旧代次退出不得影响重启后的进程。回调异常不得反向污染状态。

`stop` 在 `running` 时先进入 `stopping`，调用当前句柄的 `terminate`；如果退出回调同步到达，结果为 `idle`，否则返回 `ok: true` 的 `stopping` 快照并等待退出事实。`terminate` 抛错时保持 `running`，返回 `STOP_FAILED`，诊断固定为：`无法停止 MediaMTX 进程。请检查桌面媒体服务。`。`failed` 状态没有活动句柄时，`stop` 只清空失败状态并回到 `idle`；`idle`、`starting`、`stopping` 和 `disposed` 的非法停止返回 `NOT_RUNNING`。停止必须不泄露原始异常。

`dispose` 会使实例进入 `disposed`，使当前代次回调失效；若仍有句柄，尽力调用 `terminate`，但不抛异常。处置后所有操作均返回稳定的 `DISPOSED` 结果（`snapshot` 和 `dispose` 除外）。

所有结果与快照均为冻结副本；公开对象不得包含可执行路径、配置文本、命令行、stderr、凭据或原始异常。

## 验收

契约测试覆盖配置生成、端口校验、启动/停止顺序、重复操作、同步异常、迟到退出事件、敏感信息脱敏和多实例隔离。该模块不得依赖 Electron 或具体 UI。
