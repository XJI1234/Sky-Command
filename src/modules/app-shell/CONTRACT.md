# 应用外壳一级模块契约

状态：已批准实施

## 1. 唯一职责

`app-shell` 是桌面程序的组合根。它只负责把应用生命周期、窗口、渲染内容、运行期路径和受限 IPC 适配器按固定顺序组装起来，并把启动、聚焦、关闭和释放结果转换为稳定的桌面外壳结果。

它不实现设备、航线、飞行、地图、图传或任何其他业务规则；不读取业务状态；不向渲染进程暴露通用 IPC 转发；不允许其他一级模块反向依赖它。

## 2. 对外接口

```ts
AppShell.create(dependencies) -> AppShellInstance
instance.start() -> Promise<ShellResult>
instance.focusExisting() -> ShellResult
instance.invoke(name, input) -> Promise<BridgeResult>
instance.snapshot() -> ShellSnapshot
instance.dispose() -> Promise<void>
```

`dependencies` 只接收五个二级模块的公开接口。`start` 只允许成功完成一次；重复启动返回 `ALREADY_STARTED`，释放后调用返回 `DISPOSED`。所有结果、快照和错误均为冻结副本，底层异常不得泄漏。

## 3. 固定启动顺序

1. `process-lifecycle.acquire` 获取单实例锁；失败返回 `ALREADY_RUNNING`。
2. `window-manager.create` 创建或取得主窗口。
3. `renderer-host.load` 装载渲染内容；失败时由其内部按契约有限重试。
4. 生命周期进入 `ready`，之后调用方才能通过 `focusExisting` 聚焦窗口。

任何一步失败都必须按反向顺序释放已成功步骤，不得留下半启动状态。第二实例只能调用 `focusExisting`，不能创建第二个窗口或装载第二份渲染内容。

## 4. 二级模块

| 二级模块 | 唯一职责 | 明确不负责 |
| --- | --- | --- |
| `process-lifecycle` | 单实例锁、启动/退出顺序和一次性释放 | 业务规则、窗口或渲染内容 |
| `window-manager` | 创建、聚焦和关闭窗口，并提供 CSP 配置 | 决定窗口业务内容 |
| `renderer-host` | 装载渲染入口，失败时清缓存并有限重试 | 解释业务错误 |
| `runtime-paths` | 根据开发/打包环境解析受控运行路径 | 决定文件格式和读写内容 |
| `ipc-bridge` | 仅暴露显式列举的安全方法 | 通用通道转发和业务逻辑 |

每个二级模块必须有自己的 `CONTRACT.md` 和纯接口测试。生产适配器可以依赖 Electron，但核心接口和测试替身不能依赖 Electron、Node 全局、DOM 或具体窗口类。

## 5. 错误和生命周期

错误码只允许：`ALREADY_RUNNING`、`ALREADY_STARTED`、`NOT_STARTED`、`RENDERER_FAILED`、`WINDOW_FAILED`、`LIFECYCLE_FAILED`、`DISPOSED`、`INVALID_INPUT`。关闭和释放必须幂等；释放时不重新启动、不发送业务命令。适配器抛出的异常统一映射为稳定错误码。

## 6. 验收

测试必须覆盖启动顺序、第二实例聚焦、每一步失败回滚、渲染重试结果、重复调用、释放幂等、快照不可变性、恶意依赖、IPC 白名单和禁止通用通道。一级入口不得导出二级实现细节。
