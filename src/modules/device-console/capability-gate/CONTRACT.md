# 设备操作能力门禁模块契约

状态：已批准实施。

## 唯一职责

`capability-gate` 只根据电脑端已知的设备链路状态和手机端遥测 `capabilities` 字段，判定一项设备操作现在是否可提交，并在不可提交时给出稳定、可显示的原因码。

它不发送命令、不等待命令结果、不读取 DJI、不保存遥测、不推断不存在的能力字段，也不把“可提交”表述为“操作一定成功”。

## 固定能力字段来源

手机端根契约 §8.2 是唯一来源，字段名必须逐字一致：`liveVideo`、`waypointMission`、`waypointMissionSupport`、`virtualStick`。本模块不得使用命令名或自创字段，例如 `waypoint.start`、`video.start`。

## 对外接口

```ts
CapabilityGate.evaluate(input: unknown) -> CapabilityDecisionResult<CapabilityDecision>
```

输入：

```ts
{
  operation: "pairing" | "live-stream" | "waypoint-mission" | "transmission-settings" | "camera-settings";
  relayConnected: boolean;
  sdkRegistered: boolean | undefined;
  remoteControllerConnected: boolean | undefined;
  flightControllerConnected: boolean | undefined;
  aircraftConnected: boolean | undefined;
  capabilities: null | {
    liveVideo?: boolean;
    waypointMission?: boolean;
    waypointMissionSupport?: "supported" | "unsupported";
    virtualStick?: boolean;
  };
}
```

输出为冻结对象 `{ operation, enabled, reason }`。`enabled: true` 时 `reason` 固定为 `null`；否则为以下之一：`RELAY_OFFLINE`、`SDK_NOT_READY`、`REMOTE_CONTROLLER_OFFLINE`、`AIRCRAFT_NOT_CONNECTED`、`PAIRING_NOT_NEEDED`、`CAPABILITY_UNKNOWN`、`LIVE_VIDEO_UNSUPPORTED`、`WAYPOINT_UNSUPPORTED`。

## 判定规则

- 中继离线时全部拒绝 `RELAY_OFFLINE`。
- SDK 不是 `true` 时全部拒绝 `SDK_NOT_READY`；遥控器不是 `true` 时全部拒绝 `REMOTE_CONTROLLER_OFFLINE`。
- `pairing` 仅在 SDK/遥控器就绪且飞控、飞行器均不是 true 时允许；已连接任一飞行器段时拒绝 `PAIRING_NOT_NEEDED`。
- 其余操作均要求飞控和飞行器均为 true，否则拒绝 `AIRCRAFT_NOT_CONNECTED`。
- `live-stream` 还要求 `capabilities.liveVideo === true`。能力对象缺失或字段缺失为 `CAPABILITY_UNKNOWN`，显式 false 为 `LIVE_VIDEO_UNSUPPORTED`。
- `waypoint-mission` 还要求 `waypointMission === true` 且 `waypointMissionSupport === "supported"`。字段缺失为 `CAPABILITY_UNKNOWN`，其他情况为 `WAYPOINT_UNSUPPORTED`。
- `transmission-settings` 与 `camera-settings` 不拥有额外能力字段；在飞机链路就绪时允许。

## 错误、不变性与验证

非法容器、未知操作、非布尔链路字段、非法能力对象和恶意 getter 都返回 `INVALID_INPUT`，且不泄露异常信息。所有结果都是冻结副本。测试覆盖每个原因码、能力字段逐字匹配、优先级、缺失/显式 false、恶意输入、不可变性、架构隔离、类型、性能和 100% 变异测试。
