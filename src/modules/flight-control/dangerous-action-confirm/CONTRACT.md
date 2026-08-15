# 危险动作确认模块契约

状态：已批准实施

## 1. 职责

`dangerous-action-confirm` 只负责危险飞行动作的显式二次确认请求。它为一个设备的一项动作创建不可猜测的确认标识，保证该标识一次性、限时、不可跨设备或跨动作使用，并支持取消和清理。

它不进行飞行安全判断，不发送中继命令，不读取遥测，不调用 DJI、UI、定时器或网络库。时间由调用方在每次操作中显式提供，因此模块为纯内存、可确定测试。

## 2. 对外接口

```ts
DangerousActionConfirm.create(options) -> DangerousActionConfirmInstance

instance.begin(deviceId, action, nowMs) -> ConfirmationResult
instance.consume(deviceId, action, confirmationId, nowMs) -> ConfirmationResult
instance.consumeCurrent(deviceId, confirmationId, nowMs) -> ConfirmationResult
instance.cancel(deviceId, confirmationId, nowMs) -> ConfirmationResult
instance.get(deviceId, nowMs) -> PendingConfirmation | null
instance.clear(deviceId) -> boolean
instance.clearAll() -> void
```

`options.createConfirmationId()` 必须每次提供非空、无控制字符、长度不超过 128 的标识；`ttlMs` 必须是 `1..60000` 的整数。无效配置或工厂异常使相应操作返回稳定拒绝结果，不抛原始异常。

## 3. 状态与原子性

每台设备最多保存一条待确认记录：`{ deviceId, action, confirmationId, expiresAtMs }`。`begin` 为同一设备替换旧记录；`consume` 只有在设备、动作、标识都一致且 `nowMs < expiresAtMs` 时才成功删除记录；`cancel` 只有标识一致且未过期时才成功删除记录。任何读取都先清理该设备已过期记录。

`consumeCurrent` 在同一个原子操作内读取当前动作并按标识消费，供一级组合根使用，以保留过期和不匹配的精确结果。

开始、消费、取消及读取操作均不能返回内部状态引用。所有结果、记录均冻结。`nowMs` 必须是有限安全整数；无效时间一律稳定拒绝。

## 4. 错误语义

失败码固定为：`INVALID_INPUT`、`CONFIGURATION_INVALID`、`ID_UNAVAILABLE`、`NO_PENDING_CONFIRMATION`、`CONFIRMATION_MISMATCH`、`CONFIRMATION_EXPIRED`。成功码固定为：`PENDING`、`CONSUMED`、`CANCELLED`、`CLEARED`。调用方根据这些稳定码决定界面文案，但不得从错误中推测其他设备的确认状态。

## 5. 依赖与验证

实现只使用语言标准库。测试必须覆盖配置、输入、替换、一次性消费、过期、取消、跨设备/动作隔离、不可变性、恶意 getter 和重复清理；类型、覆盖率、性能和 100% 变异测试必须通过。
