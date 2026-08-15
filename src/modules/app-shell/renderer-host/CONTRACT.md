# renderer-host 二级模块契约

状态：已批准实施

## 职责

只负责把渲染入口交给窗口端口装载，并在失败时清理渲染缓存后按固定上限重试。它不解释业务错误，不创建窗口。

## 接口

```ts
RendererHost.create(port, options) -> RendererHostInstance
instance.load() -> Promise<RendererResult>
instance.snapshot() -> RendererSnapshot
```

入口地址必须是非空字符串；最大尝试次数固定为 `1 + retryCount`，`retryCount` 范围为 `0..3`。首次失败后最多清理一次缓存再重试；成功返回尝试次数。所有尝试失败返回 `RENDERER_FAILED`，端口异常不向外泄漏。成功后重复 load 返回 `ALREADY_LOADED`，释放后返回 `DISPOSED`。
