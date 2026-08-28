# Relay 业务适配器契约

状态：已实现；待与生产组合根及真机联调

所属层：Sky Command 桌面端生产适配层

模块路径：`src/production/relay-operations-adapter`

## 单一职责

`relay-operations-adapter` 是桌面业务模块与 `relay-link` 协议对象之间唯一的语义转换边界。它把 Android Relay v1 的受限 JSON 值、命令结果和会话快照，转换为设备控制、航线任务、图传、飞控和设置模块可安全消费的桌面事实与命令端口。

它不保存 UI 状态，不渲染界面，不建立 WebSocket，不管理航线状态机，不执行 DJI 操作，不启动媒体服务，也不选择地图引擎。

## 上游与下游

```text
RelayLink（协议 JSON、设备会话、命令/任务结果）
  -> relay-operations-adapter
  -> device-console | mission-control | live-stream-control | flight-control | desktop-settings UI 门面
```

业务模块不得直接访问 `RelayLink` 的 `JsonObject`、`JsonValue`、连接 ID、会话 ID、帧名或协议错误。UI 不得访问本模块的协议转换细节。

## 对外接口

```ts
RelayOperationsAdapter.create({ relay }) -> RelayOperationsAdapterInstance

instance.telemetry(deviceId) -> DesktopRelayTelemetry | null
instance.devices() -> readonly DesktopRelayDevice[]
instance.snapshot() -> RelayOperationsSnapshot
instance.subscribe(listener) -> unsubscribe

instance.missionGateway() -> MissionRelayGateway
instance.streamGateway() -> StreamRelayGateway
instance.pairingGateway() -> PairingRelayPort
instance.flightGateway() -> FlightRelay
instance.settingsGateway() -> RelaySettingsGateway
instance.refreshTelemetry(deviceId) -> Promise<{ status, result? }>
instance.dispose() -> void
```

每次调用端口工厂返回同一逻辑门面；门面不暴露 `RelayLink`。所有快照为深度隔离的冻结副本。

实现中保留的 `whipStreamGateway()` 仅供封存源码与其独立测试维持可编译性；它不是生产接口，`desktop-application`、UI、IPC 和任何新业务代码不得调用或重新接线它。

## 入站遥测投影

手机端 `TelemetryFrameMapper` 是唯一来源。适配器只接受下列已知字段；缺失、JSON null、类型不匹配或未知枚举不得推测为成功。

| Android 协议字段 | 桌面投影字段 | 转换规则 |
| --- | --- | --- |
| `sdkAvailability` | `sdkRegistered` | 仅 `READY` 为 `true`；`STARTING`、`STOPPED`、`FAILED` 为 `false`；缺失或未知为 `undefined` |
| `remoteController` | `remoteControllerConnected` | `CONNECTED` 为 `true`，`DISCONNECTED` 为 `false`，其余为 `undefined` |
| `flightController` | `flightControllerConnected` | `CONNECTED` 为 `true`，`DISCONNECTED` 为 `false`，其余为 `undefined` |
| `aircraft` | `connected` | `CONNECTED` 为 `true`，`DISCONNECTED` 为 `false`，其余为 `undefined` |
| `aircraftModel`、`remoteControllerModel` | 同名字段 | 仅保留非空白、最多 128 个 Unicode 码点且不含控制字符的字符串 |
| `isFlying`、`motorsOn` | 同名字段 | 仅保留布尔值 |
| `flightMode` | 同名字段 | 仅保留非空白、最多 128 个 Unicode 码点且不含控制字符的字符串 |
| `batteryPercent` | 同名字段 | 仅保留 `0..100` 的有限数值 |
| `remainingFlightTimeSeconds` | 同名字段 | 仅保留 `0..86,400` 的非负安全整数 |
| `pairing` | `pairingState` | 仅保留 `UNKNOWN`、`IDLE`、`PAIRING`、`PAIRED`、`STOPPING`、`FAILED` |
| `latitude` / `longitude` | 同名字段 | 仅在两者都是有限数值且分别落在 `[-90,90]`、`[-180,180]` 时成对保留；缺一、越界、JSON null 均省略，不得写成 `0` |
| `altitudeMeters` | 同名字段 | 仅保留有限数值，不受电池 `0..100` 范围限制 |
| `liveStreaming` | 同名字段 | 仅保留布尔值；它是当前只读观测，不能改变桌面图传状态机 |
| `liveResolution` | 同名字段 | 仅在 `liveStreaming=true` 时保留非空白、最多 128 个 Unicode 码点且不含控制字符的字符串 |
| `liveFps` | 同名字段 | 仅在 `liveStreaming=true` 时保留 `0..240` 的有限数值 |
| `liveVideoBitrateKbps` | 同名字段 | 仅在 `liveStreaming=true` 时保留 `0..100,000` 的有限数值 |
| `liveRttMillis` | 同名字段 | 仅在 `liveStreaming=true` 时保留 `0..60,000` 的非负安全整数 |
| `missionExecution` | 同名封闭枚举 | 仅保留 `NOT_STARTED`、`STARTING`、`EXECUTING`、`PAUSED`、`STOPPING`、`FINISHED`、`FAILED` |
| `missionFileName` | 同名字段 | 仅保留安全 `.kmz` 基名；缺失或 null 为 `undefined` |
| `capabilities.liveVideo` | 同名字段 | 仅保留布尔值；字段名不得改写 |
| `capabilities.waypointMission` | 同名字段 | 仅保留布尔值；字段名不得改写 |
| `capabilities.waypointMissionSupport` | 同名字段 | 线协议 `SUPPORTED` / `UNSUPPORTED` 归一为桌面门禁词表 `supported` / `unsupported`；其他值为 `undefined`。这不是改字段名。 |

投影还必须保留用于设备页显示的安全原始枚举值，但不得公开协议 JSON 或任意未知字段。适配器不得把“Relay 在线”推导为“SDK 已就绪”或“飞机已连接”。

`liveStreaming=false` 或未知时，适配器不得投影分辨率、帧率、码率或 RTT，避免设备页把上一轮图传留下的指标显示为当前事实。

## 航线阶段快照投影

`RelayOperationsSnapshot.missionPhases` 只保留可被 `mission-control` 直接消费的完整事实：`deviceId`、正安全整数 `missionRevision`、非负安全整数 `deviceGeneration`、正安全整数 `sequence`、`START_POINT_REACHED|ROUTE_EXECUTION_STARTED` 和安全 `.kmz` 基名。任一字段缺失、畸形或文件名不安全的条目必须被丢弃，绝不补零、复用上一次代际或猜测阶段。不得裁剪任务代际、设备代际或序号；否则桌面状态机无法辨别当前任务与迟到回调。

## 出站命令映射

适配器是将桌面语义字段编码为 Relay JSON 的唯一位置。

| 桌面动作 | 线协议命令 | 唯一允许字段 |
| --- | --- | --- |
| 配对查询 | `pairing.status` | `{}` |
| 配对开始/停止 | 不下发 | 桌面适配器本地拒绝；对频只在手机上操作 |
| 一次性遥测刷新 | `telemetry.read` | `{}` |
| 航线上传/启动/暂停/继续/停止 | `wayline.*` | `{ confirm: true }` |
| 图传开始 | `live-stream.start` | `{ rtmpUrl: string }` |
| 图传停止 | `live-stream.stop` | `{}` |
| 起飞/降落/返航 | `flight.takeoff` / `flight.land` / `flight.return-home` | `{ confirm: true }` |
| 相机与图传设置 | `device.settings.*` | 由 `relay-device-settings` 契约规定的字段 |

除表中三条飞控命令外，不得生成其他 `flight.*` 命令。调用方传入无效字段时，适配器在本地返回稳定拒绝且不产生网络效果。

## 结果与状态语义

- `mission-result.ok` 只表示手机已暂存 KMZ。
- `wayline.upload` 成功才表示飞机端上传完成。
- `wayline.start` 成功只表示 DJI 接受启动请求；只有有效且属于当前任务代际的 `ROUTE_EXECUTION_STARTED` 才能使任务状态进入执行中。
- DJI `missionExecution=FINISHED` 或 `FAILED` 只在文件名和当前任务匹配时才能使桌面任务进入终态；它们不补造 `ROUTE_EXECUTION_STARTED`。
- 暂停、继续、停止在等待命令结果时必须保留“请求中”状态；命令成功后才进入对应已确认状态。
- `live-stream.start` 成功只表示手机接受 RTMP 推流；播放成功只能由媒体管线确认本机 HTTP-FLV 已就绪并由播放器附着后产生。
- `flight.*` 成功只表示 DJI 已完成该调用；飞行状态必须仍由后续遥测显示。
- `telemetry.read` 成功只表示手机已发布当前快照；不得据此把链路标为 ready。
- 设置读写成功必须携带可解码的 `command-result.result` 完整快照；缺失或畸形结果是 `invalid-result`，不得乐观更新。
- `pairing.status` 仅在命令 `succeeded` 时携带根契约 §7.4 的结构化 `result`（`pairingState`、`aircraftConnected`、`flightControllerConnected`、`aircraftModel`、`motorsOn`、`sdkRegistered`）。失败、超时或 `pairing.start` / `pairing.stop` 不得附带该 `result`。实时配对显示仍以入站遥测的 `pairingState` 为准，命令成功不等于已配对。

所有生产命令结果统一保留为业务模块已有的 `succeeded`、`rejected`、`timed-out`、`disconnected` 或 `transport-failed` 语义。`streamGateway` 可以把手机 `command-result.detail` 原样转成有界字符串（1..256 码点、无控制字符），供图传调度映射封闭原因码；不得泄露连接 ID、会话 ID、字节、路径、令牌、DJI 异常。

## 会话、断连与迟到事件

适配器以 `deviceId + sessionId` 识别当前会话。设备断开或同 ID 新会话替换时，必须：

1. 从公开设备列表移除旧设备；
2. 使该设备的遥测与命令端口立即不可用；
3. 让调用方可将任务、图传、设置和待确认飞控动作置为断连或删除；
4. 丢弃旧会话的迟到命令结果、阶段事件和遥测；
5. 不恢复旧任务上传、图传或飞控状态。

订阅回调抛出异常不得阻断其他订阅者。`dispose()` 幂等，释放对 `RelayLink` 的订阅；释放后不再发布事件。

## 验证要求

测试必须覆盖：

1. Android 全部已知遥测枚举到桌面布尔与能力字段的映射；
2. JSON null、缺失字段、未知枚举、畸形 JSON 值和恶意 getter 的安全拒绝；
3. 每条命令的精确名称和字段，尤其三条飞控命令的 `{ confirm: true }`；
4. 设置 `result` 解码和错误结果保留；
5. 启动确认与 `ROUTE_EXECUTION_STARTED` 的严格分离；
6. 暂停、继续、停止的请求中与确认后状态；
7. 多 Relay 隔离、断连、同 ID 会话替换与迟到事件丢弃；
8. 与手机端共享固定测试向量的双向兼容性；
9. 订阅释放、重复释放和依赖异常隔离；
10. 位姿透传（高度不受 `0..100` 限制；坐标成对校验；JSON null 不得变成 `0`）；
11. `pairing.status` 仅在成功时转发结构化 `result`，`pairing.start` / `pairing.stop` 与失败结果不得附带；
12. `telemetry.read` 以空字段下发，成功不得推导为飞机已连接。
