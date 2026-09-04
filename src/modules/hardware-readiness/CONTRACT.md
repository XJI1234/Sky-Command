# 实机预检模块契约

状态：已批准实施

## 唯一职责

`hardware-readiness` 是桌面端调用边界的纯决策模块。它根据桌面环境事实、手机 Relay 事实和手机上报的 MSDK 生命周期，判断旧 RTMP/HTTP-FLV 图传或直接飞行动作是否能够进入 MSDK。

它不读取 Electron、文件系统、端口、WebSocket、DJI 或 UI；不发送命令；不改变任何图传、飞控或会话状态。宿主负责探测事实，工作流负责在动作前调用本模块。

## 接口

```ts
HardwareReadiness.evaluate(input, target) -> HardwareReadinessResult
```

`target` 只能是 `legacy-video` 或 `flight-control`。调用同步、确定、可重入；不可信输入和 getter 异常不得抛出。返回对象、数组和每个阻塞项均为冻结副本，绝不保留输入引用。

## 输入

```ts
interface HardwareReadinessInput {
  readonly desktop: {
    readonly lanAddressAvailable: boolean;
    readonly legacyMediaAvailable: boolean;
  };
  readonly relayConnected: boolean;
  readonly payload: {
    readonly sdkAvailability?: "STOPPED" | "STARTING" | "READY" | "FAILED" | "UNKNOWN";
    readonly sdkRegistered?: boolean;
  };
}
```

`sdkAvailability` 是本模块唯一读取的 MSDK 状态，来自 Android SDK 生命周期。旧的 `sdkRegistered` 布尔投影仅为迁移兼容保留，原始字段存在时一律忽略；缺失、`UNKNOWN`、非就绪或畸形值都不能放行 MSDK 调用。遥控器、飞控与其它 MSDK Key 不属于本模块输入，避免显示事实或无关读取错误阻止命令到达 DJI。

旧图传额外检查桌面局域网与媒体服务事实；直接飞行动作不要求这两项。两种检查都要求手机当前在线和 MSDK 已就绪。中继在线经过的时间不能替代 MSDK 生命周期事实。`ProductKey.KeyConnection`、`RemoteControllerKey.KeyConnection` 与 `FlightControllerKey.KeyConnection` 的原始值仍在 Relay 遥测中供显示与相应业务使用，但不参与此模块的可达性结论。

这是 DJI MSDK `ILiveStreamManager.startStream` 与飞行 Action 的调用边界：桌面只能先确认手机能调用已就绪 MSDK，真实的遥控器/飞机链路、产品支持性、飞行安全、网络服务及推流创建结果必须由 DJI 的异步完成回调和后续 RTMP 入流确认。桌面不得把瞬时遥测或缺失的型号能力字段写成“当前机不支持图传”。

## 阻塞项和顺序

每个阻塞项为 `{ code, message }`，消息可显示且不含地址、端口、路径、设备标识、密钥、媒体 URL 或第三方异常。结果按以下固定顺序去重：

1. `INVALID_INPUT`
2. `DESKTOP_NETWORK_UNAVAILABLE`（仅旧图传）
3. `LEGACY_MEDIA_UNAVAILABLE`（仅旧图传）
4. `PHONE_DISCONNECTED`
5. `SDK_NOT_READY`

畸形输入仅返回 `INVALID_INPUT`。其余合法输入必须收集全部独立阻塞项，不得因为前一项失败而短路。

## 结果

```ts
type HardwareReadinessResult =
  | { readonly ok: true; readonly blockers: readonly [] }
  | { readonly ok: false; readonly blockers: readonly HardwareReadinessBlocker[] };
```

只有阻塞列表为空时 `ok` 为真。该结果只表示开始操作前已知条件，不把手机接受图传命令、RTMP 入流或 HTTP-FLV 首帧伪造成已验证事实；那些事实仍由既有媒体健康状态机负责。

## 依赖边界和验证

本模块只使用语言标准库。禁止导入 Electron、Node、网络、文件系统、媒体、Relay、DJI、飞控、图传、UI 或任何生产适配器。

测试必须覆盖两种目标的完全通过、每个阻塞项、完整顺序、目标隔离、缺失事实、畸形输入、无关 MSDK Key 的 getter 异常、不可变性和重复评估。架构测试必须锁住纯模块边界。
