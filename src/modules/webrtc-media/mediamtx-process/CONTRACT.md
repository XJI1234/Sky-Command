# mediamtx-process 二级模块契约

状态：实验设计，尚未实现。

## 唯一职责

`mediamtx-process` 只负责生成受控 MediaMTX 配置并管理一个 MediaMTX 进程的启动、运行事实和停止。它不解释设备状态、不生成命令、不播放视频、不管理 WHEP PeerConnection。

## 对外接口

```text
MediaMtxProcess.create(port) -> MediaMtxProcessInstance
instance.start(input, events) -> ProcessResult
instance.stop() -> ProcessResult
instance.snapshot() -> ProcessSnapshot
```

输入至少包含：HTTP 端口、WebRTC UDP 端口、路径前缀、API 观察端口和媒体模式。MediaMTX 只开放实验需要的协议。WHIP/WHEP HTTP 服务必须可被手机访问，管理 API 必须只绑定本机。

进程适配器通过注入的 `ProcessPort` 启动，不直接读取环境变量或创建无法测试的全局进程。完整命令行、进程路径、原始 stderr 和凭据不得出现在公开结果。

## 状态与错误

状态为 `idle`、`starting`、`running`、`stopping`、`failed`、`disposed`。启动失败、重复启动、停止失败和进程异常退出都映射为固定错误码。停止必须尽力完成所有清理，并保留是否仍在监听的事实。

## 验收

契约测试覆盖配置生成、端口校验、启动/停止顺序、重复操作、同步异常、迟到退出事件、敏感信息脱敏和多实例隔离。该模块不得依赖 Electron 或具体 UI。
