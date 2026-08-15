# 中继链路设备注册表模块契约

状态：已批准实施

## 职责与接口

`device-registry` 是当前已配对中继手机的内存权威。它接收来自 `relay-server` 的身份/会话事实，为活动连接和设备 ID 各维护唯一条目，并提供冻结快照与变更通知。手机在此出现只表示中继会话已配对，不表示飞机连接或可飞。

```ts
DeviceRegistry.create() -> DeviceRegistryInstance
instance.snapshot() -> DeviceRegistrySnapshot
instance.register(input) -> RegistryResult<DeviceSnapshot>
instance.removeByConnection(connectionId) -> RegistryResult<DeviceRegistrySnapshot>
instance.removeByDevice(deviceId) -> RegistryResult<DeviceRegistrySnapshot>
instance.getByConnection(connectionId) -> DeviceSnapshot | null
instance.getByDevice(deviceId) -> DeviceSnapshot | null
instance.subscribe(listener) -> unsubscribe
```

它不建 Socket、不解码帧、不推断飞机状态、不存遥测、不跟踪命令、不发航线，也不持久化数据。实例之间完全独立。

## 规则和验证

注册原子执行，连接 ID 与设备 ID 均未使用时才成功，按首次成功注册顺序保存，发布一次新快照。重复任一 ID 返回 `DUPLICATE_DEVICE`，不改状态；会话不匹配不得静默修复。两种删除各只移除一条并发布一次；未知/无效 ID 返回 `DEVICE_NOT_FOUND`；删除后可复用设备 ID。

所有数据和数组冻结，查询不发事件。监听器异常隔离、退订幂等、订阅不立即回放。有效状态只有空表和所有 ID 唯一的就绪表；失败操作保留精确快照。测试覆盖顺序、重复、恶意输入、独立实例、删除、复用、不可变性、重入及随机操作序列，并保持 100% 门禁。
