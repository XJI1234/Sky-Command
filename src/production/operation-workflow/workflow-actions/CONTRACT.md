# 工作流动作模块契约

状态：已实施

## 唯一职责

`workflow-actions` 校验工作流动作的共同前置条件，并把动作精确委托给已有一级模块公开接口。它不拥有任务、图传、飞控或设置状态机，不构造协议命令，不调用 DJI。

## 接口

```ts
WorkflowActions.create(dependencies) -> instance
instance.stage(deviceId) -> Promise<Result>
instance.mission(operation, deviceId) -> Promise<Result>
instance.startStream(deviceId) -> Promise<Result>
instance.stopStream(deviceId) -> Promise<Result>
instance.readTransmission(deviceId) -> Promise<Result>
instance.writeTransmission(deviceId, patch) -> Promise<Result>
instance.readCamera(deviceId) -> Promise<Result>
instance.writeCamera(deviceId, patch) -> Promise<Result>
instance.requestFlight(deviceId, action) -> Result
instance.confirmFlight(deviceId, confirmationId) -> Promise<Result>
instance.cancelFlight(deviceId, confirmationId) -> Result
```

依赖必须只提供一级模块的公开方法，以及由父模块传入的 `online(deviceId)`、`assignedRoute(deviceId)` 与 `settingsAllowed(deviceId, domain)` 事实。任务操作只映射 `MissionControl` 的六个同名方法；图传只映射 `LiveStreamControl.start/stop`；设置只映射 `DeviceSettingsPanel` 四个方法；直接飞控只映射 `FlightControl.request/confirm/cancel`。控制遥测刷新与硬件预检属于父工作流的跨模块编排责任：本模块只在已通过该门禁后精确委托下游，绝不访问中继、协议或 DJI。所有依赖异常统一为稳定失败，且不得泄露内部错误。

## 验收

覆盖精确委托、在线/分配前置条件、依赖异常、拒绝保留、所有操作枚举和跨设备隔离。
