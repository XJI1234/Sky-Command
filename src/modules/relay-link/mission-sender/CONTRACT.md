# 中继链路航线发送模块契约

状态：已批准实施

## 职责与接口

`mission-sender` 经注入的协议帧写入端发送一份已合格的 KMZ 字节，并等待匹配的手机 `mission-result`。它拥有分块顺序、大小/摘要校验、传输截止时间以及“传输完成”和“手机端航线结果”之间的区别。

```ts
MissionSender.create(options) -> MissionSenderInstance
instance.send(connectionId, mission, sink) -> Promise<MissionOutcome>
instance.acceptResult(connectionId, result) -> void
instance.cancelConnection(connectionId, reason) -> void
instance.snapshot() -> readonly PendingMission[]
instance.subscribe(listener) -> unsubscribe
```

它不读取文件、不校验 KML/WPML、不建 Socket、不调用 DJI，也不决定航线能否飞行。调用方提供脱离引用的 KMZ，写入端是唯一出站效果。

## 规则和安全

发送严格依次输出 `mission-begin`、不超过 48 KiB 的 `mission-chunk` 和 `mission-complete`；只在匹配结果、超时或取消时完成。帧发送成功仍是待确认，不等于 DJI 任务成功。每连接只允许一个待处理任务；重复任务 ID 或活动连接返回拒绝且不发帧。异步前复制所有字节。

结果状态为 `succeeded`、`rejected`、`timed-out`、`disconnected`、`transport-failed`。大小、SHA-256 小写摘要、文件名均须符合 `protocol-core`；失败不发部分任务且不遗留待处理项；写入端失败立即转为 `transport-failed`。快照、结果、帧、字节均冻结或复制，监听器异常隔离。测试覆盖块边界、摘要、顺序、超时、断线、写入失败、恶意结果和 100% 门禁。
