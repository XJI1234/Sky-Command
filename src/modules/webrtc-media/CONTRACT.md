# webrtc-media 一级模块契约

状态：实验设计，尚未实现。

## 唯一职责

`webrtc-media` 是桌面端低延迟媒体组合根。它管理 MediaMTX 的生命周期，按设备观察发布路径，维护媒体健康状态，并为已经发布的设备生成受控的本机 WHEP 播放目标。

它不向手机发送图传命令，不实现 DJI，不创建 WebSocket，不读取 Electron 或 UI 全局对象，不转码、不保存视频，也不依赖旧的 `media-pipeline`、FFmpeg、HLS 或 Node RTMP 实现。

## 公开接口

```text
WebRtcMedia.create(dependencies, options) -> WebRtcMediaInstance

instance.start(input) -> MediaResult<MediaSnapshot>
instance.stop() -> MediaResult<MediaSnapshot>
instance.evaluate(now) -> MediaResult<MediaSnapshot>
instance.playback(deviceId) -> MediaResult<PlaybackTarget>
instance.selectPlayer(deviceId) -> MediaResult<MediaSnapshot>
instance.clearPlayer() -> MediaResult<MediaSnapshot>
instance.snapshot() -> MediaSnapshot
instance.dispose() -> Unit
```

`start` 只接受局域网网卡事实、实验 HTTP/UDP 端口、MediaMTX 候选和可选手工主机。端口、进程路径、原始 WHIP/WHEP 地址和异常不得进入公开快照。

## 状态

组合根状态为 `idle`、`starting`、`running`、`stopping`、`failed`、`disposed`。每条设备流状态为 `awaiting-publisher`、`publisher-ready`、`failed`。`publisher-ready` 只表示 MediaMTX 已观察到该设备发布，不能表示浏览器已经显示首帧。

播放目标是独立受控结果：

```text
{ kind: "whep", deviceId: string, url: http(s)://127.0.0.1/.../whep }
```

URL 只能绑定本机回环地址、无凭据、无查询串和 fragment，并且 path 必须属于指定设备。

## 生命周期

启动顺序为：解析媒体主机 -> 定位 MediaMTX -> 启动 MediaMTX -> 启动 path 观察器。任何步骤失败都清理已经启动的资源。停止顺序为：清理播放器 -> 停止 path 观察器 -> 停止 MediaMTX；前一步失败不能阻止后续清理。

发布、断开、超时和进程退出必须按设备和监听代次隔离。旧代次事件不得恢复新会话，也不得影响其他设备。

## 验收

必须覆盖多设备隔离、启动反向清理、端口冲突、进程启动失败、路径发布/断开、健康超时、旧事件、WHEP 地址安全校验、播放器替换和回退。模块先写契约测试，再写实现。
