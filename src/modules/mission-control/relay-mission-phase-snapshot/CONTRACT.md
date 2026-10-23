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

`deviceId`、`fileName`、整数字段和阶段枚举必须符合 `mission-phase-intake` 契约。逐设备校验，单条无效或属性读取抛错只丢弃该条，不得阻塞其他设备的有效事实。根对象畸形、数组不可读取或所有事实均无效时返回 `null`；有效空数组返回冻结空数组。调用方不能根据被丢弃的事实改变任务状态。

`readTerminalStates` 只读取 `telemetry` 数组中每台设备的 `payload.missionExecution`、`payload.missionFileName`、`payload.missionRevision` 和 `payload.missionDeviceGeneration`。它兼容 relay-link 的受限 JSON 对象和生产适配器已投影的普通值，但只接受 `FINISHED` 与 `FAILED` 两种封闭终态、安全 `.kmz` 基名、正整数任务版本和非负安全整数设备代际；`STARTING`、`EXECUTING`、`PAUSED`、`STOPPING`、`NOT_STARTED`、缺失、null、未知枚举或畸形字段都不产生终态事实。调用方还必须将这组身份与此前可信里程碑所绑定的身份逐项相等后才可结束任务。单条终态缺少身份或无法安全读取时，仍须保留其他设备完整有效的终态；没有有效终态且存在无效条目时返回 `null`。

## 输出与验收

成功结果是新的冻结数组，条目对象也是冻结副本，不保留输入引用。测试必须覆盖空/多条快照、每个拒绝字段、恶意 getter、输入修改隔离和类型接口。
