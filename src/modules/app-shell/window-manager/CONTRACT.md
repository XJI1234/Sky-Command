# window-manager 二级模块契约

状态：已批准实施

## 职责

只负责窗口创建、聚焦、关闭和内容安全策略（CSP）字符串。它不决定业务页面，不读取 Electron 全局，不管理渲染加载重试。

## 接口

```ts
WindowManager.create(port, options) -> WindowManagerInstance
instance.create() -> WindowResult
instance.focus() -> WindowResult
instance.close() -> WindowResult
instance.snapshot() -> WindowSnapshot
```

`create` 只能成功一次；再次调用返回 `ALREADY_CREATED`。未创建时 focus/close 分别返回 `NOT_CREATED`；已关闭后返回 `CLOSED`。CSP 必须由调用方提供非空字符串并在创建时原样交给端口。端口异常映射为 `ADAPTER_FAILED`，不泄露异常内容。
