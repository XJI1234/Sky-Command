# 直播控制一级模块契约

状态：已批准实施

## 唯一职责

`live-stream-control` 是桌面端直播的控制侧：它根据已经运行的 `media-pipeline` 接收端点，并优先结合指定手机实际接入桌面的 IPv4，为该设备构造 RTMP 推流地址，并可靠地下发 `live-stream.start`、`live-stream.stop`。

它不接收 RTMP、不启动或停止 FFmpeg/HLS/RTMP 服务、不播放视频、不保存视频、不读取 DJI SDK、不创建 WebSocket，也不把手机端接受命令错误地显示成“画面已经就绪”。视频接收、转码、健康和播放仅属于 `media-pipeline`。

## 对外接口

```ts
LiveStreamControl.create(dependencies) -> LiveStreamControlInstance

instance.check(deviceId) -> StreamControlCheck
instance.start(deviceId) -> Promise<StreamControlResult>
instance.stop(deviceId) -> Promise<StreamControlResult>
instance.get(deviceId) -> StreamControlSnapshot
instance.list() -> readonly StreamControlSnapshot[]
instance.recordDisconnected(deviceId) -> StreamControlSnapshot | null
instance.forget(deviceId) -> boolean
instance.subscribe(listener) -> unsubscribe
```

每一个可变状态都以 `deviceId` 为键。不存在“当前直播设备”这样的全局状态；多台手机可以分别拥有各自的开始、停止和遥测状态。`start` 的成功仅表示手机端成功接受并完成开始操作，视频是否到达、是否可播放必须再由 `media-pipeline` 的只读快照判断。

## 二级模块与依赖

| 二级模块 | 唯一职责 | 明确不负责 |
| --- | --- | --- |
| `stream-protocol-config` | 根据接收端点和设备标识构造、校验 RTMP 目标 | 下发命令、接收视频、保存配置 |
| `stream-dispatcher` | 检查设备能力、接收端点和命令结果，维护按设备隔离的直播控制状态 | 构造任意协议地址、接收视频、管理媒体进程 |

一级组合根只组合这两个公开二级接口。它只可以依赖注入的 `relay-link` 命令端口、`device-console/capability-gate` 的公开判定接口，以及 `media-pipeline` 的只读接收端点接口；禁止导入它们的内部实现。

## 已确认的协议契约

当前唯一可用协议为 RTMP。手机端 `live-stream.start` 必须收到唯一字段 `{ rtmpUrl: string }`，`live-stream.stop` 必须收到冻结空字段对象。目标地址固定为：

```text
rtmp://{电脑局域网接收主机}:{RTMP端口}/live/{encodeURIComponent(deviceId)}
```

端口来自已经运行的 `media-pipeline` 公开接收端点。若中继为该设备提供了合法私网入站本端 IPv4，主机必须使用该地址；否则使用媒体管线当前端点。该入站地址不进入设备或 UI 快照，且地址选择不得重启媒体服务或改变已发布流。媒体服务未运行、端点不完整、设备标识非法或地址不能通过 RTMP 规则时，开始请求必须在桌面端被拒绝，绝不发送命令。停止不需要媒体服务端点，但仍需要设备可连接并且不允许与同设备的其他直播命令并发。

手机端遥测能力字段 `capabilities.liveVideo` 是唯一能力来源。开始和停止前均通过 `CapabilityGate.evaluate({ operation: "live-stream", ... })`；未连接、SDK/遥控器/飞机链路未就绪、能力未知或不支持必须返回稳定可显示原因。能力允许只表示“可以提交”，不表示 DJI 直播或本地画面一定成功。

## 状态、并发和断线

每台设备的控制快照仅为 `idle`、`starting`、`streaming`、`stopping`、`failed` 或 `disconnected`，并包含最后操作、稳定失败码和安全诊断。状态不保存 RTMP URL、查询参数、令牌、原始异常、FFmpeg 路径或视频数据。

同一设备在等待命令结果时，第二个开始或停止请求返回 `OPERATION_IN_PROGRESS`，且不触发任何依赖；不同设备互不阻塞。命令传输异常、超时、拒绝和畸形结果统一收敛为稳定失败码，不抛出原始异常。设备断开时，进行中的结果不能覆盖 `disconnected`；重新连接后必须由调用方重新发起一次完整 `start`，不能复用旧 RTMP 地址或自动重试。

`subscribe` 提供冻结、排序、与内部状态隔离的快照；监听器异常不得阻断其他监听器。`forget` 只可删除稳定终态 `idle`、`failed` 或 `disconnected` 的设备记录，不能删除正在提交的操作。

## 验收

实现前每个二级模块必须有中文 `CONTRACT.md`。测试必须覆盖协议地址、能力拒绝、接收端点缺失、精确命令字段、成功与失败映射、同设备互斥、多设备并行、断线、迟到结果、冻结副本、监听器隔离、恶意依赖和架构边界；类型、模块范围行/分支/函数/语句覆盖率、性能测试和 Stryker 变异得分均必须为 100%。
