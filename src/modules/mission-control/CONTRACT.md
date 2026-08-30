# 飞行任务控制模块契约

状态：已批准实施

## 1. 职责

`mission-control` 是电脑端航线任务业务的一级门面。它负责把航线库中已经导入的航线、已配对安卓手机的中继能力，以及每台设备独立的任务调度器组合为一个统一接口。

调用方只能通过本模块给指定设备暂存、上传、启动、暂停、恢复、停止和清理任务。它不编辑或解析航线、不管理 WebSocket、不创建 DJI/Android 对象、不负责图传、地图或界面，也绝不自动起飞、降落、返航、重试或恢复任务。

`PreflightCheck.evaluateFlightAction` 同时作为一级公开的安全判定接口供 `flight-control` 使用。它只判断中继、SDK、遥控器、飞行器、电量和飞行状态等设备事实，不包含确认逻辑或命令；它不改变本模块的航线任务调度职责。

## 2. 对外接口

```ts
MissionControl.create(dependencies, options) -> MissionControlInstance

instance.stage(deviceId, routeId) -> Promise<DispatchResult>
instance.upload(deviceId) -> Promise<DispatchResult>
instance.start(deviceId) -> Promise<DispatchResult>
instance.pause(deviceId) -> Promise<DispatchResult>
instance.resume(deviceId) -> Promise<DispatchResult>
instance.stop(deviceId) -> Promise<DispatchResult>
instance.get(deviceId) -> MissionDispatchSnapshot
instance.list() -> readonly MissionDispatchSnapshot[]
instance.forget(deviceId) -> boolean
instance.subscribe(listener) -> unsubscribe
instance.dispose() -> void
```

`create` 接受兼容 `RouteLibrary`、`RelayLink` 的公开一级接口和 `createMissionId(deviceId, routeId)`。它只创建一个调度器实例，并对上层隐藏全部二级模块。所有返回对象和数组都是复制且冻结的；依赖异常、无在线手机或已释放的实例均不得向调用方抛出原始异常。

## 3. 组合规则

航线适配层只能调用 `RouteLibrary.getMissionPayload(routeId)`；中继适配层只能调用 `RelayLink.sendMission`、`RelayLink.sendCommand` 和 `RelayLink.latestTelemetry`。任务阶段、预检、命令发送和每设备状态仅由 `mission-dispatcher` 及其子模块拥有，本模块不得复制另一套状态机。

暂存成功仅表示手机已接收并保存 KMZ；只有手机确认 `wayline.upload` 成功后才可认为飞机已接收航线；手机确认 `wayline.start` 成功后任务仍处于 `starting`，只有有效的 `ROUTE_EXECUTION_STARTED` 阶段事实才可进入 `running`。该模块不得缩短或合并这些阶段。

## 4. 中继断线协调

本模块订阅一次中继设备快照，并比较前后两次的在线 `deviceId` 与 `sessionId`。一个持有活动任务的设备从已确认在线列表中消失、或同一 `deviceId` 的 `sessionId` 发生替换时，调用调度器的 `recordDisconnected(deviceId)` 并清除该设备旧会话的阶段去重水位：任务进入 `disconnected`，不发送停止命令、不重传、不自动恢复，也不自动删除。桌面进入 `disconnected` 只结束本端等待；它不表示飞机上的 DJI 航线已经停下。新会话的阶段代际可能从较小值重新开始，清除水位只允许新会话的后续事实被重新校验，不恢复旧任务。

同一快照中的 `missionPhases` 只允许有效的 `ROUTE_EXECUTION_STARTED` 把当前匹配文件与两项任务身份的任务从 `starting` 转为 `running`。同一快照中的已校验 `missionExecution` 终态只允许 `FINISHED -> completed`、`FAILED -> failed`；它们必须同时匹配设备、当前文件名、`missionRevision`、`deviceGeneration` 与此前可信执行事实，绝不把“手机接受启动请求”或任意自由文本当作执行完成。终态遥测遗漏正向阶段帧时可从 `starting` 直接变为 `completed`，也可在断线后收敛匹配终态，但不得伪造 `running`。设备重连后，`disconnected` 任务不自动恢复；操作者只能显式停止，或重新暂存。

首次收到的中继快照不视为断线；同一设备重新出现也不恢复旧任务，操作者必须重新暂存。遥测缺失只是启动前检查的失败条件，不等价于手机断线。`dispose()` 会取消中继订阅，且可重复调用；释放后所有迟到事件都必须被忽略。

## 5. 错误和安全

本模块原样转发调度器的稳定结果和错误码，不把前置检查失败伪装为传输失败，也不泄露原始电话返回详情、字节、文件路径、令牌、连接 ID 或异常堆栈。`dispose()` 不发送 `wayline.stop`，因为桌面端无法保证该命令一定抵达手机。

## 6. 依赖边界

本模块仅允许依赖 `mission-control` 的公开子模块，以及 `route-library`、`relay-link` 的公开类型/接口。禁止导入二级实现、协议帧、Electron、WebSocket、Node 文件或网络 API、Android/Kotlin、DJI、地图、媒体服务和 UI 框架。

## 7. 验证要求

测试必须覆盖：六个操作的精确委托、航线和中继错误保留、订阅隔离、首次快照、设备消失、重连不恢复、释放后不再响应、多设备独立、不可变快照和恶意依赖对象。类型测试必须拒绝原始帧、连接对象、内部航线资产和 DJI 对象。根模块完成前，根范围变异测试必须达到 100%。
