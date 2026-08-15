# 桌面外壳装配

状态：已实现；生产胶水，不加入覆盖率/变异门禁

## 职责

把 `DesktopUiGateway` 的白名单方法登记为 `app-shell/ipc-bridge` 可接受的短横线方法名，并组装窗口外壳。渲染进程只能调用这些短名；禁止增加通用 `gateway-invoke` 通道。`diagnostics-record` 只接收操作台拦住未发出的动作，由 Electron 宿主写入事故日志，不进入业务网关。

它不实现业务状态机，不读取 Electron 全局（Electron 适配器由调用方注入端口）。
