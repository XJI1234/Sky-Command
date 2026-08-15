# 工作流快照模块契约

状态：已实现

## 唯一职责

`workflow-snapshot` 将父模块已读取的安全航线、设备事实、任务、图传、媒体、设置和飞控确认投影为冻结工作流快照。它是纯函数：不订阅、不发送命令、不修改分配、不调用时间或下游模块。

## 接口

```ts
WorkflowSnapshot.create(input) -> OperationWorkflowSnapshot
```

未知遥测必须投影为 `unknown` 或 `null`。连接快照必须包含：

- `pairingState`：仅保留 `UNKNOWN`、`IDLE`、`PAIRING`、`PAIRED`、`STOPPING`、`FAILED`，其余为 `unknown`
- `pose`：`{ latitude, longitude, altitudeMeters } | null`
  - 经度纬度都是有限数值且分别落在 `[-90,90]`、`[-180,180]` 时成对填入，否则坐标为 `null`
  - `altitudeMeters` 仅保留有限数值，否则为 `null`
  - 坐标与高度都不可用时 `pose` 为 `null`
  - 不得把 JSON 空值或残缺坐标显示成 `0`

## 验收

覆盖全部已声明枚举、缺失/畸形事实、设备排序、多设备隔离、冻结、敏感字段排除和不保留输入引用。
