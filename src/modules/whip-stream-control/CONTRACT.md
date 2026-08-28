# whip-stream-control 一级模块契约

状态：已封存的 WebRTC/WHIP/WHEP 旁路源码与独立测试；不纳入生产组合根。

> 封存规则：本模块只保留给历史低延迟旁路的源码和测试。生产 `desktop-application`、Electron 宿主、IPC 和操作台不得创建、调用或暴露它；重新启用必须先取得业务批准，并同步更新两端根契约、生产装配和跨端验证。

## 唯一职责

`whip-stream-control` 是桌面端实验图传控制侧。它根据已经运行的 `webrtc-media` 发布目标，通过注入的 Relay 命令端口发送临时的 `live-stream-webrtc.start` 和 `live-stream-webrtc.stop` 命令。

它不接收媒体、不启动 MediaMTX、不播放视频、不读取 DJI、不依赖旧 `live-stream-control`，也不把手机命令成功解释成电脑首帧成功。

## 对外接口

```text
WhipStreamControl.create(dependencies) -> WhipStreamControlInstance

instance.check(deviceId) -> WhipDispatchCheck
instance.start(deviceId) -> Promise<WhipDispatchResult>
instance.stop(deviceId) -> Promise<WhipDispatchResult>
instance.get(deviceId) -> WhipDispatchSnapshot
instance.list() -> readonly WhipDispatchSnapshot[]
instance.recordDisconnected(deviceId) -> WhipDispatchSnapshot | null
instance.forget(deviceId) -> boolean
instance.subscribe(listener) -> unsubscribe
```

依赖只有三个公开端口：`webrtc-media` 的只读快照与 `publishTarget(deviceId)`、Relay 的遥测与命令端口、`DeviceConsole.CapabilityGate.evaluate`。端口返回值、Promise 和 getter 都是不可信输入；异常必须转为固定失败码，不能泄漏 URL、遥测、原始异常或命令细节。

## 协议

启动字段必须严格为：

```text
{ whipUrl: string }
```

停止字段必须严格为空对象。目标格式为：

```text
http://{电脑局域网主机}:{WHIP HTTP 端口}/live/{encodeURIComponent(deviceId)}/whip
```

`start(deviceId)` 固定顺序为：校验设备与同设备互斥、能力门禁、确认 `webrtc-media` 为运行态、取得该设备的已校验 WHIP 目标、进入 `starting`、发送冻结字段 `{ whipUrl }`。只有中继结果 `status === "succeeded"` 才进入 `streaming`。`stop(deviceId)` 不生成地址，但仍执行同一能力门禁并发送冻结空字段对象。

错误码只能是：`INVALID_INPUT`、`WEBRTC_MEDIA_UNAVAILABLE`、`TARGET_INVALID`、`CAPABILITY_BLOCKED`、`OPERATION_IN_PROGRESS`、`RELAY_REJECTED`、`DEPENDENCY_FAILURE`、`DISCONNECTED` 或 `ILLEGAL_STATE`。

`RELAY_REJECTED` 可以把手机端已知拒绝详情映射为封闭原因码 `ANOTHER_VIDEO_TRANSPORT_ACTIVE`、`VIDEO_TRANSPORT_FAILED` 或 `VIDEO_TRANSPORT_UNAVAILABLE`，不得把原始命令详情、URL 或异常带入快照。

每个 `deviceId` 的快照阶段只能是 `idle`、`starting`、`streaming`、`stopping`、`failed` 或 `disconnected`，快照不包含 WHIP 地址。不同设备互不阻塞；断线会使在途结果失效；`forget` 只能删除稳定终态。订阅快照按设备标识排序、冻结且监听器隔离。

实验命令完成只表示手机 WHIP 发布器的操作终态。媒体是否已发布、WHEP 是否已连接和首帧是否显示由 `webrtc-media` 与 `whep-playback` 分别负责。

## 验收

必须覆盖能力门禁、端点缺失、设备隔离、精确字段、命令失败/超时/断开、重复操作、旧结果和敏感信息脱敏。默认旧模式不得调用该模块。
