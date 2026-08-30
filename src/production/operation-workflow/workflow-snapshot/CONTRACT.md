# 工作流快照模块契约

状态：已实现

## 唯一职责

`workflow-snapshot` 将父模块已读取的安全航线、设备事实、任务、图传、媒体、设置和飞控确认投影为冻结工作流快照。它是纯函数：不订阅、不发送命令、不修改分配、不调用时间或下游模块。

## 接口

```ts
WorkflowSnapshot.create(input) -> OperationWorkflowSnapshot
```

未知遥测必须投影为 `unknown` 或 `null`。快照必须包含 `media.streams` 的冻结副本，每项只保留 `deviceId`、`phase` 和 `playbackUrl`（非字符串则为 `null`），供 `video.playback` 读取本机地址；不得保留输入对象引用，也不得带出 `diagnostic` 或其他媒体内部字段。连接快照必须包含：

- `msdk`：只读生命周期投影。仅将中继遥测的 `STOPPED`、`STARTING`、`READY`、`FAILED` 分别映射为 `stopped`、`starting`、`ready`、`failed`；缺失、畸形或未知值为 `unknown`。该字段只供观察，不参与任何命令、图传或飞机连接状态转换。
- `control`：只读的控制用连接投影，固定包含 `sdk`、`remoteController`、`flightController` 与 `aircraft`。它从父模块同一次读取的原始安全遥测直接投影，使用与 `connection` 相同的有限状态值，但绝不应用显示滞回，也不携带 DJI 原始对象、地址、端口或诊断信息。它只供操作台预先禁用新操作；真正的命令门禁仍由工作流及手机端的原始事实独立执行。
- `pairingState`：仅保留 `UNKNOWN`、`IDLE`、`PAIRING`、`PAIRED`、`STOPPING`、`FAILED`，其余为 `unknown`
- `aircraftModel` 与 `remoteControllerModel`：仅保留非空白、最多 128 个 Unicode 码点且不含控制字符的字符串，其余为 `null`
- `batteryPercent`：仅保留 `0..100` 的安全整数，其余为 `null`
- `motorsOn`：仅保留布尔值，其余为 `null`
- `flightMode`：仅保留非空白、最多 128 个 Unicode 码点且不含控制字符的字符串，其余为 `null`
- `remainingFlightTimeSeconds`：仅保留 `0..86,400` 的安全整数，其余为 `null`；该字段只代表 DJI 低电量返航策略预估，不得写成或用作通用预计飞行时间
- `pose`：`{ latitude, longitude, altitudeMeters } | null`
  - 经度纬度都是有限数值且分别落在 `[-90,90]`、`[-180,180]` 时成对填入，否则坐标为 `null`
  - `altitudeMeters` 仅保留有限数值，否则为 `null`
  - 坐标与高度都不可用时 `pose` 为 `null`
  - 不得把 JSON 空值或残缺坐标显示成 `0`
- `live`：只读直播指标，固定为 `{ streaming, resolution, fps, videoBitrateKbps, rttMillis }`。`streaming` 仅保留布尔值；`resolution` 仅保留上述安全文本；`fps` 仅保留 `0..240` 的有限数值；`videoBitrateKbps` 仅保留 `0..100,000` 的有限数值；`rttMillis` 仅保留 `0..60,000` 的安全整数；其余均为 `null`。这些是手机已上报的观测值，不得改变图传状态机、触发播放器行为或替代 `stream` 的命令状态。
- 飞控**明确断开**时，`batteryPercent`、`remainingFlightTimeSeconds`、`flightState`、`motorsOn`、`flightMode` 和 `pose` 均必须为未知或 `null`；不得展示先前连接留下的动态飞行数据。飞控状态未知时保持既有遥测投影语义。`live` 属于独立的当前图传观测，不能作为飞行事实或用于改变飞控状态。

## 验收

覆盖全部已声明枚举、缺失/畸形事实、设备排序、多设备隔离、冻结、敏感字段排除和不保留输入引用。
