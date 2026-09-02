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
  capabilities: null | {
    liveVideo?: boolean;
    waypointMission?: boolean;
    waypointMissionSupport?: "supported" | "unsupported";
    virtualStick?: boolean;
  };
}
```

输出为冻结对象 `{ operation, enabled, reason }`。`enabled: true` 时 `reason` 固定为 `null`；否则为以下之一：`RELAY_OFFLINE`、`SDK_NOT_READY`、`REMOTE_CONTROLLER_OFFLINE`、`FLIGHT_CONTROLLER_OFFLINE`、`FLIGHT_CONTROLLER_CONNECTION_UNKNOWN`、`PAIRING_NOT_NEEDED`、`CAPABILITY_UNKNOWN`、`LIVE_VIDEO_UNAVAILABLE`、`LIVE_VIDEO_UNSUPPORTED`、`WAYPOINT_UNSUPPORTED`。`LIVE_VIDEO_UNAVAILABLE` 表示手机端当前未确认满足图传启动门禁，绝不表示机型不支持。

## 判定规则

- 中继离线时全部拒绝 `RELAY_OFFLINE`。
- SDK 不是 `true` 时全部拒绝 `SDK_NOT_READY`。
- `pairing` 是连接新飞机或更换遥控器时的低频维护操作，不是常规连接、图传、航线或直接控制前置条件。它要求遥控器明确已连接且飞控明确未连接；飞控已连接时拒绝 `PAIRING_NOT_NEEDED`，飞控状态未知时拒绝 `FLIGHT_CONTROLLER_CONNECTION_UNKNOWN`。
- `live-stream` 的开始要求手机中继在线、MSDK 已就绪且 `capabilities.liveVideo === true`。该能力由手机端按产品 Key、AirLink Key 与主相机 Key 的当前三态推导；它不依赖飞控连接。`liveVideo` 缺失时拒绝 `CAPABILITY_UNKNOWN`，为 false 时拒绝 `LIVE_VIDEO_UNAVAILABLE`，不得写成“当前机不支持图传”。能力为 true 只表示允许提交；DJI `startStream` 回调、`LiveStreamStatus.isStreaming` 和桌面播放器仍分别确认后续阶段。
- 除图传与对频外，其余操作要求遥控器和飞控均为 true，否则拒绝 `REMOTE_CONTROLLER_OFFLINE` 或 `FLIGHT_CONTROLLER_OFFLINE`。
- `waypoint-mission` 还要求 `waypointMission === true` 且 `waypointMissionSupport === "supported"`。字段缺失为 `CAPABILITY_UNKNOWN`，其他情况为 `WAYPOINT_UNSUPPORTED`。
- `transmission-settings` 与 `camera-settings` 不拥有额外能力字段；在遥控器与飞控链路就绪时允许。

`ProductKey.KeyConnection` 不属于本模块输入，也不得由调用方以兼容布尔值代替飞控事实。该 Key 的原始遥测仅保留在生产适配层作兼容和诊断用途，不能授权任何操作。

## 错误、不变性与验证

非法容器、未知操作、非布尔链路字段、非法能力对象和恶意 getter 都返回 `INVALID_INPUT`，且不泄露异常信息。所有结果都是冻结副本。测试覆盖每个原因码、能力字段逐字匹配、优先级、缺失/显式 false、恶意输入、不可变性、架构隔离、类型、性能和 100% 变异测试。
