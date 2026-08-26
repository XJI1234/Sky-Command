# 桌面应用生产装配模块契约

状态：已批准实施

## 1. 唯一职责

`desktop-application` 是 Sky Command 桌面端的生产对象图根。它在一个受控的构造步骤中组合既有的中继、航线库、任务、图传、媒体、设置、飞控、工作流与运行时模块，并负责它们的统一启动、停止、快照、订阅和逆序释放。

它不实现 DJI、WebSocket、KMZ/WPML、RTMP/HLS、FFmpeg、地图、Electron、IPC、窗口或任何页面规则；不重新实现任一一级模块的业务状态机；不向渲染进程暴露内部模块、文件路径、网络端点、凭据、原始异常或媒体进程。

## 2. 对外接口

```ts
DesktopApplication.create(options) -> ApplicationCreateResult

application.start() -> Promise<ApplicationResult>
application.stop() -> Promise<ApplicationResult>
application.snapshot() -> ApplicationSnapshot
application.subscribe(listener) -> unsubscribe
application.workflow() -> OperationWorkflowInstance
application.lowLatency() -> LowLatencyMediaInstance | null
application.dispose() -> Promise<void>
```

`workflow()` 仅供下一层桌面 UI 网关调用。Electron 主进程和渲染进程均不得把其返回值直接交给页面。

`create` 只接受：已校验的网络设置、中继监听配置、航线库配置、媒体适配器和启动输入、任务 ID 生成器、飞控确认配置、时钟、实机预检桌面事实及可选诊断记录器。实机预检事实形状为：

```text
hardwareReadiness: {
  lanAddressAvailable: boolean
  legacyMediaAvailable: boolean
  sessionStableAfterMs: number
}
```

生产装配必须提供实际 LAN 与可执行 FFmpeg 探测结果，且 `sessionStableAfterMs` 为 15,000。它们只交给 `operation-workflow` 的开始操作预检，不改变中继、媒体或低延迟旁路的启动和生命周期。低延迟旁路配置可选，形状为：

```text
lowLatency?: {
  media: {
    dependencies: WebRtcMediaDependencies
    options: WebRtcMediaOptions
    startInput: unknown
  }
}
```

`legacyMediaRequired?: boolean` 为可选启动策略，默认 `true`。生产桌面同时装配低延迟旁路时必须传 `false`，使旧 RTMP/HLS 或 FFmpeg 的失败只影响旧链路；它不改变旧链路已构造的对象图，也不自动启动低延迟旁路。

调用者不传入已经构造好的业务实例，避免出现不完整或所有权不清的对象图。

WebSocket 中继口取自 `network.relayPort`，RTMP 收流口取自 `network.listenPort`，媒体启动的 `manualHost` 取自 `network.manualHost`。`relay.address.port` 与 `media.options.rtmpPort` 不得另开一套端口真相。`network` 无效时返回 `INVALID_CONFIGURATION`。

创建配置无效时返回稳定 `INVALID_CONFIGURATION`，不创建监听器、服务器或后台资源。

## 3. 固定对象图与所有权

创建成功后，本模块唯一拥有以下实例：

1. `NodeRuntime -> RelayLink`
2. `RelayOperationsAdapter`
3. `RelayDeviceSettings -> DeviceSettingsPanel`
4. `RouteLibrary`
5. `MissionControl`
6. `MediaPipeline -> LiveStreamControl`
7. `FlightCommandDispatcher -> FlightControl`
8. `DesktopRuntime`
9. `OperationWorkflow`
10. 可选 `WebRtcMedia -> WhipStreamControl` 低延迟旁路

依赖方向只能从本模块指向上述公开一级接口。任一被组合模块不得反向依赖本模块，也不得依赖 UI 网关、Electron 或地图。

## 4. 生命周期

初始阶段为 `idle`。`start()` 委托 `DesktopRuntime.start()`，其既定顺序为先启动中继监听，再启动旧媒体服务。默认策略要求两者成功；`legacyMediaRequired: false` 时，中继成功即允许应用进入 `running`，旧媒体失败只保留在运行时媒体快照。

`stop()` 先尽力对仍处于活动阶段的任务调用 `missionControl.stop(deviceId)`（失败不得阻断后续清理），再停止可选低延迟旁路，最后委托 `DesktopRuntime.stop()`：先停止已知设备图传，再停止媒体服务，最后停止中继监听。任一步失败均不得阻止后续清理；结果映射为稳定的应用错误码。`stop()` 不发送起飞/降落/返航；桌面退出不等于飞机已落地，收尾仍以遥控器为准。重复启动、重复停止、进行中的竞争操作和释放后的调用均返回稳定结果，不抛出底层异常。

`dispose()` 幂等，并按以下顺序执行：若仍在运行先完成 `stop()`（因此可能发出上述尽力而为的航线停止）；停止工作流订阅；停止任务订阅；清空航线内存；清空飞控确认；释放运行时及其媒体资源；释放中继操作适配器；停止对外发布。释放本身不再额外发送起飞/降落/返航。

低延迟旁路是可选配置。默认配置不创建它，不改变旧 RTMP/HLS 启动顺序。配置存在时，`lowLatency()` 返回独立门面，只有调用其 `start()` 才启动 MediaMTX；低延迟启动失败只能影响该门面。应用停止或处置时必须先尽力停止该门面的 WHIP 设备和 MediaMTX，再执行旧运行时停止。

两条媒体链路的启动、运行、播放和停止结果互不升级：旧链路故障不得阻止 `lowLatency().start()`，低延迟故障不得阻止旧运行时启动或停止。两者仅共享中继控制面和手机连接；旧 `live-stream.*` 与新 `live-stream-webrtc.*` 命令、端口、进程、状态和播放器适配器保持分离。

## 5. 快照与订阅

`snapshot()` 返回深层冻结的安全副本，包含应用阶段、单调递增修订号、运行时快照和工作流快照。它不包含 WebSocket、地址、端口、文件路径、令牌、FFmpeg 参数、DJI 对象或原始异常。

应用订阅同时监听运行时和工作流。每次可见变化发布一份新快照；监听器异常彼此隔离；取消订阅幂等；释放后不得再发布。

## 6. 错误语义

允许的装配错误码：`INVALID_CONFIGURATION`、`ALREADY_RUNNING`、`NOT_RUNNING`、`OPERATION_IN_PROGRESS`、`DISPOSED`、`RELAY_START_FAILED`、`MEDIA_START_FAILED`、`MEDIA_STOP_FAILED`、`RELAY_STOP_FAILED`、`DEPENDENCY_FAILURE`。

错误只表达可恢复的领域事实，绝不泄露内部异常文本或敏感运行时细节。

## 7. 与后续模块的关系

下一层 `desktop-ui-gateway` 是唯一可调用 `workflow()` 的桌面展示适配器。它负责白名单输入校验、IPC 友好结果、快照订阅和受控播放资源读取；它不得管理对象图、启动媒体服务或直接访问此模块的内部实例。

## 8. 验收

测试必须通过本模块公开接口验证：完整对象图实际构造；启动/停止顺序；中继或媒体启动失败的回收；停止错误不阻塞后续释放；订阅隔离和取消；快照防泄漏；释放幂等；工作流可用且不越过本模块的所有权；真实 Node WebSocket 中继与受控媒体适配器的集成启动/停止。
