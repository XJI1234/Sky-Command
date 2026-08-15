# 中继链路协议核心模块契约

状态：已批准实施

## 职责与接口

`protocol-core` 是 Sky Command 桌面端与 MSDK relay 共用的纯确定性协议边界。它建模中继帧、校验字段、把有效帧编码为紧凑 UTF-8 JSON，并解码一条严格 UTF-8 JSON 帧；它没有网络、WebSocket、Electron、文件系统、DJI、航线、任务、遥测或 UI 依赖。

```ts
validate(frame: RelayFrame): ProtocolResult<RelayFrame>;
validateJsonObject(value: unknown): ProtocolResult<JsonObject>;
RelayFrameCodec.encode(frame: RelayFrame): ProtocolResult<Uint8Array>;
RelayFrameCodec.decode(bytes: Uint8Array): DecodeResult;
```

公开冻结帧模型与 Android 协议一致：`hello`、`paired`、`telemetry`、`command`、`command-result`、`mission-begin`、`mission-chunk`、`mission-complete`、`mission-result`。`JsonNumber` 保留数字文本，避免转发遥测或命令字段时丢失精度。未知但结构良好的 `type` 返回 `Ignored`，不是错误；错误只含稳定代码和安全消息，不回显输入。

`validateJsonObject` 是嵌入式结构化数据的唯一公开验证入口。它接受 `unknown`，仅在值是符合本模块 JSON 限制的 `kind: "object"` 时返回深拷贝且冻结的 `JsonObject`；标量和数组返回 `INVALID_FIELD`，畸形、超限或不可读取数据返回相应协议错误。它不读取、生成或要求任何中继帧字段。

## 线协议与限制

帧为紧凑 JSON、严格 UTF-8，字段名/顺序与 Kotlin 编解码器兼容。任务块采用有填充且无空白的标准 Base64，解码字节必须复制。

协议版本为 `"1"`；最大帧 96 KiB，嵌套 32 层，令牌 8192，数字长度 128，JSON 字符串 65,536 码点，字段名/ID 128，类型 64，命令名 64，文件名 128，结果详情 1024，任务 1..100 MiB，任务块 1..48 KiB，SHA-256 为 64 位小写十六进制。ID 不得为空或含控制符；KMZ 文件名不得含路径穿越、斜杠或控制符；命令字段必须是对象且不得含保留 `name`；遥测字段必须是 JSON 对象。

## 失败与验证

对象拒绝重复键、尾随 token、非有限数、不安全字段名和不支持值。`encode` 拒绝无效/超限帧；`decode` 拒绝空/超限、畸形 UTF-8/JSON、非对象根、已知帧字段错误、Base64 错误及所有资源超限；面对恶意 getter 也不得抛异常。所有帧、嵌套 JSON、字节、结果、错误均复制或冻结，输入不变。

测试仅穿过该接口，覆盖所有帧往返、全部边界、畸形输入、严格 UTF-8、资源限制、Base64 规范、复制/不可变、未知消息、恶意 getter和错误保密；所有覆盖率和变异门禁必须为 100%。
