# stream-health 二级模块契约

状态：已批准实施

## 1. 唯一职责

`stream-health` 是桌面端每条接收视频流的健康判定器。它仅根据上层报告的接收、转码和分片事件，维护该流是否已就绪，判断等待是否超时，并产生不含敏感内容的中文诊断与“应停止转码”的动作建议。

它不监听端口、不接收 RTMP、不启动或停止 FFmpeg、不读取 HLS 文件、不创建定时器、不播放视频，也不调用手机端、中继链路或 `live-stream-control`。上层编排器负责按固定频率调用 `evaluate(now)`，并执行返回的停止建议。

## 2. 对外接口

```ts
StreamHealth.create(options) -> StreamHealthInstance
instance.begin(streamId, now) -> BeginResult
instance.observe(streamId, event, now) -> ObserveResult
instance.evaluate(now) -> HealthEvaluation
instance.stop(streamId) -> StopResult
instance.snapshot(streamId) -> StreamHealthSnapshot | null
instance.snapshots() -> readonly StreamHealthSnapshot[]
```

`streamId` 是由 `rtmp-ingest` 分配的稳定流标识，长度为 1..64 个 ASCII 小写字母、数字或连字符，且必须以字母开头。所有时刻均为有限、非负、单调不减的毫秒数。超时配置范围为 1,000..60,000 毫秒。

`begin` 创建一条等待 RTMP 输入的健康记录；同一流在未停止前重复开始会被拒绝，且不覆盖已有状态。`stop` 只移除指定流；不存在的流返回稳定拒绝，重复停止不会影响其他流。

结果码固定如下：`begin` 只能返回 `INVALID_INPUT` 或 `ALREADY_TRACKED`；`observe` 只能返回 `INVALID_INPUT`、`UNKNOWN_STREAM` 或 `STALE_EVENT`；`stop` 只能返回 `INVALID_INPUT` 或 `UNKNOWN_STREAM`；`evaluate` 的非法时刻返回 `INVALID_INPUT`。所有拒绝均不得抛出异常或改变状态。

## 3. 事件、状态与结果

事件仅允许：

| 事件 | 含义 | 合法前置状态 |
| --- | --- | --- |
| `ingest-started` | 已收到手机推入的 RTMP 字节 | `awaiting-ingest` |
| `transcoder-started` | 转码进程已启动 | `awaiting-playlist` |
| `playlist-ready` | 本地 HLS 播放列表和首个片段均已就绪 | `awaiting-playlist` |
| `transcoder-exited` | 转码进程未按用户停止而退出 | `awaiting-playlist` 或 `ready` |

快照状态只允许：`awaiting-ingest`、`awaiting-playlist`、`ready`、`failed`。状态与事件的精确关系如下：

1. `begin` 后为 `awaiting-ingest`。
2. `ingest-started` 后进入 `awaiting-playlist`；是否已报告 `transcoder-started` 不影响等待 HLS 的计时起点。
3. 只有 `playlist-ready` 才能进入 `ready`。
4. `transcoder-exited` 立即进入 `failed`，并产生一次停止建议。
5. 在 `awaiting-ingest` 超过输入超时后，进入 `failed`；在 `awaiting-playlist` 超过播放列表超时后，进入 `failed`。两种超时各只产生一次停止建议。
6. 已 `ready` 的流不会因等待超时失败；已 `failed` 的流不会被旧事件恢复。

未知流、非法事件、时间倒退、状态不允许的事件和已失败流上的事件，都返回 `ignored`，不改变快照，不产生停止建议，也不抛出异常。

`evaluate(now)` 返回每条刚刚失败流的一项停止建议；同一失败不重复建议。返回项以 `streamId` 字典序排序，保证 UI、日志和测试结果稳定。

## 4. 诊断与数据安全

快照只包含 `streamId`、修订号、状态、最近事件时间和公开诊断；不包含 RTMP 地址、查询参数、令牌、密码、文件路径、原始异常、FFmpeg 参数或设备对象。

诊断固定为：

| 失败原因 | 诊断文本 |
| --- | --- |
| 未在输入超时内收到推流 | `未收到手机端 RTMP 推流。请确认手机已开始图传，且电脑地址可从局域网访问。` |
| 收到推流后播放列表未就绪 | `已收到 RTMP 推流，但转码或本地分片未就绪。请检查转码器和磁盘写入。` |
| 转码进程异常退出 | `转码进程异常结束。请检查 FFmpeg 与输入流。` |

每个公开结果、快照、列表与停止建议均为冻结副本。实例必须支持多条流并行，任何一条流的事件或失败都不得改变其他流。

## 5. 依赖与验收

本模块是纯 TypeScript 核心模块，只能依赖语言标准能力；不得导入 Node、Electron、FFmpeg、网络库、文件系统、UI 框架、其他一级模块或 `media-pipeline` 的其他二级实现。

测试必须覆盖：全部合法状态转换、输入超时、播放列表超时、异常退出、重复评估、重复开始/停止、非法值、时间倒退、未知与过期事件、至少两条流的隔离、结果排序、冻结副本和诊断不泄露敏感输入。行、分支、函数与变异测试覆盖率均为 100%。
