# Node 中继生产装配契约

状态：已批准实施

## 唯一职责

`node-runtime` 是桌面端最外侧的 Node 生产工厂。它只负责把真实 `ws.WebSocketServer` 适配器、系统计时器和不透明 ID 工厂装配为一个 `relay-link` 实例。

它不启动 Electron、不创建窗口、不定义 IPC、不读取设置、不处理媒体、不解析航线、不决定设备能力、不执行 DJI 操作，也不改变 `relay-link` 的协议、会话、超时、任务传输或遥测业务规则。

## 对外接口

```ts
NodeRuntime.createRelay(options) -> RelayLinkInstance
```

调用方只提供受控监听地址与既有 `relay-link` 所需的四项限额：握手超时、最大连接数、命令超时和任务超时。所有计时器与 ID 工厂由本模块创建；调用方不能注入 Socket、定时器、文件路径、Electron 对象或业务回调。

## 行为

工厂同步返回一个尚未监听的 `RelayLinkInstance`。只有调用该实例的 `start()` 才会建立真实 WebSocket 监听。`stop()` 的幂等、连接清理、会话替换、命令超时和任务传输语义全部保持 `relay-link` 契约，不在此重复实现。

监听地址与限额不由本模块重新解释；下层拒绝时，调用方直接得到 `relay-link` 的稳定结果。生成的连接、会话和命令 ID 使用 UUID，不包含设备标识、主机、端口或其他可推断网络拓扑的信息。

## 依赖边界

本模块仅可依赖 `node:crypto`、`node-websocket-relay` 的公开工厂、`node-diagnostic-store` 的公开工厂和 `relay-link` 的公开入口。日志文件系统细节只能留在 `node-diagnostic-store`，不得导入 `relay-link` 的二级模块实现、Electron、前端框架、DJI、媒体、地图或航线。

## 验收

测试必须覆盖工厂返回的未启动状态、实际监听和停止、多个工厂实例隔离、UUID 工厂不泄露地址、架构边界以及输入类型。类型、局部覆盖率、性能和 Stryker 变异得分均为 100%。
