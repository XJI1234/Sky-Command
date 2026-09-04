# 设备操作能力门禁模块契约

状态：已实施。

## 唯一职责

`capability-gate` 是设备控制台的纯提交前决策模块。它只判断一项操作是否具备进入当前在线手机、已就绪 DJI MSDK 的最小条件；它不发送命令、不读取 DJI、不等待回调、不保存遥测，也不把“可提交”表述为“操作一定成功”。

它不替 DJI Action 预判遥控器、飞控、电量、飞行状态、电机、机型或航线支持性。相机和图传设置的真实可用性由各自 `KeyManager.setValue` 回调裁决；直接飞行和航线的业务阶段由其专用模块裁决。

## 对外接口

```ts
CapabilityGate.evaluate(input: unknown) -> CapabilityDecisionResult<CapabilityDecision>
```

输入：

```ts
{
  operation: "pairing" | "live-stream" | "waypoint-mission" | "transmission-settings" | "camera-settings" | "direct-flight";
  relayConnected: boolean;
  /** Android SdkLifecycle 的原始封闭状态；缺失表示尚未收到事实。 */
  sdkAvailability?: "STOPPED" | "STARTING" | "READY" | "FAILED" | "UNKNOWN";
  /** 仅 pairing 读取。RemoteControllerKey.KeyConnection 的原始状态。 */
  remoteController?: "CONNECTED" | "DISCONNECTED" | "UNKNOWN";
  /** 仅 pairing 读取。FlightControllerKey.KeyConnection 的原始状态。 */
  flightController?: "CONNECTED" | "DISCONNECTED" | "UNKNOWN";
}
```

`sdkAvailability` 是所有分支唯一共同的 MSDK 事实。旧的 `sdkRegistered`、`remoteControllerConnected` 与 `flightControllerConnected` 仅供非生产兼容调用使用，不能覆盖已存在的原始字段。遥控器和飞控事实只属于对频维护操作。图传源的 AirLink/主相机实时状态属于遥测与运行期生命周期，不属于此模块的提交门禁输入。无关字段不应被读取，因此无关 getter、未知枚举或畸形能力值不能阻止其它操作到达手机端。

输出为冻结对象 `{ operation, enabled, reason }`。`enabled: true` 时 `reason` 固定为 `null`；实际拒绝码只能是 `RELAY_OFFLINE`、`SDK_NOT_READY`、`REMOTE_CONTROLLER_OFFLINE`、`FLIGHT_CONTROLLER_CONNECTION_UNKNOWN` 或 `PAIRING_NOT_NEEDED`。图传硬件是否可用必须由 DJI `startStream` 回调裁决，而不能被桌面端遥测推断提前拒绝。

## 判定规则

- 所有操作都先要求手机 Relay 在线和 `sdkAvailability === "READY"`。MSDK 原始状态缺失时，兼容输入 `sdkRegistered === true` 才可使用；其它缺失、未知或非就绪状态一律拒绝。
- `pairing` 是连接新飞机或更换遥控器时的低频维护操作，不是日常图传、航线或直接飞行的前置条件。它额外要求遥控器明确连接和飞控明确断开；飞控已连接时为 `PAIRING_NOT_NEEDED`，未知时为 `FLIGHT_CONTROLLER_CONNECTION_UNKNOWN`。
- `live-stream` 与传输设置、相机设置、直接飞行和航线操作一样，只要求 Relay 与 MSDK 可达。`AirLinkKey.KeyConnection` 与 `CameraKey.KeyConnection(LEFT_OR_MAIN)` 必须继续作为原始 MSDK 遥测显示，并在流已活动时触发断源清理；但它们的 `UNKNOWN` 或 `DISCONNECTED` 不得阻止人工发出一次 `startStream`。允许提交后，DJI `startStream` 回调、`LiveStreamStatus.isStreaming` 和桌面播放器仍分别确认后续阶段。
- `transmission-settings` 与 `camera-settings` 只要求 Relay 与 MSDK 可达。它们各自通过 AirLink 或 Camera Key 读写；设置是否支持、是否可写和 DJI 错误必须由手机端 MSDK 回调如实返回。
- 保留的 `direct-flight` 与 `waypoint-mission` 也只判断 Relay 与 MSDK 可达。生产直接飞行实际由 `flight-control` 重检，航线实际由 `mission-dispatcher` 的任务阶段机与 `PreflightCheck` 重检；两者均不得以显示遥测或能力快照替 DJI 最终裁决。

`ProductKey.KeyConnection` 不属于本模块输入。该 Key 的原始遥测只保留作兼容和诊断用途，不能授权任何操作。

## 错误、不变性与验证

非法容器、未知操作、调用分支实际需要的畸形字段或恶意 getter 都返回 `INVALID_INPUT`，且不泄露异常信息。每个结果均为冻结副本。测试必须覆盖每个分支的最小读取面、Relay/MSDK 拒绝、对频专属连接约束、图传对动态图传源字段的非依赖、无关字段 getter、不可变性、类型和架构隔离。
