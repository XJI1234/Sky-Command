# 中继链路遥测接收模块契约

状态：已批准实施

## 职责与接口

`telemetry-intake` 仅保存每条已配对中继连接的最新已验证遥测快照，原子替换旧值并发布不可变变更。它不解码传输字节、不解释电量/GPS/相机字段、不判断飞机可用性、不保存历史，也不渲染界面；`payload` 与 `capabilities` 对消费者是协议 JSON。

```ts
TelemetryIntake.create() -> TelemetryIntakeInstance
instance.accept(input) -> TelemetryResult<TelemetrySnapshot>
instance.get(connectionId) -> TelemetrySnapshot | null
instance.removeConnection(connectionId) -> void
instance.snapshot() -> readonly TelemetrySnapshot[]
instance.subscribe(listener) -> unsubscribe
```

输入包含连接 ID 与协议 JSON 对象；模块经 `protocol-core.validate` 校验和复制，调用方不能保留已存数据的可变引用。

## 规则和验证

每条连接最多一条快照。首次接收按首次出现顺序追加，后续同连接替换原位置并发布一次。无效 ID 或遥测返回 `INVALID_TELEMETRY` 且不改变状态；未知查询/删除为无操作；删除一条连接不影响其他快照。

所有数组、快照和嵌套 JSON 均冻结；监听器异常隔离、退订幂等、重入接收只能观察已提交旧快照。测试覆盖 JSON 形状、替换/顺序、恶意输入、删除、不可变性、独立实例、监听器隔离与重入、属性序列、100% 覆盖率及变异门禁。
