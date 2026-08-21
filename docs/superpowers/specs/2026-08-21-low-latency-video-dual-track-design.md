# 低延迟图传双轨实验设计

状态：契约阶段，尚未进入实现。

## 目标

在不改变现有 RTMP -> FFmpeg -> HLS 图传链路行为的前提下，增加一条可独立启动、验证和回退的低延迟视频链路：

```text
飞机 -> DJI CameraStream H.264 -> 手机 WHIP -> MediaMTX -> WHEP -> Electron WebRTC
```

默认模式继续使用旧链路。实验模式只通过桌面和手机组合根选择新模块。实验失败时，停掉实验会话并切回旧模式，不删除或修改旧模块状态。

## 非目标

- 不改飞控、航线、遥测、配对和 Relay v1 帧协议。
- 不让手机同时运行 `LiveStreamManager` 和 `CameraStream`。
- 不把视频帧塞进 WebSocket 命令通道。
- 不在第一阶段增加手机本地预览、录像或音频。
- 不在实验验证前删除 FFmpeg、HLS 或现有 RTMP 模块。

## 双轨选择

选择由组合根注入，不由领域模块读取环境变量或全局状态：

```text
legacy: 现有 MediaPipeline + LiveStreamControl
whip:   WebRtcMedia + WhipStreamControl
```

桌面默认值为 `legacy`。手机 APK 同时装配旧 `LiveStream` 和新 `WhipStream`，但同一设备同一时刻只能有一个活动图传会话。

实验模式使用独立命令名 `live-stream-webrtc.start` 和 `live-stream-webrtc.stop`，启动字段严格为 `{ whipUrl: string }`。旧 `live-stream.start` 的 `{ rtmpUrl: string }` 契约不变。新链路验收通过后，才另行设计正式协议迁移。

## 网络与路径

新链路的 WHIP 和 WHEP 使用同一 HTTP 媒体端口，WebRTC 媒体使用独立 UDP 端口。端口由桌面组合根注入，不得占用旧的 Relay `8080`、RTMP `19500` 或 HLS `18080`。实验默认建议使用 HTTP `18889`、UDP `18890`，实际运行前仍需做端口可用性检查。

每个设备使用同一条 MediaMTX path：

```text
/live/{encodeURIComponent(deviceId)}
/live/{encodeURIComponent(deviceId)}/whip
/live/{encodeURIComponent(deviceId)}/whep
```

手机发布地址只返回 WHIP 地址。窗口只获得经过本机地址和路径校验的 WHEP 播放目标，不获得手机地址、凭据、进程参数或原始异常。

## 状态事实

以下事实必须分开：

1. `command-accepted`：手机命令已被接收。
2. `dji-source-ready`：DJI CameraStream 开始回调编码帧。
3. `publisher-ready`：手机 WHIP 会话已发布到 MediaMTX。
4. `first-frame-rendered`：Electron WebRTC 播放器已显示首帧。

任何一个事实都不能代替另一个事实。命令成功不能直接把电脑视频标记为可播放。

## 编码帧规则

- 实验发布器只接受 H.264，H.265 必须以稳定错误拒绝。
- 帧必须包含有效的字节范围、宽高、单调递增的 PTS、关键帧标记和必要的 SPS/PPS 信息。
- DJI 回调线程不得等待网络发送。
- 发布器拥塞时可以丢弃非关键帧，但必须保留最近关键帧及其解码参数。
- 停止或源断开后，迟到帧不得重新建立发布会话。

## 延迟验收

延迟分为“命令到首帧”和“玻璃到玻璃稳态延迟”，两者都要记录 P50/P95：

- 实验桌面链路首帧目标：不超过 3 秒。
- CameraStream + WHIP 稳态目标：P95 不超过 1.5 秒。
- 0.5 秒只作为理想局域网目标，不作为未实机验证的保证。
- 必须分别记录正常局域网、持续丢包、短时断网恢复和重复启停结果。

## 回退

旧链路的默认端口、命令字段、模块和状态机保持原样。新链路任一组合失败时：

1. 停止新发布器和 MediaMTX 会话。
2. 清除新链路的设备状态和播放会话。
3. 选择 `legacy` 组合根。
4. 重新发送旧 `live-stream.start`，不得复用 WHIP 地址。

删除旧链路必须是验收后的独立变更，不与实验实现绑定。

## 实施门槛

每个新模块先有中文 `CONTRACT.md` 和契约测试，再写实现。纯模块不得导入 Android、DJI、Electron、Node 或具体网络库；平台适配器只能通过公开端口接入。实现阶段遵循测试先行，先观察失败，再写最小实现。
