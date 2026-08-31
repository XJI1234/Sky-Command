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
instance.controlTelemetry(deviceId) -> DesktopRelayTelemetry | null
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
| `sdkAvailability` | `sdkAvailability`、`sdkRegistered` | 仅原始封闭枚举 `STOPPED`、`STARTING`、`READY`、`FAILED` 可作为 `sdkAvailability` 保留；同时仅 `READY` 派生为 `sdkRegistered=true`，其余三态派生为 `false`；缺失或未知均为 `undefined` |
| `deviceRevision` | `deviceRevision` | 仅保留正安全整数。它是手机端 `DeviceStateStore` 对当前 MSDK 设备事实的单调版本，供同一 Relay 会话内拒绝较旧的连接观察；不是时间戳，也不代表飞行遥测的独立版本 |
| `remoteController` | `remoteController`、`remoteControllerConnected` | 原始封闭枚举 `UNKNOWN`、`DISCONNECTED`、`CONNECTED` 必须原样保留为 `remoteController`；仅 `CONNECTED` 派生兼容值 `true`，仅 `DISCONNECTED` 派生兼容值 `false`，`UNKNOWN` 不得伪造成布尔值 |
| `flightController` | `flightController`、`flightControllerConnected` | 原始封闭枚举 `UNKNOWN`、`DISCONNECTED`、`CONNECTED` 必须原样保留为 `flightController`；仅 `CONNECTED` 派生兼容值 `true`，仅 `DISCONNECTED` 派生兼容值 `false`，`UNKNOWN` 不得伪造成布尔值 |
| `aircraft` | `aircraft`、`connected` | 此既有字段只承载 `ProductKey.KeyConnection` 的原始“硬件产品连接”枚举 `UNKNOWN`、`DISCONNECTED`、`CONNECTED`，不得将其解释为飞机物理在线；仅 `CONNECTED` 派生兼容值 `true`，仅 `DISCONNECTED` 派生兼容值 `false`，`UNKNOWN` 不得伪造成布尔值 |
| `aircraftModel`、`remoteControllerModel` | 同名字段 | 仅保留非空白、最多 128 个 Unicode 码点且不含控制字符的字符串 |
| `isFlying`、`motorsOn` | 同名字段 | 仅保留布尔值 |
| `flightMode` | 同名字段 | 仅保留非空白、最多 128 个 Unicode 码点且不含控制字符的字符串 |
| `batteryPercent` | 同名字段 | 仅保留 `0..100` 的有限数值 |
| `lowBatteryRthState` | 同名字段 | 仅保留 `IDLE`、`COUNTING_DOWN`、`EXECUTED`、`CANCELLED`；`UNKNOWN`、缺失或畸形值一律不投影 |
| `remainingFlightTimeSeconds` | 同名字段 | 仅在 `lowBatteryRthState` 已投影时保留 `1..86,400` 的安全整数；只表示 DJI 低电量返航策略预估，不能作为通用预计飞行时间或安全门禁。`UNKNOWN + 0` 必须视为未知 |
| `pairing` | `pairing`、`pairingState` | 原始受限枚举 `UNKNOWN`、`IDLE`、`PAIRING`、`PAIRED`、`STOPPING`、`FAILED` 必须原样保留为 `pairing`；`pairingState` 仅为既有调用方的兼容别名 |
| `latitude` / `longitude` | 同名字段 | 仅在两者都是有限数值且分别落在 `[-90,90]`、`[-180,180]` 时成对保留；缺一、越界、JSON null 均省略，不得写成 `0` |
| `altitudeMeters` | 同名字段 | 仅保留有限数值，不受电池 `0..100` 范围限制 |
| `liveStreaming` | 同名字段 | 仅保留布尔值；它是当前只读观测，不能改变桌面图传状态机 |
| `liveResolution` | 同名字段 | 仅在 `liveStreaming=true` 时保留非空白、最多 128 个 Unicode 码点且不含控制字符的字符串 |
| `liveFps` | 同名字段 | 仅在 `liveStreaming=true` 时保留 `0..240` 的有限数值 |
| `liveVideoBitrateKbps` | 同名字段 | 仅在 `liveStreaming=true` 时保留 `0..100,000` 的有限数值 |
| `liveRttMillis` | 同名字段 | 仅在 `liveStreaming=true` 时保留 `0..60,000` 的非负安全整数 |
| `missionExecution` | 同名封闭枚举 | 仅保留 `NOT_STARTED`、`STARTING`、`EXECUTING`、`PAUSED`、`STOPPING`、`FINISHED`、`FAILED` |
| `missionFileName` | 同名字段 | 仅保留安全 `.kmz` 基名；缺失或 null 为 `undefined` |
| `missionRevision` | 同名字段 | 仅保留正安全整数；它与文件名共同标识任务代际 |
| `missionDeviceGeneration` | 同名字段 | 仅保留非负安全整数；它标识手机端设备运行代际 |
| `capabilities.liveVideo` | 同名字段 | 仅保留布尔值；字段名不得改写 |
| `capabilities.waypointMission` | 同名字段 | 仅保留布尔值；字段名不得改写 |
| `capabilities.waypointMissionSupport` | 同名字段 | 线协议 `SUPPORTED` / `UNSUPPORTED` 归一为桌面门禁词表 `supported` / `unsupported`；其他值为 `undefined`。这不是改字段名。 |

投影只保留表中声明的安全枚举值，不得公开协议 JSON 或任意未知字段。`sdkAvailability`、`remoteController`、`flightController`、`aircraft` 与 `pairing` 是设备页的只读 MSDK 原始状态事实：显示链路必须直接消费这些枚举，不能改读兼容布尔值、别名、合并多个字段或施加显示保持。`aircraft` 是兼容字段名，但其唯一来源是 `ProductKey.KeyConnection`，显示为 DJI 硬件产品连接，绝不显示为飞机物理连接。`sdkRegistered`、`remoteControllerConnected`、`flightControllerConnected`、`connected` 与 `pairingState` 只保留给既有调用方的兼容投影。适配器不得把“Relay 在线”推导为“SDK 已就绪”或“飞机已连接”。

`liveStreaming=false` 或未知时，适配器不得投影分辨率、帧率、码率或 RTT，避免设备页把上一轮图传留下的指标显示为当前事实。

`telemetry(deviceId)` 与 `controlTelemetry(deviceId)` 必须读取同一份“当前会话设备事实”，两者不得维护不同来源、不同值或不同的显示保持期。该事实只能由两种 Android MSDK 观察更新：持续订阅的 `TelemetryFrame`，或一次 `telemetry.read` 在手机重新读取各硬件 Key 后返回的完整基线。订阅遥测必须同时携带 `relay-link` 为它绑定的 `sessionId`，且与当前 `{ deviceId, sessionId }` 完全一致；缺失或不一致时整条遥测不得显示、不得写入观察、不得授权控制。二者都必须能解码出完整的连接字段与正 `deviceRevision`；同一会话内较小的 `deviceRevision` 不得覆盖较大的版本。一次 `telemetry.read` 成功可立刻成为当前事实，使本次控制与设备页看见同一结果；随后抵达的不旧于它的订阅帧继续替换该事实。

当前会话的已确认 MSDK 事实在状态长期不变时仍然有效，绝不能因为桌面经过若干秒没有收到新事件就自动变成不可信。接收时间只供操作员观察链路，不参与门禁判定。事实必须在设备断开、同 ID 会话替换、MSDK 观察停止/重启、结果畸形，或新事件明确给出 `UNKNOWN`/`DISCONNECTED` 时按字段更新或清空；新的会话或观察代次只有在收到该代完整 MSDK Key 基线后才能再次授权开始型操作。显示链路绝不单独授权命令，控制模块仍必须逐项执行自身门禁。

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
- DJI `missionExecution=FINISHED` 或 `FAILED` 只在文件名、`missionRevision`、`missionDeviceGeneration` 和当前任务身份均匹配时才能使桌面任务进入终态；它们不补造 `ROUTE_EXECUTION_STARTED`。
- 暂停、继续、停止在等待命令结果时必须保留“请求中”状态；命令成功后才进入对应已确认状态。
- `live-stream.start` 成功只表示手机接受 RTMP 推流；播放成功只能由媒体管线确认本机 HTTP-FLV 已就绪并由播放器附着后产生。
- `flight.*` 成功只表示 DJI 已完成该调用；飞行状态必须仍由后续遥测显示。
- `telemetry.read` 成功只表示手机已返回当次完整 MSDK 快照；不得据此推导任何链路一定 ready。手机必须先重新建立硬件 Key 观察并读取初值，适配器仅在请求前后仍为同一 `deviceId + sessionId`、结构化 `result` 可按本契约完整解码且携带正 `deviceRevision` 时，才将它写入该会话的当前设备事实。读取失败、超时、畸形或会话变化不得覆盖现有订阅事实，也不得制造控制授权；调用方仍必须逐项执行各自的门禁。
- 设置读写成功必须携带可解码的 `command-result.result` 完整快照；缺失或畸形结果是 `invalid-result`，不得乐观更新。
- `pairing.status` 仅在命令 `succeeded` 时携带根契约 §7.4 的结构化 `result`（`pairingState`、`aircraftConnected`、`flightControllerConnected`、`aircraftModel`、`motorsOn`、`sdkRegistered`）。失败、超时或 `pairing.start` / `pairing.stop` 不得附带该 `result`。实时配对显示仍以入站遥测的 `pairingState` 为准，命令成功不等于已配对。

所有生产命令结果统一保留为业务模块已有的 `succeeded`、`rejected`、`timed-out`、`disconnected` 或 `transport-failed` 语义。`streamGateway` 可以把手机 `command-result.detail` 原样转成有界字符串（1..256 码点、无控制字符），供图传调度映射封闭原因码；不得泄露连接 ID、会话 ID、字节、路径、令牌、DJI 异常。

## 会话、断连与迟到事件

适配器以 `deviceId + sessionId` 识别当前会话。设备断开或同 ID 新会话替换时，必须：

1. 从公开设备列表移除旧设备；
2. 使该设备的遥测与命令端口立即不可用；
3. 立即丢弃该设备的显示补充遥测与控制遥测；
4. 让调用方可将任务、图传、设置和待确认飞控动作置为断连或删除；
5. 丢弃旧会话的迟到命令结果、阶段事件和遥测；
6. 不恢复旧任务上传、图传或飞控状态。

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
13. `telemetry.read` 的有效完整结果只能为同会话建立短时控制遥测；过期、会话替换、断连和迟到结果均不得复活该事实。
