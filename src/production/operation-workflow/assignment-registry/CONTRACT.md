# 设备航线分配模块契约

状态：已批准设计，待实施

## 唯一职责

`assignment-registry` 仅保存并校验 `deviceId -> routeId` 的显式分配关系。它不读取中继、不读取航线库、不发送命令、不判断任务阶段，也不订阅任何对象。

## 接口

```ts
AssignmentRegistry.create() -> instance
instance.assign(deviceId, routeId) -> Result
instance.get(deviceId) -> routeId | null
instance.clear(deviceId) -> Result
instance.removeDevice(deviceId) -> boolean
instance.routesInUse(routeId) -> readonly deviceId[]
instance.snapshot() -> readonly Assignment[]
```

ID 只能由父模块传入已验证的稳定字符串；非法值稳定拒绝。返回值为冻结副本并按设备 ID 排序。分配覆盖仅由父模块在确认对应任务稳定终态后允许；本模块不推断该前置条件。

## 验收

覆盖首次分配、覆盖、清除、设备移除、航线反查、非法输入、排序、冻结和幂等行为。不得依赖任何其他生产模块。
