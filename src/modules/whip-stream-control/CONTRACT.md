# whip-stream-control 一级模块契约

状态：实验设计，尚未实现。

## 唯一职责

`whip-stream-control` 是桌面端实验图传控制侧。它根据已经运行的 `webrtc-media` 发布端点构造 WHIP 地址，并通过注入的 Relay 命令端口发送临时的 `live-stream-webrtc.start` 和 `live-stream-webrtc.stop` 命令。

它不接收媒体、不启动 MediaMTX、不播放视频、不读取 DJI、不依赖旧 `live-stream-control`，也不把手机命令成功解释成电脑首帧成功。

## 协议

启动字段必须严格为：

```text
{ whipUrl: string }
```

停止字段必须严格为空对象。目标格式为：

```text
http://{电脑局域网主机}:{WHIP HTTP 端口}/live/{encodeURIComponent(deviceId)}/whip
```

实验命令完成只表示手机 WHIP 发布器的操作终态。媒体是否已发布、WHEP 是否已连接和首帧是否显示由 `webrtc-media` 与 `whep-playback` 分别负责。

## 验收

必须覆盖能力门禁、端点缺失、设备隔离、精确字段、命令失败/超时/断开、重复操作、旧结果和敏感信息脱敏。默认旧模式不得调用该模块。
