# media-pipeline 一级模块契约

状态：已批准实施

## 组合根公开接口

```ts
MediaPipeline.create(dependencies, options) -> MediaPipelineInstance

instance.start(input) -> PipelineResult<MediaSnapshot>
instance.stop() -> PipelineResult<MediaSnapshot>
instance.evaluate(now) -> PipelineResult<MediaSnapshot>
instance.notifyPlaylistReady(deviceId) -> PipelineResult<MediaSnapshot>
instance.selectPlayer(deviceId) -> PipelineResult<MediaSnapshot>
instance.clearPlayer() -> PipelineResult<MediaSnapshot>
instance.snapshot() -> MediaSnapshot
```

`start` 的输入只包含局域网网卡事实、可选手工 IPv4、HLS 根目录和按优先级排列的 FFmpeg 候选；RTMP 与 HLS 监听端口、健康超时和适配器均在 `create` 时注入。`processFactory()` 每次发布都返回一份新的单进程适配器，避免多个设备共享可变进程状态。组合根不读取系统环境或 UI 全局对象。`notifyPlaylistReady` 是 HLS 适配器确认首个播放列表可读后的唯一事实入口。

组合根状态为 `idle`、`starting`、`running`、`stopping`、`failed`、`disposed`。`snapshot` 只公开接收端点的 host/port/source、每台设备的 deviceId/streamId/健康阶段/播放地址/安全诊断，以及播放器快照；不公开 FFmpeg 路径、HLS 根目录、RTMP 完整输入地址、原始异常或进程参数。每次返回均为冻结副本。

启动顺序固定为：解析局域网端点、定位 FFmpeg、启动 HLS、启动 RTMP。任一步失败都停止已经启动的后续服务并清空流状态；停止顺序固定为播放器清理、RTMP、HLS，并且即使前一步失败也继续执行其余清理。组合根显式保留每项服务是否仍在监听的事实；若停止失败，实例维持 `failed`，必须再次 `stop` 完成残留清理后才能再次 `start`。正在运行的每条流互相隔离；RTMP 发布/结束和转码退出回调只影响对应设备。`evaluate` 将健康模块产生的停止建议交给对应转码实例，旧代次回调和迟到设备事件必须被忽略。

## 唯一职责

`media-pipeline` 是桌面端从手机 RTMP 图传到本地播放器的唯一接收链路：提供局域网接收端点、接收并标识各设备的流、管理转码与 HLS 分发、判定视频健康状态，并向界面提供可播放的本地地址和安全诊断。

它不向手机下发直播开关命令、不实现设备连接或 DJI 操作、不管理航线或飞行控制、不保存媒体文件、不截图、不读取 UI 框架或 Electron 全局对象。手机端 `live-stream` 只根据 `live-stream-control` 下发的 RTMP 地址推流；电脑端 `media-pipeline` 永远不反向调用控制侧。

## 二级模块与依赖

| 二级模块 | 唯一职责 | 允许依赖 |
| --- | --- | --- |
| `network-endpoint` | 枚举安全局域网地址并生成接收端点 | 注入的网卡事实 |
| `rtmp-ingest` | 接收推流并将其分配为稳定 `streamId` | 注入的 RTMP 服务适配器 |
| `ffmpeg-locator` | 定位可用转码器并报告缺失原因 | 注入的路径与文件事实 |
| `transcode-runner` | 生命周期化管理单条转码进程 | 注入的子进程适配器 |
| `hls-server` | 生命周期化分发本地 HLS 片段 | 注入的 HTTP 服务适配器 |
| `stream-health` | 判定就绪、超时和停止建议 | 无外部依赖 |
| `video-player` | 将可播放地址交给 UI 播放器并分类致命错误 | `media-pipeline` 公开只读接口 |

`stream-health` 先于所有 I/O 二级模块实现。`transcode-runner`、`hls-server` 和 `rtmp-ingest` 只能向其报告事实；它们不得自行解释就绪或超时。`video-player` 是本模块唯一工作区层，绝不启动或停止服务进程。

## 对外接口与所有权

一级入口后续只暴露一个组合根：由组合根拥有各适配器和每条流的编排状态。其他一级模块只能读取“接收端点、流快照、播放地址和安全诊断”，不能导入任何二级实现、FFmpeg 参数、HLS 文件路径或 RTMP 服务对象。

所有状态以内部 `streamId` 和关联的设备标识隔离。`streamId` 由组合根按 `stream-N` 分配，绝不直接使用设备标识，以防带有路径字符的设备标识进入 HLS 目录。一个设备流的接收失败、转码失败、停止或超时不得影响其他设备的图传。公开快照、地址列表、播放描述和错误均为冻结副本，且不得泄露 RTMP 凭据、令牌、查询参数、原始异常、进程参数或本机敏感路径。

## 验收

每个二级模块必须先有中文 `CONTRACT.md`，再有实现与契约测试；模块内所有公开行为只从该二级模块入口测试。一级组合测试覆盖多流隔离、启动与反向清理、任一步失败、设备断开、超时停止和播放器恢复。行、分支、函数与变异测试覆盖率均为 100%。
