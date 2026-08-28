# webrtc-media 一级模块契约

状态：已封存的 WebRTC/WHIP/WHEP 旁路源码与独立测试；不纳入生产组合根。

> 封存规则：本模块只保留给历史低延迟旁路的源码和测试。生产 `desktop-application`、Electron 宿主、IPC 和操作台不得创建、调用或暴露它；重新启用必须先取得业务批准，并同步更新两端根契约、生产装配和跨端验证。

## 唯一职责

`webrtc-media` 是桌面端低延迟媒体组合根。它管理 MediaMTX 的生命周期，按设备观察发布路径，维护媒体健康状态，并为已经发布的设备生成受控的本机 WHEP 播放目标。

它不向手机发送图传命令，不实现 DJI，不创建 WebSocket，不读取 Electron 或 UI 全局对象，不转码、不保存视频，也不依赖旧的 `media-pipeline`、FFmpeg、HLS 或 Node RTMP 实现。

## 公开接口

```ts
interface NetworkInterfaceFact {
  readonly name: string;
  readonly enabled: boolean;
  readonly internal: boolean;
  readonly kind: "physical" | "wifi" | "virtual" | "vpn" | "tunnel" | "bluetooth";
  readonly ipv4: string;
}

interface StartInput {
  readonly interfaces: readonly NetworkInterfaceFact[];
  readonly manualHost: string | null;
  readonly executablePath: string;
}

interface WebRtcMediaDependencies {
  readonly process: MediaMtxProcessPort;
  readonly paths: MediaPathPort;
  readonly player: WhepPlaybackPort;
  readonly clock?: () => number;
}

interface WebRtcMediaOptions {
  readonly httpPort: number;
  readonly webRtcUdpPort: number;
  readonly apiPort: number;
  readonly pathPrefix: string;
  readonly mode: "whip-whep";
  readonly publisherTimeoutMs: number;
}

interface MediaStreamSnapshot {
  readonly deviceId: string;
  readonly phase: "awaiting-publisher" | "publisher-ready" | "failed";
  readonly lastEvent: "publisher-connected" | "publisher-disconnected" | "first-frame-rendered" | "process-exited" | "stop" | null;
  readonly diagnostic: string | null;
}

interface MediaSnapshot {
  readonly phase: "idle" | "starting" | "running" | "stopping" | "failed" | "disposed";
  readonly revision: number;
  readonly streams: readonly MediaStreamSnapshot[];
  readonly player: PlaybackSnapshot;
  readonly diagnostic: string | null;
}

interface PublishTarget {
  readonly kind: "whip";
  readonly deviceId: string;
  readonly url: string;
}

interface PlaybackTarget {
  readonly kind: "whep";
  readonly deviceId: string;
  readonly url: string;
}

type MediaResult<T> =
  | Readonly<{ readonly ok: true; readonly value: T }>
  | Readonly<{ readonly ok: false; readonly code: string; readonly value: MediaSnapshot }>;

WebRtcMedia.create(dependencies, options) -> WebRtcMediaInstance
instance.start(input: unknown) -> MediaResult<MediaSnapshot>
instance.stop() -> MediaResult<MediaSnapshot>
instance.evaluate(now: unknown) -> Promise<MediaResult<MediaSnapshot>>
instance.publishTarget(deviceId: unknown) -> MediaResult<PublishTarget>
instance.playback(deviceId: unknown) -> MediaResult<PlaybackTarget>
instance.selectPlayer(deviceId: unknown) -> MediaResult<MediaSnapshot>
instance.clearPlayer() -> MediaResult<MediaSnapshot>
instance.snapshot() -> MediaSnapshot
instance.dispose() -> Unit
```

`publishTarget` 只在媒体服务运行后生成受控的局域网 WHIP 地址，供 `whip-stream-control` 构造手机命令；`playback` 只在对应设备已发布后生成受控的本机 WHEP 地址，供 `whep-playback` 播放。两者都不把地址写入 `MediaSnapshot`。

`start` 只接受局域网网卡事实、MediaMTX 可执行文件和可选手工主机；端口、进程路径、原始 WHIP/WHEP 地址和异常不得进入公开快照。

## 状态

组合根状态为 `idle`、`starting`、`running`、`stopping`、`failed`、`disposed`。每条设备流状态为 `awaiting-publisher`、`publisher-ready`、`failed`。`publisher-ready` 只表示 MediaMTX 已观察到该设备发布，不能表示浏览器已经显示首帧。

播放目标是独立受控结果：

```text
{ kind: "whep", deviceId: string, url: http(s)://127.0.0.1/.../whep }
```

URL 只能绑定本机回环地址、无凭据、无查询串和 fragment，并且 path 必须属于指定设备。

发布目标是独立受控结果：

```text
{ kind: "whip", deviceId: string, url: http(s)://{private-lan-host}:{httpPort}/{pathPrefix}/{encodedDeviceId}/whip }
```

发布 URL 只能绑定已校验的私网 IPv4、无凭据、无查询串和 fragment；设备路径必须使用 `encodeURIComponent`。

启动、停止和播放结果的错误码固定为：`INVALID_INPUT`、`ALREADY_ACTIVE`、`HOST_UNAVAILABLE`、`MEDIA_PROCESS_FAILED`、`PATH_MONITOR_FAILED`、`NOT_RUNNING`、`UNKNOWN_DEVICE`、`VIDEO_NOT_READY`、`PLAYER_FAILED`、`EVALUATION_FAILED`、`STOP_FAILED` 和 `DISPOSED`。错误结果只带当前脱敏快照，不带适配器异常。

## 生命周期

启动顺序为：解析媒体主机 -> 启动 MediaMTX -> 启动 path 观察器。任何步骤失败都清理已经启动的资源。停止顺序为：清理播放器 -> 停止 path 观察器 -> 停止 MediaMTX；前一步失败不能阻止后续清理。`evaluate` 调用一次 path 列表 API，将发布/断开事件转换为按设备隔离的健康状态；它不创建定时器。

`publisher-ready` 只表示 MediaMTX 已观察到 WHIP 发布。`selectPlayer` 调用适配器并收到首帧后，播放器快照进入 `playing`，并把该设备健康事件记为 `first-frame-rendered`；首帧不改变 `publisher-ready`。播放器失败不得把其他设备流改为失败。

发布、断开、超时和进程退出必须按设备和监听代次隔离。旧代次事件不得恢复新会话，也不得影响其他设备。

## 验收

必须覆盖多设备隔离、启动反向清理、端口冲突、进程启动失败、路径发布/断开、健康超时、旧事件、WHEP 地址安全校验、播放器替换和回退。模块先写契约测试，再写实现。
