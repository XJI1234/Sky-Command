# 中继链路一级模块契约

状态：已批准实施

## 职责

`relay-link` 是桌面应用与 Android 中继手机之间唯一的通信边界。它接收中继会话、解码/校验帧、跟踪已连接设备、发送命令和任务字节，并发布已验证遥测。飞行、航线、媒体、UI 模块不得导入 WebSocket 或传输库。

| 子模块 | 唯一职责 |
| --- | --- |
| `protocol-core` | 纯帧模型、严格 UTF-8 JSON 编解码、字段/上限校验 |
| `relay-server` | 校验地址监听与 WebSocket 生命周期 |
| `device-registry` | 不可变设备/会话快照与移除语义 |
| `command-tracker` | 命令 ID 关联、截止时间和断线取消 |
| `telemetry-intake` | 已验证遥测接收及只读最新快照 |
| `mission-sender` | 合格 KMZ 的 begin/chunk/complete 发送及结果关联 |

每个子模块只有一个公开接口，只能依赖更早的子接口或根契约指定设置，不导入 UI，也不承担其他子模块职责。

## 根接口

```ts
RelayLink.create(options) -> RelayLinkInstance
instance.start() -> Promise<StartResult>
instance.stop() -> Promise<void>
instance.devices() -> readonly RelayDeviceSnapshot[]
instance.sendCommand(deviceId, request) -> Promise<CommandOutcome>
instance.sendMission(deviceId, payload) -> Promise<MissionOutcome>
instance.latestTelemetry(deviceId) -> TelemetrySnapshot | null
instance.ingressAddress(deviceId) -> string | null
instance.subscribe(listener) -> unsubscribe
```

调用方只提供已配对 `deviceId`，从不操作 Socket/连接 ID。`ingressAddress` 仅供同进程受控媒体命令选择回传地址；它不出现在设备、遥测或订阅快照，UI 不得调用它。根模块创建并拥有所有子模块，调用方不能直接修改其状态或订阅传输事件。选项只接收可替换传输、计时器、已校验监听地址、生命周期限制和不透明 ID 工厂，禁止直接传入 WebSocket、Android、Electron、文件路径、DJI、UI 回调或可变子模块。

## 状态、路由与结果

快照包含监听状态/端点、仅 `{ deviceId, sessionId }` 的配对设备、最新遥测，以及待处理命令/任务到设备的映射。每份公开遥测必须同时带有它所属的 `sessionId`，该值只能来自当前注册的连接；它让同进程生产适配器拒绝同一 `deviceId` 旧会话的残留遥测，绝不向 UI、业务端口、命令结果或日志转发。每份遥测还包含仅由本机记录的 `receivedAtMs: number | null`，即桌面成功验证该帧的接收时刻；它只供上层展示事实的新鲜度，绝不参与协议、DJI 调用或控制门禁。`subscribe` 不回放虚构初始事件；在服务状态变化、配对、连接移除、接受遥测、命令/任务完成后发布一份新快照。监听器异常和重入不能回滚提交状态；启动前或停止后 `devices`/`latestTelemetry` 均安全。

配对时原子登记设备；连接关闭时删除设备和遥测，取消该连接全部待处理命令/任务。`send-failed` 与对端关闭、替换会话、传输错误相同：等待中的命令标为 `disconnected`，等待中的任务立即结束，不得保持 pending 或伪装成功。桌面结束等待只表示本端不再等待结果，不表示飞机上的 DJI 操作已经停下。手机新连接必须重新 hello/paired。入站遥测、命令结果、任务结果只路由给各自子模块；未知但有效业务帧忽略以支持前向兼容。畸形帧由服务器隔离，根监听器绝不见到原始字节或协议异常。

目标设备不存在、ID 生成无效、无法构造协议帧或子模块拒绝时，发送不产生传输效果。命令只在匹配结果、超时、断线或发送失败后完成；任务只在匹配 `mission-result`、超时、断线或传输失败后完成，KMZ 分块发送完毕不是任务成功。`telemetry.read` 是一次性遥测刷新，由 `sendCommand` 下发空字段；成功只表示手机已发布当前快照，不表示 SDK、遥控或飞机已就绪。结果仅含 `deviceId`、请求/生成 ID、状态和有界详情，绝不含连接 ID、原始字节、路径或 Socket 错误。

## 边界、兼容和验证

`stop` 幂等，先关闭服务连接以走正常取消/移除路径，再发布最终停止快照；绑定失败后可重新启动且不虚构设备或待处理项。根模块只可导入六个子接口与语言标准库，不得导入 WebSocket、Electron、Node 网络/文件系统、Android、DJI、航线库或 UI；它不解析、序列化、记录或存储原始帧。

协议与 `MSDK-relay/relay-gateway/protocol-core` 线兼容，版本为 `"1"`。不可信网络字节不得穿过公共接口抛异常；帧解析前先限长，严格 UTF-8，拒绝重复键、尾随 JSON、控制字符、路径穿越、不安全 Base64、过度嵌套和资源耗尽；错误不回显载荷或密钥，所有外部对象/字节均复制或冻结。

每个子模块必须先有中文契约，再有实现和测试，并具备契约、架构、类型、边界/属性、性能和变异测试。完整模块必须通过类型、覆盖率、性能、审计和变异门禁后才能开始依赖它的一级模块。
