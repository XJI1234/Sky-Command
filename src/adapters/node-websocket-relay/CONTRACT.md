# Node WebSocket 中继传输适配器契约

状态：已批准实施

## 职责与接口

`node-websocket-relay` 仅把 Node WebSocket 服务器适配为 `relay-link/relay-server` 拥有的 `RelayTransport` 接口：创建监听器、把每个已接受 WebSocket 转为 `RelayConnection`，并转译二进制消息、关闭和错误回调，不解释任何中继协议帧。

```ts
NodeWebSocketRelayTransport.create(options) -> RelayTransport
```

选项注入 `WebSocketServerFactory`；生产层用 `ws.WebSocketServer` 的薄包装，测试用内存服务器。因此 WebSocket 库停留在最外层，全部中继业务逻辑可独立测试。适配器不解析 JSON、不配对、不跟踪设备、不重连、不生成 ID、不保存遥测、不调用 Electron/DJI，也不读写文件。

## 行为

`listen({host, port}, onConnection)` 仅在服务器报告监听后成功；绑定/启动失败返回稳定适配器错误。生产 `WebSocketServer` 只接受路径 `/relay`。监听器 `close` 幂等，并在停止接收连接后完成。

每个客户端成为一个 `RelayConnection`：二进制数据复制为新的 `Uint8Array` 后才通知消息监听器；文本帧立即关闭连接，绝不被当作 UTF-8 协议输入。`send(bytes)` 复制后发送二进制帧，Socket 未打开或库报错时拒绝。`close` 幂等，只请求一次正常关闭；任意顺序的回调最多触发一次关闭通知。三类监听器均返回幂等退订函数，监听器异常不得影响清理或其他监听器。已打开的套接字必须按固定间隔发送 WebSocket ping；连续两次未收到 pong 时按 `peer-closed` 关闭，避免半死连接继续显示“手机已连接”。

适配器不缓存应用数据、不重试发送、不施加中继协议限制；这些由 `relay-server` 和 `protocol-core` 负责。

## 安全与验证

服务器/Socket 回调均隔离。外部错误只映射为 `transport-error`、`peer-closed`、`server-closed` 等短稳定原因，绝不泄露 URL、载荷、堆栈或库错误消息。连接/监听器句柄不泄露可变 WebSocket 对象；监听器关闭会关闭全部已接受连接并清除回调。

测试覆盖绑定、二进制复制、文本拒绝、发送、关闭/错误竞态、幂等清理、监听器隔离和多连接。架构测试禁止导入 relay-link 内部实现、Electron、DJI、Android、文件系统、航线库和 UI；必须参与类型、覆盖率、性能、审计和变异检查。
