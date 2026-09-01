# 直播命令调度二级模块契约

状态：已批准实施

## 唯一职责

`stream-dispatcher` 为每个手机设备检查当前媒体接收端点与直播能力，并把已允许的开始、停止请求映射为精确的 `live-stream.start`、`live-stream.stop` 命令及稳定的按设备控制快照。

它不生成 RTMP 地址规则、不接收 RTMP、不转码、不管理播放器、不保存视频、不创建 WebSocket、不访问 DJI SDK，也不自行重试。RTMP 目标仅由 `stream-protocol-config` 构造；媒体接收事实仅由 `media-pipeline` 公开；命令传输只经过注入的 `relay-link` 端口。

## 对外接口

```ts
StreamDispatcher.create(dependencies) -> StreamDispatcherInstance

instance.check(deviceId) -> StreamDispatchCheck
instance.start(deviceId) -> Promise<StreamDispatchResult>
instance.stop(deviceId) -> Promise<StreamDispatchResult>
instance.get(deviceId) -> StreamDispatchSnapshot
instance.list() -> readonly StreamDispatchSnapshot[]
instance.recordDisconnected(deviceId) -> StreamDispatchSnapshot | null
instance.forget(deviceId) -> boolean
instance.subscribe(listener) -> unsubscribe
```

依赖为：RTMP 目标构造接口、媒体接收端点只读接口、遥测与命令中继端口，以及 `CapabilityGate.evaluate` 判定接口。所有端口返回值都是不可信输入，任一端口抛出、拒绝 Promise、恶意 getter 或畸形返回值均必须收敛为稳定结果，不能向调用方泄露异常。

## 开始与停止

`start(deviceId)` 的固定顺序：

1. 校验设备标识和同设备互斥；
2. 读取 `media-pipeline` 快照，只有 `phase === "running"` 且存在有效 `endpoint.host`、`endpoint.port` 时继续；
3. 调用 `stream-protocol-config.createRtmpTarget`，获得唯一的 RTMP 目标；
4. 读取该设备遥测，并调用 `CapabilityGate.evaluate({ operation: "live-stream", ... })`。开始要求中继、MSDK 以及手机端实时推导的 `capabilities.liveVideo === true`；飞控不参与。能力未知或当前未就绪时不发送命令；
5. 进入 `starting`，发送冻结字段 `{ rtmpUrl }`；仅中继结果 `status === "succeeded"` 时进入 `streaming`。

当同一设备正处于 `stopping` 时，`start(deviceId)` 不是并发命令：它登记一次“停止后重启”意图，并等待现有停止命令的终态。停止成功后，调度器必须重新执行上述全部启动检查，再发送唯一一条 `live-stream.start`；停止失败或设备断线时，不得发送启动命令，所有已登记调用必须得到该终态失败。处于 `starting` 的同设备 `start`、以及所有其他忙碌冲突，仍返回 `OPERATION_IN_PROGRESS`。多个停止期间的启动请求可以合并为一次实际启动，但每个调用都必须收到该次启动的最终结果。

`stop(deviceId)` 不读取媒体端点、不构造地址、也不走启动用的 `CapabilityGate(live-stream)`。它只校验设备标识与同设备互斥，进入 `stopping` 后发送冻结空字段对象。中继成功时进入 `idle`，失败时进入 `failed`。手机端命令成功只表示 DJI 操作结果，播放器可用性仍由 `media-pipeline` 决定。

错误码只能是：`INVALID_INPUT`、`MEDIA_PIPELINE_UNAVAILABLE`、`CONFIGURATION_INVALID`、`CAPABILITY_BLOCKED`、`OPERATION_IN_PROGRESS`、`RELAY_REJECTED`、`DEPENDENCY_FAILURE`、`DISCONNECTED` 或 `ILLEGAL_STATE`。能力拒绝必须复制 `CapabilityGate` 的原因码。`RELAY_REJECTED` 可以把手机端已知拒绝详情映射为封闭原因码 `ANOTHER_VIDEO_TRANSPORT_ACTIVE`，但不能把遥测、RTMP URL 或原始异常带入结果。

## 状态、并发与订阅

一个 `deviceId` 一个记录，阶段为 `idle`、`starting`、`streaming`、`stopping`、`failed` 或 `disconnected`。快照只含设备标识、阶段、最后操作、失败码和能力拒绝原因，绝不含 RTMP URL、令牌、媒体地址或异常。

同设备的进行中操作互斥，不同设备可并行；唯一例外是 `stopping` 期间登记的“停止后重启”意图，它绝不与停止命令并发执行。断线立即将已存在的设备记录标记为 `disconnected`，并终止尚未执行的重启意图；断线前开始的异步结果是迟到结果，必须忽略。`forget` 只能删除 `idle`、`failed` 或 `disconnected` 记录。快照按 `deviceId` 排序、逐层冻结并与内部状态隔离；订阅者异常不会影响状态或其他订阅者，注销幂等。

## 验收

测试必须精确验证命令名与字段、每项前置检查的顺序、能力门禁、媒体端点缺失、同设备互斥、多设备并行、断线和迟到完成、稳定状态迁移、订阅隔离、恶意依赖和不泄密。模块不导入 Node、Electron、WebSocket、FFmpeg、DJI、UI 或其他一级模块的内部实现，并通过类型、100% 覆盖率、性能和 100% Stryker 变异测试。
