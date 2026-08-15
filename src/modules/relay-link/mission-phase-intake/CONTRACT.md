# 航线阶段接收模块契约

状态：已批准；所属一级模块：relay-link。

## 职责

`mission-phase-intake` 仅接收已经由 `protocol-core` 解码的航线阶段事实，并按中继连接保存每个连接最新、可信且严格递增的事实。它负责拒绝无效字段、过期序号和同序号冲突，向调用方提供防御性副本；不解析网络字节、不查询设备身份、不发送命令、不推断 DJI 飞行状态，也不改变任务状态机。

## 接口

```ts
MissionPhaseIntake.create() -> MissionPhaseIntakeInstance
instance.accept({ connectionId, missionRevision, deviceGeneration, sequence, phase, fileName })
  -> { ok: true, value: MissionPhaseFact } | { ok: false, error: { code: "INVALID_MISSION_PHASE" | "STALE_MISSION_PHASE" } }
instance.get(connectionId) -> MissionPhaseFact | null
instance.remove(connectionId) -> void
instance.snapshot() -> readonly MissionPhaseConnectionFact[]
```

阶段枚举仅为 `START_POINT_REACHED` 与 `ROUTE_EXECUTION_STARTED`。`connectionId`、`fileName` 的合法性与协议层 ID/KMZ 文件名规则一致；`missionRevision > 0`、`deviceGeneration >= 0`、`sequence > 0` 均必须是安全整数。

## 顺序与隔离

同一连接仅接受比已保存 `sequence` 更大的事实。小于或等于当前序号的事实均返回 `STALE_MISSION_PHASE`，既不覆盖现有事实，也不通知调用方。不同连接互不影响。`remove` 对未知连接无操作，连接关闭后不得留下旧事实。

返回值、快照数组及其中对象必须冻结且与调用方输入脱离引用；任何 getter 异常或畸形输入只能返回稳定错误，绝不抛出原始异常。

## 依赖与验收

生产代码只依赖 TypeScript/JavaScript 标准库，不依赖 WebSocket、Node、Electron、DJI、Android、任务调度或 UI。测试必须覆盖两种合法阶段、每个字段边界、序号递增/重复/倒退、连接隔离、删除、输入修改隔离、恶意 getter 与全部拒绝分支。
