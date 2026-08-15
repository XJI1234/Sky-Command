# ipc-bridge 二级模块契约

状态：已批准实施

## 职责

只把显式注册的方法暴露给渲染进程，并拒绝任何未注册或通用通道调用。它不执行业务逻辑，不接受任意通道名和任意参数转发。

## 接口

```ts
IpcBridge.create(port, methods) -> IpcBridgeInstance
instance.invoke(name, input) -> Promise<BridgeResult>
instance.names() -> readonly string[]
```

方法名必须是非空安全标识符且不可重复；调用未知名称返回 `METHOD_NOT_ALLOWED`。方法执行成功返回复制后的值；方法抛出或返回不可处理结果时返回 `HANDLER_FAILED`，错误文本不得泄漏。注册表和名称列表冻结，实例释放后返回 `DISPOSED`。
