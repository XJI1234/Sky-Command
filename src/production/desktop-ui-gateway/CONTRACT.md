# 桌面 UI 网关模块契约

状态：已批准实施

## 1. 唯一职责

`desktop-ui-gateway` 是桌面应用主进程与未来渲染界面之间唯一的业务展示适配器。它把 `desktop-application` 的工作流能力转换为固定白名单命令、脱敏快照、订阅和受控视频播放资源。

它不创建 Electron 窗口、不注册 Electron IPC、不读文件、不解析航线、不管理对象图、不启停中继或媒体服务、不保存 UI 状态，也不解释 DJI、网络或媒体错误。Electron 适配器只能将自己的 IPC 调用转发到本模块的同名接口。

## 2. 对外接口

```ts
DesktopUiGateway.create({ application, relayHint? }) -> DesktopUiGatewayInstance

gateway.invoke(method, input) -> Promise<GatewayResult>
gateway.snapshot() -> UiSnapshot
gateway.subscribe(listener) -> unsubscribe
gateway.dispose() -> void
```

`application` 至少提供 `snapshot()`、`subscribe(listener)` 和 `workflow()`；低延迟旁路可额外提供 `lowLatency() -> LowLatencyMediaInstance | null`。未提供或返回 `null` 时，所有 `webrtc.*` 方法均返回 `DEPENDENCY_FAILURE`。

所有入口均接收 `unknown`，网关先验证精确输入形状再调用下游；不允许“通用方法名 + 任意对象”的透传。

## 3. 白名单

| 类别 | 方法 |
| --- | --- |
| 状态 | `state.snapshot`、`network.hint` |
| 实机预检 | `hardware.readiness` |
| 航线 | `route.import`、`route.preview`、`route.select`、`route.remove` |
| 分配 | `assignment.assign`、`assignment.clear` |
| 任务 | `mission.stage`、`mission.upload`、`mission.start`、`mission.pause`、`mission.resume`、`mission.stop` |
| 图传 | `stream.start`、`stream.stop`、`stream.refresh`、`stream.select`、`stream.clear` |
| 低延迟图传 | `webrtc.start`、`webrtc.stop`、`webrtc.stream-start`、`webrtc.stream-stop`、`webrtc.stream-select`、`webrtc.stream-clear`、`webrtc.refresh` |
| 设置 | `settings.transmission.read`、`settings.transmission.write`、`settings.camera.read`、`settings.camera.write` |
| 飞控 | `flight.request`、`flight.confirm`、`flight.cancel` |
| 受控视频 | `video.playback` |

业务方法返回值被原样作为成功网关结果的 `value`，以保留现有模块已定义的稳定业务错误码。网关自身只使用：`METHOD_NOT_ALLOWED`、`INVALID_INPUT`、`DEPENDENCY_FAILURE`、`DISPOSED`。

## 4. 输入规则

`route.import` 仅接收 `{ fileName, bytes }`，其中 `bytes` 为 `Uint8Array`；渲染层不能提供路径。

`hardware.readiness` 与每个设备操作均要求唯一 `{ deviceId }`；航线操作要求 `{ routeId }`；分配要求 `{ deviceId, routeId }`；设置写入额外要求 `{ patch }`；飞控请求要求 `{ deviceId, action }`，确认/取消额外要求 `{ confirmationId }`。`state.snapshot`、`stream.refresh`、`stream.clear`、`network.hint` 不接受输入。不接受多余字段、控制字符、空标识符、非有限时间值或错误值类型。

`hardware.readiness` 只委托 `workflow.checkHardwareReadiness(deviceId)`，返回脱敏后的旧图传与直接飞控预检及可显示阻塞项；它不调用 `stream.start`、`flight.request`、`webrtc.*` 或任一媒体服务生命周期方法。

## 5. 快照和视频资源

`snapshot()` 与订阅返回深拷贝、冻结后的 UI 快照。它移除一切 `endpoint`、`playbackUrl`、`diagnostic`、文件路径、凭据、进程/套接字和原始异常字段。

`network.hint` 返回当前可填写的局域网 Relay 地址列表 `{ hints }`。地址必须是 `ws://<IPv4>:<port>/relay`。未提供探测函数时返回空列表。探测抛错为 `DEPENDENCY_FAILURE`，不回显内部异常。

`video.playback` 是唯一能返回播放地址的方法。它读取工作流快照中未脱敏的 `media.streams`：仅当指定设备为 `ready` 且地址为无凭据的 `http(s)://127.0.0.1/...` 或 `http(s)://localhost/...` 时，返回 `{ deviceId, url }`。UI `snapshot()` 仍必须去掉 `playbackUrl`。未就绪、未知设备或任何非本机地址均返回稳定业务失败，不泄露候选地址。

低延迟方法只调用可选 `lowLatency()` 门面：`webrtc.start`、`webrtc.stop`、`webrtc.refresh` 和 `webrtc.stream-clear` 不接受输入；`webrtc.stream-start`、`webrtc.stream-stop`、`webrtc.stream-select` 接收唯一 `{ deviceId }`。低延迟播放地址由 `webrtc.stream-select` 触发播放器适配器，首帧事实由该门面返回；不能把手机命令成功当作首帧成功。

## 6. 生命周期

网关订阅应用快照并转发脱敏副本。监听器异常彼此隔离；取消订阅幂等。`dispose()` 幂等，只取消自身订阅和监听器，不会停止应用、中继、媒体、任务或飞控；此后所有调用返回 `DISPOSED`。

## 7. 验收

测试必须验证全部白名单方法与拒绝路径、每种输入类别、业务结果透传、脱敏、视频地址限制、订阅隔离、取消与释放。测试同时使用真实 `desktop-application` 和受控应用替身，证明网关既能对接生产装配，又不依赖 Electron 或下游内部实现。
