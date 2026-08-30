# 中继航线任务状态快照解析模块契约

状态：已批准；所属一级模块：mission-control。

## 职责

`relay-mission-phase-snapshot` 是纯解析模块，只从未知的 relay-link 快照中提取可安全使用的航线阶段事实与任务终态事实。它不订阅中继、不保存前次快照、不去重、不修改任务状态、不发送命令，也不依赖网络、DJI、Electron 或 UI。

## 接口

```ts
RelayMissionPhaseSnapshotReader.read(value: unknown): readonly RelayMissionPhaseSnapshot[] | null
RelayMissionPhaseSnapshotReader.readTerminalStates(value: unknown): readonly RelayMissionTerminalState[] | null
```

唯一接受形状为：

```ts
{ missionPhases: readonly { deviceId, missionRevision, deviceGeneration, sequence, phase, fileName }[] }
```

`deviceId`、`fileName`、整数字段和阶段枚举必须符合 `mission-phase-intake` 契约。数组中的任一条目无效、属性读取抛错或根对象畸形时，整体返回 `null`；调用方必须完全忽略该快照，不能据此改变任务状态。

`readTerminalStates` 只读取 `telemetry` 数组中每台设备的 `payload.missionExecution`、`payload.missionFileName`、`payload.missionRevision` 和 `payload.missionDeviceGeneration`。它兼容 relay-link 的受限 JSON 对象和生产适配器已投影的普通值，但只接受 `FINISHED` 与 `FAILED` 两种封闭终态、安全 `.kmz` 基名、正整数任务版本和非负安全整数设备代际；`STARTING`、`EXECUTING`、`PAUSED`、`STOPPING`、`NOT_STARTED`、缺失、null、未知枚举或畸形字段都不产生终态事实。调用方还必须将这组身份与此前可信 `ROUTE_EXECUTION_STARTED` 所绑定的身份逐项相等后才可结束任务。一个条目无法安全读取时整体返回 `null`，调用方不得据此改变任务状态。

## 输出与验收

成功结果是新的冻结数组，条目对象也是冻结副本，不保留输入引用。测试必须覆盖空/多条快照、每个拒绝字段、恶意 getter、输入修改隔离和类型接口。
