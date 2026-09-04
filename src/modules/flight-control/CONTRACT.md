# 直接飞行控制模块契约

状态：已批准实施

## 1. 职责

`flight-control` 是电脑端直接飞行动作的一级门面。它只向调用方公开经过安全门禁、明确二次确认并通过手机中继发送的起飞、降落、确认继续降落、返航、停止自动起飞和停止自动降落操作。

它不连接 DJI 设备，不自行创建 WebSocket，不保存遥测，不解释航线任务阶段，不执行地图或界面逻辑，也不把手机端的命令拒绝伪装为成功。航线任务仍完全属于 `mission-control`。

## 2. 对外接口

```ts
FlightControl.create(dependencies, options?) -> FlightControlInstance

instance.request(deviceId, action) -> FlightActionRequest
instance.confirm(deviceId, confirmationId) -> Promise<FlightCommandResult>
instance.cancel(deviceId, confirmationId) -> FlightActionRequest
instance.get(deviceId) -> FlightActionRequest | null
instance.subscribe(listener) -> unsubscribe
instance.dispose() -> void
```

`action` 只能是 `takeoff`、`land`、`confirm-landing`、`return-home`、`stop-takeoff` 或 `stop-auto-landing`。`request` 永远不发送命令；它只执行该动作对应的预检，并为 `takeoff` 额外执行能力门禁，然后创建一份有时限且只可消费一次的确认请求。`confirm` 只能消费同一设备当前待确认请求，成功或失败均关闭该请求。`cancel` 也只能取消同一设备当前待确认请求。

所有公开返回值均为冻结副本；不可信输入、依赖抛错、迟到回调和已释放实例不得把原始异常抛给调用方。

## 3. 组合规则

一级根只创建一个 `DangerousActionConfirm` 实例和一个 `FlightCommandDispatcher` 实例。确认状态只由前者拥有；命令名、门禁顺序、同设备互斥和发送结果只由后者拥有。根不得维护第二套确认或命令状态机。

`flight-command-dispatcher` 只能调用以下公开依赖：

- `relay-link.sendCommand(deviceId, request)`；
- `relay-link.latestTelemetry(deviceId)`；
- `mission-control.PreflightCheck.evaluateFlightAction(input)`；
- `device-console.CapabilityGate.evaluate(input)`。

它不得导入上述模块的二级实现、协议帧或平台库。全部飞行命令都必须通过飞行预检和 `dangerous-action-confirm`；仅 `takeoff` 还通过能力门禁，不存在直接发送路径。

## 4. 安全和结果

全部六项操作都需要一次显式确认；确认不能复用、不能跨设备、不能跨动作，且在过期、取消、发送结果返回或释放后失效。重复确认、缺少确认、过期确认、设备不一致或动作不一致都不得产生传输效果。

全部飞行动作都会拒绝离线中继或未就绪 MSDK。`takeoff` 还会拒绝遥控器或飞控未连接，并要求电量不低于 20%、确认在地面且电机关闭；它经过 `direct-flight` 能力门禁。`land`、`confirm-landing`、`return-home`、`stop-takeoff`、`stop-auto-landing` 不会因遥控器/飞控连接、旧/未知遥测、电量、飞行状态、飞行模式或页面推断而被桌面端硬拦截；一旦已能调用 MSDK，DJI 是最终裁判。拒绝结果必须含稳定错误码和可显示原因，不能只返回 `false`。

手机端已注册 `flight.takeoff`、`flight.land`、`flight.confirm-landing`、`flight.return-home`、`flight.stop-takeoff` 和 `flight.stop-auto-landing`，且每条命令必须携带 `{ confirm: true }`。桌面动作与手机命令、DJI Action Key 的一对一关系固定为：`takeoff -> flight.takeoff -> KeyStartTakeoff`、`land -> flight.land -> KeyStartAutoLanding`、`confirm-landing -> flight.confirm-landing -> KeyConfirmLanding`、`return-home -> flight.return-home -> KeyStartGoHome`、`stop-takeoff -> flight.stop-takeoff -> KeyStopTakeoff`、`stop-auto-landing -> flight.stop-auto-landing -> KeyStopAutoLanding`。`confirm-landing` 只有原始 `KeyIsLandingConfirmationNeeded=true` 且飞行状态仍明确为在空中时才允许创建确认；它绝不由 `land` 自动附带。`land` 的 Action 回调成功后，工作流只可显示“等待 MSDK 确认落地”；只有连续状态快照中的 `KeyIsFlying=false` 且 `KeyAreMotorsOn=false` 才可显示“已确认落地”。手机返回的完整飞行结果必须保留其语义：MSDK `onFailure` 的错误码和说明显示为 `FLIGHT_ACTION_REJECTED`；手机/电脑未取得飞行动作终态时显示为 `RESULT_UNCONFIRMED`，不得推断命令未执行；只有没有可验证平台结果的普通手机端拒绝才显示为 `RELAY_REJECTED`。

## 5. 生命周期和并发

每个 `deviceId` 同时最多有一个待确认或发送中的直接飞行动作；不同设备可并行。确认请求只在显式 `request`、`cancel`、`confirm`、过期检查、`dispose` 或同设备新的合法请求时变化。`dispose()` 幂等，清除全部确认请求并阻止迟到的发送结果重新发布状态；它不会发送取消、降落或返航命令。

订阅者仅在确认请求增删或命令结果落定后收到冻结快照。监听器异常和重入不得回滚已提交状态。

## 6. 依赖边界

本模块只允许依赖 `flight-control` 自己的公开二级入口，以及 `relay-link`、`mission-control`、`device-console` 的一级公开类型/接口。禁止导入 WebSocket、Node 网络或文件 API、Electron、DJI、Android、地图、媒体、UI 框架、其他模块内部路径及任务发送接口。

## 7. 验证要求

测试必须覆盖六项命令的精确映射和 `{ confirm: true }` 字段、每一类预检与能力拒绝、确认的一次性/过期/跨设备隔离、取消、同设备互斥、多设备并行、手机拒绝、依赖异常、不可变快照、订阅隔离和释放后的迟到结果。还必须有类型测试拒绝原始协议帧、Socket、DJI 对象和未确认的命令发送；架构测试必须阻止反向或内部依赖。模块范围的类型、100% 覆盖率、性能和 Stryker 变异测试均须通过。
