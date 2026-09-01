# 实机预检模块契约

状态：已批准实施

## 唯一职责

`hardware-readiness` 是桌面端真机操作前的纯决策模块。它根据桌面环境事实、手机 Relay 事实和手机上报的 DJI 连接事实，判断旧 RTMP/HTTP-FLV 图传或直接飞控是否允许开始。

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
    readonly sdkRegistered?: boolean;
    readonly remoteControllerConnected?: boolean;
    readonly flightControllerConnected?: boolean;
    readonly connected?: boolean;
  };
}
```

旧图传检查桌面局域网与媒体服务事实；飞控检查不要求这两项。两种检查都要求手机当前在线和 MSDK 已就绪。飞控动作额外要求遥控器、飞控和产品连接事实均明确为已连接；旧图传不把遥控器、飞控或航线遥测当作桌面端推流门闩。中继在线经过的时间不能替代任何 MSDK Key 事实。

这是 DJI MSDK `ILiveStreamManager.startStream` 的调用边界：桌面只能先确认手机能调用已经配置好的直播管理器，真实的遥控器/飞机链路、产品支持性、网络服务及推流创建结果必须由 DJI 的异步完成回调和后续 RTMP 入流确认。桌面不得把瞬时遥测或缺失的型号能力字段写成“当前机不支持图传”。缺失、非布尔或畸形的必要安全事实仍一律阻塞，不得推定为安全。

## 阻塞项和顺序

每个阻塞项为 `{ code, message }`，消息可显示且不含地址、端口、路径、设备标识、密钥、媒体 URL 或第三方异常。结果按以下固定顺序去重：

1. `INVALID_INPUT`
2. `DESKTOP_NETWORK_UNAVAILABLE`（仅旧图传）
3. `LEGACY_MEDIA_UNAVAILABLE`（仅旧图传）
4. `PHONE_DISCONNECTED`
5. `SDK_NOT_READY`
6. `REMOTE_CONTROLLER_DISCONNECTED`（仅飞控）
7. `FLIGHT_CONTROLLER_DISCONNECTED`（仅飞控）
8. `AIRCRAFT_DISCONNECTED`（仅飞控）

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

测试必须覆盖两种目标的完全通过、每个阻塞项、完整顺序、目标隔离、缺失事实、畸形输入、getter 异常、不可变性和重复评估。架构测试必须锁住纯模块边界。
