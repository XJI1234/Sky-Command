# Node 诊断日志存储适配器契约

## 唯一职责

`node-diagnostic-store` 只负责把已由 `relay-link` 协议核验证、已由诊断接收逻辑去重的手机端诊断批次追加到桌面本地 NDJSON 文件。它不解析 WebSocket、不验证协议、不发送确认、不调用 DJI，也不决定哪些事件应该保留。

## 接口

```ts
NodeDiagnosticStore.create(options?) -> RelayDiagnosticSink
RelayDiagnosticSink.persist({ deviceId, runId, events }) -> boolean
```

生产默认位置为 `%LOCALAPPDATA%\\Sky Command\\diagnostics\\relay-events.ndjson`；缺少 `LOCALAPPDATA` 时使用当前工作目录下的 `diagnostics/relay-events.ndjson`。测试可提供明确 `filePath`，但 `node-runtime` 不向调用方暴露路径配置。

## 行为与失败

- 每次成功 `persist` 写入一行紧凑 UTF-8 JSON，包含 `deviceId`、`runId` 和完整 `events` 批次。
- 目录不存在时必须创建；追加失败时返回 `false`，不得抛出原始路径、系统错误或事件内容。
- `persist` 返回 `true` 才表示字节已交给本地文件系统；上层随后才允许发送 `diagnostic-ack`。
- 适配器不做二次脱敏。调用方只能传入已满足协议限制的 `safeDetail`；文件不应存放 API Key、令牌、RTMP 密钥或原始异常堆栈。

## 验收

测试覆盖成功追加、目录创建、紧凑 NDJSON 格式、写入失败返回 `false`，以及连续批次的追加顺序。适配器只依赖 Node 文件系统与 `relay-link` 的公开诊断接口。
