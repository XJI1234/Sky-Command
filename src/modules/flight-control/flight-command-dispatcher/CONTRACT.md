# 直接飞行命令调度模块契约

状态：已批准实施

## 1. 职责

`flight-command-dispatcher` 只负责把已确认的直接飞行动作安全地映射为中继命令，并把预检、能力门禁、传输结果和同设备互斥收敛为稳定的结果对象。

它不创建确认请求，不保存确认标识，不直接使用 Socket 或 DJI SDK，不解析原始协议帧，不实现 UI，也不自动重试。

## 2. 对外接口

```ts
FlightCommandDispatcher.create(dependencies) -> FlightCommandDispatcherInstance
instance.check(deviceId, action) -> FlightCommandCheck
instance.dispatch(deviceId, action) -> Promise<FlightCommandResult>
instance.isBusy(deviceId) -> boolean
```

`check` 读取目标设备最新遥测，先调用 `PreflightCheck.evaluateFlightAction`，再调用 `CapabilityGate.evaluate`；通过时返回 `{ ok: true }`，否则返回完整的稳定拒绝原因。`dispatch` 必须再次调用同一检查，再发送准确命令。

命令映射固定：

| 动作 | 命令 |
| --- | --- |
| `takeoff` | `flight.takeoff` |
| `land` | `flight.land` |
| `return-home` | `flight.return-home` |

所有命令字段固定为冻结的 `{ confirm: true }`；不允许桌面端传入其他飞行参数。

## 3. 门禁和结果

预检输入的 `relayConnected` 仅在存在该设备遥测快照时为真；遥测缺失会通过预检产生明确阻塞项。能力门禁操作名固定为 `direct-flight`，它只要求中继、SDK、遥控器和飞行器链路均已就绪，不依赖虚拟摇杆能力。

`FlightCommandResult` 只能是：`SUCCEEDED`、`PREFLIGHT_BLOCKED`、`CAPABILITY_BLOCKED`、`RELAY_REJECTED`、`DEPENDENCY_FAILURE`、`OPERATION_IN_PROGRESS`、`INVALID_INPUT`。中继只在 `status === "succeeded"` 时表示成功；其它合法或异常返回值均为 `RELAY_REJECTED` 或 `DEPENDENCY_FAILURE`，绝不抛出。

手机端已注册三条飞控命令，生产组合必须通过 `relay-operations-adapter` 编码 `{ confirm: true }`，不得直接传递协议 JSON 或生成其他 `flight.*` 命令。

## 4. 并发与依赖

同一设备在 `dispatch` 发送尚未结算时再次 `dispatch` 必须返回 `OPERATION_IN_PROGRESS` 且不调用依赖。不同设备互不阻塞。所有依赖调用用防御边界包裹，恶意 getter、同步异常、拒绝 Promise 和畸形返回值均被转换为稳定结果。

只允许依赖经注入的公开端口；禁止导入 `relay-link`、`mission-control` 或 `device-console` 的内部实现。`check` 不改变状态；`dispatch` 不拥有确认状态。

## 5. 验证

测试必须覆盖全部三个映射、检查顺序、预检/能力拒绝无发送、重检、防御性错误处理、同设备互斥、多设备并行、冻结结果和确认字段发送；类型和架构测试必须阻止协议帧/平台类型及不允许的导入，模块范围覆盖率、性能和 Stryker 必须为 100%。
