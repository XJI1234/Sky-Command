# 设备链路状态模块契约

状态：已批准实施。

## 唯一职责

`link-chain` 只把一个设备的电脑中继会话事实和手机端遥测字段，转换为操作员可直接显示的三段链路快照：电脑到手机、手机到遥控器、遥控器到飞行器。

它不建立或关闭 WebSocket，不请求遥测，不保存任何设备状态，不发起配对，不判断航线或直播能力，不读写设备设置，也不导入 DJI、Electron、Vue 或网络库。

## 对外接口

```ts
LinkChain.evaluate(input: unknown) -> LinkChainResult<LinkChainSnapshot>
```

输入为：

```ts
{
  deviceId: string;
  relayConnected: boolean;
  telemetry: null | {
    sdkRegistered?: boolean;
    remoteControllerConnected?: boolean;
    flightControllerConnected?: boolean;
  };
}
```

`deviceId` 是已配对手机的稳定设备标识，必须是 `1..128` 个 Unicode code point 的非空白、无控制字符字符串。`relayConnected` 只表示电脑到手机的中继会话是否在线；它绝不能被误读为 DJI 飞行器已连接。`telemetry: null` 表示该手机当前没有可用遥测，而不是任一设备连接为 false。

成功结果为：

```ts
{
  deviceId: string,
  overall: "ready" | "degraded" | "offline",
  computerToPhone: "connected" | "disconnected",
  phoneToRemoteController: "connected" | "disconnected" | "unknown",
  remoteControllerToAircraft: "connected" | "disconnected" | "unknown"
}
```

## 判定规则

- `relayConnected: false` 时，`computerToPhone` 为 `disconnected`，后两段均为 `unknown`，`overall` 为 `offline`；遥测值不得覆盖这一事实。
- 中继在线而没有遥测时，电脑到手机为 `connected`，后两段为 `unknown`，`overall` 为 `degraded`。
- 有遥测但 `sdkRegistered !== true` 时，后两段为 `unknown`，`overall` 为 `degraded`。
- SDK 已注册后，`phoneToRemoteController` 由明确的连接事实判定：true 为 `connected`，false 为 `disconnected`，缺失为 `unknown`。
- 只有遥控器为 `connected` 时，才读取 `flightControllerConnected`。它为 true 才得到 `remoteControllerToAircraft: connected`，为 false 时为 `disconnected`，缺失时为 `unknown`。遥控器断开时飞机段为 `unknown`，不能显示为断开，因为手机无法确认该段事实。
- 只有三段均为 `connected` 时 `overall` 才为 `ready`。对频是独立的低频维护状态，绝不参与三段链路判定或降低已连接链路的就绪状态。`ProductKey.KeyConnection` 不属于此链路输入。`remoteControllerToAircraft` 是面向操作员的飞控可用链路摘要，唯一 DJI 连接来源为 `FlightControllerKey.KeyConnection`。

## 错误与不可变性

非对象输入、不可读 getter、非法 `deviceId`、非布尔 `relayConnected`，或遥测对象中存在非布尔的已知字段，均返回冻结失败：`{ ok: false, error: { code: "INVALID_INPUT", details: { field, reason } } }`。错误不得回显输入值或异常消息。

所有成功与失败结果及嵌套对象都是冻结副本。输入对象后续被调用方修改不得影响先前结果。模块无状态，任意调用之间绝不相互影响。

## 依赖与验证

本模块只能依赖 ECMAScript 基础能力。测试必须覆盖离线、无遥测、SDK 未注册、遥控器断开、飞行器连接、字段缺失、非法与恶意输入、不可变性、架构隔离、类型边界、性能和 100% 变异测试。
