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
```

选项只含监听地址、传输适配器、单调连接 ID 工厂、会话 ID 工厂和握手超时。适配器拥有 Socket 细节，可替换为 WebSocket、Electron 或测试实现；本模块不维护设备目录、不跟踪命令、不解释遥测、不流式发任务，也不实现 WebSocket/Electron API。

## 生命周期、握手和发送

初始为无连接的 `stopped`。`start` 原子完成 `stopped -> starting -> listening`；重复启动返回 `SERVER_ALREADY_STARTED`。`stop` 关闭监听器和活动连接、发关闭事件、回到 `stopped`，可重复调用；绑定失败返回 `LISTEN_FAILED` 并恢复干净停止态；超出 `maxConnections` 的新连接直接关闭。

每连接先处于 `awaiting-hello` 并有一次握手截止时间。首帧必须是版本 `"1"` 的有效 `hello`；成功时生成会话 ID、恰发一帧 `paired`、变为 `paired` 并发布事件。握手前其他帧、畸形字节或不支持版本都只关闭该连接并发 `protocol-error`。同一 `deviceId` 的新 `hello` 使旧连接以 `session-replaced` 关闭，新连接完成配对并获得新的 `sessionId`。配对后同一条连接再发 `hello`/`paired` 是协议错误，其他有效帧按到达顺序发一次。

仅监听中且目标已配对时 `send` 才有效；它校验/复制字节、按连接排队、保持调用顺序。无效帧为 `INVALID_FRAME`，未知或未握手为 `NOT_CONNECTED`，传输拒绝为 `SEND_FAILED` 并关闭连接。协议最大帧长在适配器发送前强制执行。

## 安全与验证

所有快照、事件、帧、字节均复制或冻结；监听器异常不影响已提交状态或其他监听器。入站字节只交给 `RelayFrameCodec.decode`，解码错误不得崩溃服务器或泄露原始内容。测试使用确定性内存适配器，覆盖启停竞争、绑定失败、连接限制、握手/超时、会话替换、畸形/未知帧、关闭/传输错误、发送串行化、复制、监听器和 100% 门禁。
