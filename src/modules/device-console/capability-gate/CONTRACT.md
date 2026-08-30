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

输出为冻结对象 `{ operation, enabled, reason }`。`enabled: true` 时 `reason` 固定为 `null`；否则为以下之一：`RELAY_OFFLINE`、`SDK_NOT_READY`、`REMOTE_CONTROLLER_OFFLINE`、`AIRCRAFT_NOT_CONNECTED`、`AIRCRAFT_CONNECTION_UNKNOWN`、`PAIRING_NOT_NEEDED`、`CAPABILITY_UNKNOWN`、`LIVE_VIDEO_UNSUPPORTED`、`WAYPOINT_UNSUPPORTED`。

## 判定规则

- 中继离线时全部拒绝 `RELAY_OFFLINE`。
- SDK 不是 `true` 时全部拒绝 `SDK_NOT_READY`。
- `pairing` 是连接新飞机或更换遥控器时的低频维护操作，不是常规连接、图传、航线或直接控制前置条件。它要求遥控器明确已连接且飞行器明确未连接；飞行器已连接时拒绝 `PAIRING_NOT_NEEDED`，飞行器状态未知时拒绝 `AIRCRAFT_CONNECTION_UNKNOWN`。飞控已连接但飞行器未连接属于不一致事实，必须拒绝。
- `live-stream` 要求遥控器已连接，并要求 `capabilities.liveVideo === true`。能力对象缺失或字段缺失为 `CAPABILITY_UNKNOWN`，显式 false 为 `LIVE_VIDEO_UNSUPPORTED`。`live-stream` 不因飞控/飞机遥测未连而拒绝（由 DJI 启动结果判定）。
- 其余操作要求遥控器、飞控和飞行器均为 true，否则拒绝 `REMOTE_CONTROLLER_OFFLINE` 或 `AIRCRAFT_NOT_CONNECTED`。
- `waypoint-mission` 还要求 `waypointMission === true` 且 `waypointMissionSupport === "supported"`。字段缺失为 `CAPABILITY_UNKNOWN`，其他情况为 `WAYPOINT_UNSUPPORTED`。
- `transmission-settings` 与 `camera-settings` 不拥有额外能力字段；在飞机链路就绪时允许。

## 错误、不变性与验证

非法容器、未知操作、非布尔链路字段、非法能力对象和恶意 getter 都返回 `INVALID_INPUT`，且不泄露异常信息。所有结果都是冻结副本。测试覆盖每个原因码、能力字段逐字匹配、优先级、缺失/显式 false、恶意输入、不可变性、架构隔离、类型、性能和 100% 变异测试。
