# 直接飞行命令调度模块契约

状态：已批准实施

## 1. 职责

`flight-command-dispatcher` 只负责把已确认的直接飞行动作安全地映射为中继命令，并把动作类型对应的最小可达性/启动门禁、传输结果和同设备互斥收敛为稳定的结果对象。

它不创建确认请求，不保存确认标识，不直接使用 Socket 或 DJI SDK，不解析原始协议帧，不实现 UI，也不自动重试。

## 2. 对外接口

```ts
FlightCommandDispatcher.create(dependencies) -> FlightCommandDispatcherInstance
instance.check(deviceId, action) -> FlightCommandCheck
instance.dispatch(deviceId, action) -> Promise<FlightCommandResult>
instance.isBusy(deviceId) -> boolean
```

`check` 读取目标设备最新遥测，并调用 `PreflightCheck.evaluateFlightAction`。六个动作都只重读中继可达性和 `MSDK READY`；不调用通用能力门禁，也不以遥控器、飞控、飞行状态、飞行模式、电量、电机或降落确认事实拒绝。`dispatch` 必须再次调用同一动作对应的检查，再发送准确命令。MSDK 是所有直接飞行动作硬件条件的最终裁判。

命令映射固定：

| 动作 | 命令 |
| --- | --- |
| `takeoff` | `flight.takeoff` |
| `land` | `flight.land` |
| `confirm-landing` | `flight.confirm-landing` |
| `return-home` | `flight.return-home` |
| `stop-takeoff` | `flight.stop-takeoff` |
| `stop-auto-landing` | `flight.stop-auto-landing` |

所有命令字段固定为冻结的 `{ confirm: true }`；不允许桌面端传入其他飞行参数。

## 3. 门禁和结果

预检输入的 `relayConnected` 仅在存在该设备遥测快照时为真；遥测缺失会通过预检产生明确阻塞项。调度器不依赖 `device-console.CapabilityGate`，避免用显示或遥测事实重复取代 DJI Action 的实际结果。

`FlightCommandResult` 只能是：`SUCCEEDED`、`PREFLIGHT_BLOCKED`、`FLIGHT_ACTION_REJECTED`、`RESULT_UNCONFIRMED`、`FLIGHT_ACTION_INVOCATION_FAILED`、`RELAY_REJECTED`、`DEPENDENCY_FAILURE`、`OPERATION_IN_PROGRESS`、`INVALID_INPUT`。中继只在 `status === "succeeded"` 时表示成功。`status === "timed-out"` 或 `"disconnected"` 表示本机未确认手机端飞行动作的最终结果，必须归为 `RESULT_UNCONFIRMED`；不能推断命令没有执行。只有 `status === "rejected"` 且 `result` 是完整、受协议校验的 `{ domain: "flight", outcome: "ACTION_REJECTED", errorCode, errorDescription }` 时，才归为 `FLIGHT_ACTION_REJECTED` 并保留两个平台错误字段；对应 `RESULT_UNCONFIRMED` 和 `INVOCATION_FAILED` 结构分别映射为 `RESULT_UNCONFIRMED` 与 `FLIGHT_ACTION_INVOCATION_FAILED`。其余合法拒绝保留 `RELAY_REJECTED`，畸形或异常返回为 `DEPENDENCY_FAILURE`，绝不抛出。

手机端已注册六条飞控命令，生产组合必须通过 `relay-operations-adapter` 编码 `{ confirm: true }`，不得直接传递协议 JSON 或生成其他 `flight.*` 命令。

## 4. 并发与依赖

同一设备在 `dispatch` 发送尚未结算时再次 `dispatch` 必须返回 `OPERATION_IN_PROGRESS` 且不调用依赖。不同设备互不阻塞。所有依赖调用用防御边界包裹，恶意 getter、同步异常、拒绝 Promise 和畸形返回值均被转换为稳定结果。

只允许依赖经注入的公开端口；禁止导入 `relay-link` 或 `mission-control` 的内部实现。`check` 不改变状态；`dispatch` 不拥有确认状态。

## 5. 验证

测试必须覆盖全部六个映射、六个动作的最小可达性拒绝、起飞不会调用能力门禁、确认后的重检、防御性错误处理、同设备互斥、多设备并行、冻结结果和确认字段发送；类型和架构测试必须阻止协议帧/平台类型及不允许的导入，模块范围覆盖率、性能和 Stryker 必须为 100%。
