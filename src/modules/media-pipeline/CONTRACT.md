# media-pipeline 一级模块契约

状态：已批准实施

## 组合根公开接口

```ts
MediaPipeline.create(dependencies, options) -> MediaPipelineInstance

instance.start(input) -> PipelineResult<MediaSnapshot>
instance.stop() -> PipelineResult<MediaSnapshot>
instance.evaluate(now) -> PipelineResult<MediaSnapshot>
instance.notifyPlaybackReady(deviceId) -> PipelineResult<MediaSnapshot>
instance.selectPlayer(deviceId) -> PipelineResult<MediaSnapshot>
instance.clearPlayer() -> PipelineResult<MediaSnapshot>
instance.invalidateStreamSource(deviceId) -> PipelineResult<MediaSnapshot>
instance.allowStreamSource(deviceId) -> PipelineResult<MediaSnapshot>
instance.snapshot() -> MediaSnapshot
```

`start` 的输入只包含局域网网卡事实、可选手工 IPv4，以及 HTTP 分发根目录（历史字段名 `httpFlvRootDirectory`）。`ffmpegCandidates` 可选且生产路径忽略。RTMP 与 HTTP-FLV 监听端口、健康超时和适配器均在 `create` 时注入。可选 `resolveEndpointHost` 仅为后续控制命令提供当前合法私网 IPv4；它不得重新监听端口、停止接收或移除既有流。`fileFacts` / `processFactory` 为兼容旧装配的可选字段，生产组合根不定位 FFmpeg、不启动转码进程。

组合根状态为 `idle`、`starting`、`running`、`stopping`、`failed`、`disposed`。`snapshot` 只公开接收端点的 host/port/source、每台设备的 deviceId/streamId/健康阶段/播放地址/安全诊断，以及播放器快照。

启动顺序固定为：解析局域网端点、启动 HTTP-FLV 分发、启动 RTMP。任一步失败都停止已经启动的服务并清空流状态。RTMP 发布后立即标记该设备 `ready`，播放地址为 `http://127.0.0.1:{httpFlvPort}/live/{deviceId}.flv`。`notifyPlaybackReady` 保留为幂等补标入口（例如测试或迟到回调），不得再假装依赖 HLS 播放列表写出。

`invalidateStreamSource(deviceId)` 是工作流在手机 MSDK 明确报告 AirLink 或主相机不再 `CONNECTED` 时调用的本地失效入口：它只移除该设备媒体记录；若当前播放器选中了该设备，立即清空播放器。它绝不停止共享 RTMP/HTTP-FLV 服务，也不影响其他设备。失效设备即使还有旧 RTMP publish 也不得被 `evaluate()` 自动重新加入。只有桌面已收到一次新的、操作者手动请求且手机已确认成功的 `live-stream.start` 后，工作流才能调用 `allowStreamSource(deviceId)` 解除屏蔽；该方法不选择播放器、不发送命令、不自动启动图传。

## 唯一职责

`media-pipeline` 是桌面端从手机 RTMP 图传到本地 HTTP-FLV 播放地址的唯一接收链路：提供局域网接收端点、接收并标识各设备的流、判定视频健康状态，并向界面提供可播放的本地地址和安全诊断。

它不向手机下发直播开关命令、不实现设备连接或 DJI 操作、不管理航线或飞行控制、不保存媒体文件、不截图、不读取 UI 框架或 Electron 全局对象。SEI 过滤在 electron-host HTTP-FLV 适配器内完成。

## 二级模块与依赖

| 二级模块 | 唯一职责 | 生产是否负载 |
| --- | --- | --- |
| `network-endpoint` | 枚举安全局域网地址并生成接收端点 | 是 |
| `rtmp-ingest` | 接收推流并将其分配为稳定 `streamId` | 是 |
| `http-flv-server` | 生命周期化本机 HTTP 分发（生产为 HTTP-FLV） | 是 |
| `stream-health` | 判定就绪、超时和停止建议 | 是 |
| `video-player` | 将可播放地址交给 UI 播放器并分类致命错误 | 可选（生产渲染器用 gateway） |
| `ffmpeg-locator` | 定位 FFmpeg | 封存，生产不调用 |
| `transcode-runner` | 转码进程生命周期 | 封存，生产不调用 |

## 验收

公开行为由契约测试覆盖：无 FFmpeg 可启动、publish 后立即 ready、多流隔离、停止反向清理。
