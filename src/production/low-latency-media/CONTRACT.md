# 低延迟媒体组合门面契约

状态：实验模块契约，先于实现生效。

## 唯一职责

`low-latency-media` 只组合已经构造好的 `WebRtcMedia` 和 `WhipStreamControl`。它为桌面应用提供一个低延迟旁路：显式启动/停止 MediaMTX、按设备启动/停止 WHIP、刷新发布路径、选择/清理 WHEP 播放器。

它不创建进程、不访问 Electron、不发送旧 RTMP 命令、不修改 `media-pipeline`，也不把手机命令成功解释成首帧成功。

## 对外接口

```text
LowLatencyMedia.create({ media, control, startInput }) -> LowLatencyMediaInstance
instance.start() -> Promise<LowLatencyResult>
instance.stop() -> Promise<LowLatencyResult>
instance.refresh(now) -> Promise<LowLatencyResult>
instance.startStream(deviceId) -> Promise<LowLatencyResult>
instance.stopStream(deviceId) -> Promise<LowLatencyResult>
instance.selectPlayer(deviceId) -> LowLatencyResult
instance.clearPlayer() -> LowLatencyResult
instance.snapshot() -> LowLatencySnapshot
instance.dispose() -> Promise<void>
```

`start()` 只启动 `WebRtcMedia`，不自动给任何手机发命令。`stop()` 固定先停止所有 `starting`、`streaming`、`stopping` 的 WHIP 设备，再停止 `WebRtcMedia`；某个设备失败不能跳过其他设备或 MediaMTX 清理。`refresh` 只委托 `WebRtcMedia.evaluate`。

快照只包含低延迟媒体快照和按设备排序的 WHIP 控制快照，不包含 WHIP/WHEP 地址、端口、进程路径、异常或凭据。处置幂等，处置后不再启动或下发命令。

## 验收

必须覆盖默认旁路缺失不影响旧应用、启动/停止顺序、批量设备停止、刷新和播放器委托、失败清理、重复调用、处置幂等以及敏感信息隔离。
