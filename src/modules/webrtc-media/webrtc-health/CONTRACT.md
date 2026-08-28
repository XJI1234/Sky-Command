# webrtc-health 二级模块契约

状态：已封存的 WebRTC/WHIP/WHEP 旁路源码与独立测试；不纳入生产组合根。

> 封存规则：本模块只保留给历史低延迟旁路的源码和测试。生产 `desktop-application`、Electron 宿主、IPC 和操作台不得创建、调用或暴露它；重新启用必须先取得业务批准，并同步更新两端根契约、生产装配和跨端验证。

## 唯一职责

`webrtc-health` 是无 I/O 的低延迟媒体健康判定器。它只根据上层报告的发布、发布断开、播放器首帧和进程退出事实维护状态并产生超时停止建议。

## 对外接口

```ts
WebRtcHealth.create(options) -> WebRtcHealthInstance
instance.begin(streamId, now) -> BeginResult
instance.observe(streamId, event, now) -> ObserveResult
instance.evaluate(now) -> EvaluationResult
instance.stop(streamId) -> StopResult
instance.snapshot(streamId) -> HealthSnapshot | null
instance.snapshots() -> readonly HealthSnapshot[]
```

`streamId` 与发布路径上的设备标识相同：1..128 个 Unicode 码点，去空白后非空，不能是 `.` 或 `..`，不得含 `/`、`\` 或控制字符。它必须能容纳生产端默认的 UUID 设备标识（可数字开头）。所有时间是有限、非负、单调不减的毫秒数。`publisherTimeoutMs` 为 1,000..60,000 毫秒的安全整数。

## 状态与事件

状态为 `awaiting-publisher`、`publisher-ready`、`failed`。事件至少包括 `publisher-connected`、`publisher-disconnected`、`first-frame-rendered`、`process-exited` 和 `stop`。

`publisher-connected` 只能使流进入 `publisher-ready`，不得被解释成 `first-frame-rendered`。输入超时和发布后断流超时各只能产生一次停止建议。重复事件必须幂等，未知流必须稳定拒绝。

`publisher-disconnected` 将当前流退回 `awaiting-publisher` 并以断流时刻重新计时；重新发布可以恢复 `publisher-ready`。`process-exited` 立即使当前流进入 `failed`。`first-frame-rendered` 只更新最近事实，不改变 `publisher-ready` 状态。`evaluate` 在 `awaiting-publisher` 超过 `publisherTimeoutMs` 时最多产生一项停止建议。

失败诊断只能使用固定文本：`未观察到 WHIP 发布。请确认手机端图传和局域网地址。`、`WebRTC 媒体发布已中断。请检查手机端和局域网连接。`、`MediaMTX 进程异常结束。请检查桌面媒体服务。`。

公开快照只包含 streamId、修订号、状态、最近事件时间和固定诊断，不包含 URL、设备对象、进程信息或原始异常。

## 验收

契约测试覆盖全部状态迁移、重复/乱序事件、超时边界、停止建议单次性、未知流、无效时间和冻结副本。
