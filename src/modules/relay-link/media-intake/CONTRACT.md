# 中继链路媒体接收模块契约

状态：已实现
所属一级模块：`relay-link`

## 职责与接口

`media-intake` 接收手机发来的 `media-begin` / `media-chunk` / `media-complete`，校验分块顺序、声明大小和 SHA-256，并把完整原图交给注入的 `MediaSink`。它是航线 `mission-sender` 的反方向：手机发送、电脑接收并回复 `media-result`。

```ts
MediaIntake.create(options) -> MediaIntakeInstance
instance.accept(connectionId, frame) -> void
instance.cancelConnection(connectionId, reason) -> void
```

它不写最终照片目录（那是 `photo-inbox`）、不发送拍照命令、不建 Socket、不调用 DJI。写入端是唯一出站效果：匹配终态时发送一次 `media-result`。每一个 `MediaSink.begin/append/complete/abort` 调用都必须带入站 `connectionId`；sink 不得依赖调用方维护的“当前连接”全局变量。这样多个已配对手机的传输可以交错，且完成文件只能落到发起该连接对应的设备。

`MediaTransfer` 是尚未聚合字节的传输身份（`transferId`、安全基名、大小、SHA-256）；`MediaFile` 在其基础上增加完整字节。`begin` 只接收前者，`complete` 才接收后者。

## 规则和安全

每个已配对连接同一时刻最多一个活动接收。`begin` 在 sink 接受后才成为活动传输；同 ID 二次 begin 保持现有传输并回复失败；不同 ID 的新 begin 先中止旧传输并回复 `TRANSFER_SUPERSEDED`。无活动传输的 chunk/complete 回复 `TRANSFER_NOT_ACTIVE`。complete 时累计字节必须恰好等于声明大小，并核对该连接上实际追加字节的小写 SHA-256。

分块原始上限 256 KiB，文件上限 100 MiB，文件名规则与双方 `protocol-core` 的媒体基名一致。协议层已校验的帧本模块不再重复 JSON 解析。`MediaSink` 拒绝细节不得发回手机。成功 `media-result.ok=true` 的 `detail` 只含固定短句；结构化身份由桌面收件箱持有，不回显路径。

SHA-256 在每个分块到达时增量更新，complete 不得重新对整张原图同步计算摘要。累计数据超过声明大小立即拒绝。MediaSink.complete 允许返回 Promise；保存完成前不回复成功，也不阻塞其它协议帧。等待异步保存时重复 complete 忽略；断线或替换后迟到的保存结果不得发送旧媒体回执。保存拒绝、异常或 Promise 拒绝均回复失败。

断线必须 abort sink、不发成功结果。入站媒体分块是业务帧：超过 `relay-server` 等待上限时按普通溢出关闭会话，不得像 `diagnostic-report` 那样丢帧保活。

结果状态为 `succeeded`、`rejected`、`disconnected`、`transfer-failed`。快照、帧、字节均冻结或复制。测试覆盖完整往返、边界分块、摘要失败、替换、断线和恶意文件名。
