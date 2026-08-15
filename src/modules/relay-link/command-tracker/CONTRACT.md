# 中继链路命令跟踪模块契约

状态：已批准实施

## 职责与接口

`command-tracker` 将一个出站命令 ID 与一条已配对连接关联，直至匹配结果、超时或断线。它不拥有传输、不理解命令业务含义；只保证每个命令恰有一个终态，过期结果不能完成较新的命令。

```ts
CommandTracker.create(options) -> CommandTrackerInstance
instance.begin(input) -> TrackerResult<PendingCommand>
instance.resolve(input) -> TrackerResult<CommandOutcome>
instance.cancelConnection(connectionId, reason) -> void
instance.snapshot() -> readonly PendingCommand[]
instance.subscribe(listener) -> unsubscribe
```

调度器由调用方注入，模块不直接创建定时器、读取时钟、发帧或调用传输适配器。

## 规则和安全

`begin` 仅接受有界非空连接/命令 ID；重复对返回 `DUPLICATE_COMMAND`，不改变既有截止时间。每个成功命令只注册一个截止任务。`resolve` 只接受当前待处理的精确连接/命令对，其他情况为 `COMMAND_NOT_FOUND` 或 `STALE_CONNECTION`；成功时取消截止、删除待处理项、发布一次结果。

截止产生一次 `timed-out`；`cancelConnection` 按原始开始顺序为该连接的每个命令发布一次 `disconnected`，重复取消无操作。快照、结果和错误是冻结副本；失败不改状态；监听器异常隔离且可重入。本模块不关心命令是飞行、相机、媒体还是航线，必须可复用于未来命令名。测试覆盖成功/拒绝、重复/过期 ID、超时、断线、顺序、恶意值与 100% 门禁。
