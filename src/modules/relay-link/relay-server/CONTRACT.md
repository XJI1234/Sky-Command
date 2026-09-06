# 中继链路服务器模块契约

状态：已批准实施

## 职责与接口

`relay-server` 拥有桌面侧中继手机传输生命周期：经注入适配器绑定已校验监听地址、接收连接、执行协议握手、向订阅者路由入站帧，并提供串行化出站发送接口。它是唯一知道传输连接存在的 `relay-link` 子模块。

```ts
RelayServer.create(options) -> RelayServerInstance
instance.start() -> Promise<StartResult>
instance.stop() -> Promise<void>
instance.snapshot() -> RelayServerSnapshot
instance.subscribe(listener) -> unsubscribe
instance.send(connectionId, bytes) -> Promise<SendResult>
instance.measureLink(connectionId) -> Promise<LinkProbeReport>
```

选项只含监听地址、传输适配器、单调连接 ID 工厂、会话 ID 工厂和握手超时。适配器拥有 Socket 细节，可替换为 WebSocket、Electron 或测试实现；本模块不维护设备目录、不跟踪命令、不解释遥测、不流式发任务，也不实现 WebSocket/Electron API。

## 生命周期、握手和发送

初始为无连接的 `stopped`。`start` 原子完成 `stopped -> starting -> listening`；重复启动返回 `SERVER_ALREADY_STARTED`。`stop` 关闭监听器和活动连接、发关闭事件、回到 `stopped`，可重复调用；绑定失败返回 `LISTEN_FAILED` 并恢复干净停止态；超出 `maxConnections` 的新连接直接关闭。

每连接先处于 `awaiting-hello` 并有一次握手截止时间。首帧必须是版本 `"1"` 的有效 `hello`；服务器在发送 `paired` 回复前原子预留该 `deviceId` 与新会话 ID，使重叠到达的同设备 `hello` 也会替换仍在等待回复的旧连接。回复后必须再次确认该连接仍未关闭且仍属于当前连接表，只有确认成功时才变为 `paired` 并发布配对事件；握手回复期间断开的连接不得发布配对事件。握手前其他帧、畸形字节或不支持版本都只关闭该连接并发 `protocol-error`。同一 `deviceId` 的新 `hello` 使旧连接以 `session-replaced` 关闭，新连接完成配对并获得新的 `sessionId`。配对后同一条连接再发 `hello`/`paired` 是协议错误，其他有效帧按到达顺序发一次。

每条连接以到达顺序串行处理入站字节，但最多只能等待 16 条尚未开始处理的已复制帧；正在处理的一条不计入该数。因此在协议最大帧长 96 KiB 下，一条连接持有的入站字节最多约为 1.6 MiB。第 17 条等待帧到达时，以 `inbound-overflow` 关闭该连接，不发布 `protocol-error`，不再处理已等待的帧。关闭事件沿既有根模块路径取消待命令/任务；手机依其既有连接会话策略重连。这个有界背压只保护桌面事件循环，不改变正常帧的顺序、内容或业务路由。

仅监听中且目标已配对时 `send` 才有效；它校验/复制字节、按连接排队、保持调用顺序。每条连接最多保留 16 条未完成出站帧，当前正等待传输适配器完成的一条计入该数。第 17 条到达说明本端无法在有限内存中保证操作时序：服务器以 `outbound-overflow` 结束该会话，立刻以 `NOT_CONNECTED` 结束此前尚未结算的发送等待，并让本次调用收到 `OUTBOUND_OVERFLOW`；不会保留这些帧，等待手机按现有机制重连。这与入站溢出一样是连接可靠性失败，不代表已提交给 DJI 的动作被撤销。无效帧为 `INVALID_FRAME`，未知或未握手为 `NOT_CONNECTED`，传输拒绝为 `SEND_FAILED` 并关闭连接。协议最大帧长在适配器发送前强制执行。连接关闭时，不会等待一个底层传输永不完成的发送；它只允许该单个已开始写入在后台自然结束，所有尚未开始的帧立即脱离队列并结算，避免保留任意长度的闭包链。

`measureLink` 仅用于已配对连接的非业务网络诊断。它顺序执行固定 10 次适配器级 `probeLink()`，并只返回当前 RTT、RTT 中位数、最大 RTT 和相邻样本差的平均抖动；不公开 WebSocket、PONG 载荷、连接地址或原始样本。连接未配对、适配器不支持、单次超时、关闭、会话替换，或适配器返回不符合 `RelayConnectionProbeResult` 运行时形状的数据时，返回稳定的不可测结果并带已完成样本数，绝不发送协议帧、改变连接阶段、写入遥测或影响待处理命令/任务。重复调用同一连接时必须复用同一整组在途测量，避免并发发包。

## 安全与验证

所有快照、事件、帧、字节均复制或冻结；监听器异常不影响已提交状态或其他监听器。入站字节只交给 `RelayFrameCodec.decode`，解码错误不得崩溃服务器或泄露原始内容。测试使用确定性内存适配器，覆盖启停竞争、绑定失败、连接限制、握手/超时、会话替换、畸形/未知帧、入站背压上限、关闭/传输错误、发送串行化、复制、监听器和 100% 门禁。
