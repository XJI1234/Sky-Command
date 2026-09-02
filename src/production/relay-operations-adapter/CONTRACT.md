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
instance.refreshTelemetry(deviceId) -> Promise<{ status, snapshot, result? }>
instance.dispose() -> void
```

每次调用端口工厂返回同一逻辑门面；门面不暴露 `RelayLink`。所有快照为深度隔离的冻结副本。

实现中保留的 `whipStreamGateway()` 仅供封存源码与其独立测试维持可编译性；它不是生产接口，`desktop-application`、UI、IPC 和任何新业务代码不得调用或重新接线它。

## 入站遥测投影

手机端 `TelemetryFrameMapper` 是唯一来源。适配器只接受下列已知字段；缺失、JSON null、类型不匹配或未知枚举不得推测为成功。

| Android 协议字段 | 桌面投影字段 | 转换规则 |
| --- | --- | --- |
| `sdkAvailability` | `sdkAvailability`、`sdkRegistered` | 仅原始封闭枚举 `STOPPED`、`STARTING`、`READY`、`FAILED` 可作为 `sdkAvailability` 保留；同时仅 `READY` 派生为 `sdkRegistered=true`，其余三态派生为 `false`；缺失或未知均为 `undefined` |
| `telemetrySequence` | `telemetrySequence` | 手机组合根为每个实际发送的 `TelemetryFrame` 分配的正安全整数，只在同一 `deviceId + sessionId` 内比较。它不是 DJI Key、不是时间戳，也不是控制门禁条件；有此字段时，较小或相等序号的帧必须丢弃，防止旧完整快照覆盖新状态。为兼容旧 APK，缺失该字段的帧仍可按 `deviceRevision` 处理，但不得覆盖已经收到带 `telemetrySequence` 的帧。 |
| `deviceRevision` | `deviceRevision` | 仅保留正安全整数。它是手机端 `DeviceStateStore` 对当前 MSDK 设备事实的单调版本，供同一 Relay 会话内拒绝较旧的连接观察；不是时间戳，也不代表飞行遥测的独立版本 |
| `remoteController` | `remoteController`、`remoteControllerConnected` | 原始封闭枚举 `UNKNOWN`、`DISCONNECTED`、`CONNECTED` 必须原样保留为 `remoteController`；仅 `CONNECTED` 派生兼容值 `true`，仅 `DISCONNECTED` 派生兼容值 `false`，`UNKNOWN` 不得伪造成布尔值 |
| `flightController` | `flightController`、`flightControllerConnected` | 原始封闭枚举 `UNKNOWN`、`DISCONNECTED`、`CONNECTED` 必须原样保留为 `flightController`；仅 `CONNECTED` 派生兼容值 `true`，仅 `DISCONNECTED` 派生兼容值 `false`，`UNKNOWN` 不得伪造成布尔值 |
| `aircraft` | `aircraft`、`connected` | 此既有字段只承载 `ProductKey.KeyConnection` 的原始“硬件产品连接”枚举 `UNKNOWN`、`DISCONNECTED`、`CONNECTED`。它仅为兼容和诊断保留，不得进入工作流快照、设备页、链路摘要或任何操作门禁；不得将其解释为飞机物理在线。仅 `CONNECTED` 派生兼容值 `true`，仅 `DISCONNECTED` 派生兼容值 `false`，`UNKNOWN` 不得伪造成布尔值 |
| `airLink` | `airLink` | 原始封闭枚举 `UNKNOWN`、`DISCONNECTED`、`CONNECTED` 必须一对一保留为 `AirLinkKey.KeyConnection`；不得由产品、飞控或相机字段推断，也不派生兼容布尔值 |
| `camera` | `camera` | 原始封闭枚举 `UNKNOWN`、`DISCONNECTED`、`CONNECTED` 必须一对一保留为 `CameraKey.KeyConnection(LEFT_OR_MAIN)`；不得由产品、飞控或 AirLink 字段推断，也不派生兼容布尔值 |
| `battery` | `battery` | 原始封闭枚举 `UNKNOWN`、`DISCONNECTED`、`CONNECTED` 必须一对一保留为 `BatteryKey.KeyConnection(LEFT_OR_MAIN)`；不得由飞控、产品或其他 Key 推断，也不派生兼容布尔值 |
| `aircraftModel`、`remoteControllerModel` | 同名字段 | 仅保留非空白、最多 128 个 Unicode 码点且不含控制字符的字符串 |
| `isFlying`、`motorsOn` | 同名字段 | 仅保留布尔值 |
| `flightMode` | 同名字段 | 仅保留非空白、最多 128 个 Unicode 码点且不含控制字符的字符串；MSDK 明确返回 `UNKNOWN` 时必须透传 |
| `batteryPercent` | 同名字段 | 仅在同一帧的 `battery=CONNECTED` 时保留 `0..100` 的有限数值；其他情况必须省略 |
| `lowBatteryRthState` | 同名字段 | 仅保留 `IDLE`、`COUNTING_DOWN`、`EXECUTED`、`CANCELLED`、`UNKNOWN`；缺失或畸形值不投影。`UNKNOWN` 是 MSDK 的明确状态，不得伪装成尚未取得 |
| `remainingFlightTimeSeconds` | 同名字段 | 仅在 `lowBatteryRthState` 为四种非 `UNKNOWN` 状态之一时保留 `1..86,400` 的安全整数；只表示 DJI 低电量返航策略预估，不能作为通用预计飞行时间或安全门禁。`UNKNOWN + 0` 必须保留状态、隐藏时间 |
| `pairing` | `pairing`、`pairingState` | 原始受限枚举 `UNKNOWN`、`IDLE`、`PAIRING`、`PAIRED`、`STOPPING`、`FAILED` 必须原样保留为 `pairing`；`pairingState` 仅为既有调用方的兼容别名 |
| `latitude` / `longitude` | 同名字段 | 仅在两者都是有限数值且分别落在 `[-90,90]`、`[-180,180]` 时成对保留；缺一、越界、JSON null 均省略，不得写成 `0` |
| `altitudeMeters` | 同名字段 | `FlightControllerKey.KeyAltitude` 的相对起飞点高度；仅保留有限数值，不受电池 `0..100` 范围限制，不换算为海拔或下视测距高度 |
| `liveStreaming` | 同名字段 | 仅保留布尔值；它是当前只读观测，不能改变桌面图传状态机 |
| `liveResolution` | 同名字段 | 仅在 `liveStreaming=true` 时保留非空白、最多 128 个 Unicode 码点且不含控制字符的字符串 |
| `liveFps` | 同名字段 | 仅在 `liveStreaming=true` 时保留 `0..240` 的有限数值 |
| `liveVideoBitrateKbps` | 同名字段 | 仅在 `liveStreaming=true` 时保留 `0..100,000` 的有限数值 |
| `livePacketLoss` | 同名字段 | 仅在 `liveStreaming=true` 时保留 DJI `LiveStreamStatus.packetLoss` 的非负安全整数原值；不解释为百分比 |
| `livePacketCacheLength` | 同名字段 | 仅在 `liveStreaming=true` 时保留 DJI `LiveStreamStatus.packetCacheLen` 的非负安全整数原值；不解释为时长或字节数 |
| `liveRttMillis` | 同名字段 | 仅在 `liveStreaming=true` 时保留 `0..60,000` 的非负安全整数 |
| `missionExecution` | 同名封闭枚举 | 仅保留 `NOT_STARTED`、`STARTING`、`EXECUTING`、`PAUSED`、`STOPPING`、`FINISHED`、`FAILED` |
| `missionFileName` | 同名字段 | 仅保留安全 `.kmz` 基名；缺失或 null 为 `undefined` |
| `missionRevision` | 同名字段 | 仅保留正安全整数；它与文件名共同标识任务代际 |
| `missionDeviceGeneration` | 同名字段 | 仅保留非负安全整数；它标识手机端设备运行代际 |
| `capabilities.liveVideo` | 同名字段 | 仅保留布尔值；字段名不得改写 |
| `capabilities.waypointMission` | 同名字段 | 仅保留布尔值；字段名不得改写 |
| `capabilities.waypointMissionSupport` | 同名字段 | 线协议 `SUPPORTED` / `UNSUPPORTED` 归一为桌面门禁词表 `supported` / `unsupported`；其他值为 `undefined`。这不是改字段名。 |

投影只保留表中声明的安全枚举值，不得公开协议 JSON 或任意未知字段。`sdkAvailability`、`remoteController`、`flightController`、`airLink`、`camera`、`battery` 与 `pairing` 是设备页的只读 MSDK 原始状态事实：显示链路必须直接消费这些枚举，不能改读兼容布尔值、别名、合并多个字段或施加显示保持。`batteryPercent` 只由同一帧的 `battery=CONNECTED` 授权，不能被飞控连接状态清除或放行。`aircraft` 与兼容布尔值 `connected` 的唯一来源是 `ProductKey.KeyConnection`，只留在适配器诊断遥测中，不能显示或被读取为飞机物理连接。`sdkRegistered`、`remoteControllerConnected`、`flightControllerConnected` 与 `pairingState` 是既有调用方的兼容投影。适配器不得把“Relay 在线”推导为“SDK 已就绪”或“飞机已连接”。

`liveStreaming=false` 或未知时，适配器不得投影分辨率、帧率、码率或 RTT，避免设备页把上一轮图传留下的指标显示为当前事实。

`telemetry(deviceId)` 与 `controlTelemetry(deviceId)` 必须读取同一份“当前会话设备事实”，两者不得维护不同来源、不同值或不同的显示保持期。该事实以 Android MSDK Key 的持续订阅为主，手机组合根为每次实际发布的 `TelemetryFrame` 赋予单调 `telemetrySequence`；设备页显式 `telemetry.read` 只读取并回传当前已订阅的快照，不重建任何 MSDK Key 观察。订阅遥测必须同时携带 `relay-link` 为它绑定的 `sessionId`，且与当前 `{ deviceId, sessionId }` 完全一致；缺失或不一致时整条遥测不得显示、不得写入观察、不得授权控制。`controlTelemetry` 的结构化基线只要求 `sdkAvailability`、遥控器、飞控与正 `deviceRevision`；`ProductKey.KeyConnection` 可留在原始诊断遥测，但不得影响完整性或控制。AirLink 和主相机是图传能力与设备显示的原始事实，不能因缺失而阻断航线或飞控操作。图传开始则必须由 `capabilities.liveVideo` 单独实行失效关闭的门禁。有 `telemetrySequence` 的同一会话内，只有严格更大的序号才能替换当前事实；未带序号的旧兼容帧不得覆盖已带序号的事实。仅旧兼容帧之间才可回退到 `deviceRevision` 比较。一次有效 `telemetry.read` 结果可在尚未收到订阅帧时成为当前事实，但不能覆盖更高序号的订阅事实；随后抵达的新订阅帧继续替换该事实。

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
- `telemetry.read` 的命令 `status=succeeded` 只表示手机已回复。返回的 `snapshot` 还必须说明本次快照是否可作为当前会话事实：`accepted` 表示完整解码并采用，`already-current` 表示完整解码但桌面已持有更新的同会话订阅事实，`invalid` 表示结果缺失、畸形或不可采纳，`session-changed` 表示请求期间会话替换，`unavailable` 表示命令未成功。只有 `accepted` 或 `already-current` 才能向设备页报告刷新成功。手机不重建硬件 Key 观察，也不启动 DJI、航线、图传或飞控操作。适配器仅在请求前后仍为同一 `deviceId + sessionId`、结构化 `result` 可按本契约完整解码且携带正 `deviceRevision` 时，才可在尚无较高 `telemetrySequence` 订阅事实的条件下将它写入该会话的当前设备事实。读取失败、超时、畸形或会话变化不得覆盖现有订阅事实，也不得制造控制授权；调用方仍必须逐项执行各自的门禁。
- 设置读写成功必须携带可解码的 `command-result.result` 完整快照；缺失或畸形结果是 `invalid-result`，不得乐观更新。
- `pairing.status` 仅在命令 `succeeded` 时携带根契约 §7.4 的结构化 `result`（`pairingState`、`flightControllerConnected`、`aircraftModel`、`motorsOn`、`sdkRegistered`）。失败、超时或 `pairing.start` / `pairing.stop` 不得附带该 `result`。实时配对显示仍以入站遥测的 `pairingState` 为准，命令成功不等于已配对。

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
13. `telemetry.read` 只读取当前订阅快照，不得重建 MSDK Key 观察；它的有效完整结果可在同会话且尚无更高订阅序号时更新当前事实，断连、会话替换、畸形和迟到结果均不得复活旧事实。
14. 带 `telemetrySequence` 的较新完整遥测在同一会话内不得被较小或相等序号、或不带该序号的旧兼容帧覆盖。
