# 桌面运行时生产装配契约

状态：已批准实施

## 唯一职责

`desktop-runtime` 是无界面的桌面端生产装配根。它创建后只负责按固定顺序启动和停止已经构造好的中继、旧媒体与直播控制模块，汇总可安全展示的只读运行时快照，并按调用方策略处理旧媒体启动失败。

它不建立 Electron 窗口、不定义 IPC 方法、不加载 HTML、不保存设置、不执行 DJI 操作、不解析航线、不判断飞行安全性，也不替代任何一级模块的业务规则。

## 对外接口

```ts
DesktopRuntime.create(dependencies, options) -> DesktopRuntimeInstance

instance.start() -> Promise<RuntimeResult>
instance.stop() -> Promise<RuntimeResult>
instance.snapshot() -> DesktopRuntimeSnapshot
instance.services() -> DesktopRuntimeServices
instance.subscribe(listener) -> unsubscribe
```

`services()` 仅供未来的 IPC 白名单适配器使用，返回已构造好的公开一级模块接口；渲染进程、页面或插件不得直接获得该对象。

`options.mediaRequired` 为可选布尔值，默认 `true`。生产应用固定传 `true`；`false` 仅保留给受控故障隔离测试，不能用于装配另一条媒体路径。

## 生命周期

初始状态为 `idle`。`start()` 固定先调用中继监听，再启动旧媒体服务。中继启动失败映射为 `RELAY_START_FAILED`。当 `mediaRequired` 为 `true` 时，旧媒体启动失败必须尝试停止中继，最终映射为 `MEDIA_START_FAILED`；当 `mediaRequired` 为 `false` 时，旧媒体启动失败只保留在媒体公开快照，中继保持运行，`start()` 返回成功并进入 `running`。任何底层异常都必须收敛为稳定结果，不能穿过本模块。

`stop()` 固定先请求直播控制停止所有已知设备的直播，再停止媒体服务，最后停止中继。停止必须尽力完成所有后续清理；某一步失败不会阻止更靠后的清理。完全停止后状态为 `idle`。重复 `stop()` 返回稳定的 `NOT_RUNNING`，重复 `start()` 返回 `ALREADY_RUNNING`，启动或停止尚未完成时另一操作返回 `OPERATION_IN_PROGRESS`。

## 媒体故障隔离

本模块只拥有生产 RTMP/HTTP-FLV 媒体面。封存的 WebRTC/WHIP/WHEP 源码不属于本模块，且不得由媒体失败结果启动、停止或间接恢复。`mediaRequired: false` 只改变受控测试中的旧媒体失败升级范围：中继可保持运行，但不会启动或暴露任何替代媒体能力。停止时旧媒体和中继仍按本契约尽力清理。

## 快照与订阅

公开快照只包含运行时阶段、中继公开快照、媒体公开快照和递增修订号。快照不得包含 WebSocket、进程句柄、文件路径、FFmpeg 参数、凭据、原始异常或直播地址。每个快照及其顶层子对象必须为冻结副本。

每次完成状态迁移后发布一份新快照。监听器异常必须被隔离；取消订阅必须幂等，且取消后不能再收到后续快照。

## 依赖和边界

依赖只能是既有 `relay-link`、`media-pipeline`、`live-stream-control` 的公开接口。`desktop-runtime` 不导入任何二级模块实现、`ws`、`node:*`、Electron、DJI SDK、地图引擎或前端框架。

未来的 Node/Electron 生产适配器负责构造这些依赖；未来的 IPC 适配器负责把 `services()` 中明确列出的能力映射给页面。本模块不预先定义页面按钮、频道或 UI 状态。

## 验收

测试必须覆盖启动顺序、两个启动失败路径、失败回滚、停止顺序、重复调用、并发互斥、异常隔离、订阅取消、快照冻结与架构依赖边界。类型、局部覆盖率、性能和 Stryker 变异得分均为 100%。
