# process-lifecycle 二级模块契约

状态：已批准实施

## 职责

只负责单实例锁和生命周期状态：`new`、`acquired`、`released`。它不创建窗口、不装载渲染内容、不执行任何业务操作。

## 接口

```ts
ProcessLifecycle.create(port) -> ProcessLifecycleInstance
instance.acquire() -> LifecycleResult
instance.release() -> LifecycleResult
instance.snapshot() -> LifecycleSnapshot
```

`port.acquire()` 返回是否取得锁；`false` 明确返回 `LOCK_UNAVAILABLE`，`port.release()` 释放锁。每个实例最多成功 acquire 一次，重复调用返回 `ALREADY_ACQUIRED`；未取得锁时 release 返回 `NOT_ACQUIRED`；已释放后任何操作返回 `RELEASED`。适配器异常映射为 `ADAPTER_FAILED`，状态不被破坏。结果和快照冻结，release 幂等。
