# whep-playback 二级模块契约

状态：实验设计，尚未实现。

## 唯一职责

`whep-playback` 是播放器抽象层，只负责把受控 WHEP 播放目标交给平台播放器适配器，并把致命故障转换为稳定诊断。它不创建 DOM、不直接创建 `RTCPeerConnection`、不访问 Electron、不启动 MediaMTX。

## 对外接口

```text
WhepPlayback.create(port) -> WhepPlaybackInstance
instance.select({ deviceId, target }) -> SelectResult
instance.clear() -> Result
instance.snapshot() -> PlaybackSnapshot

port.setTarget({ deviceId, url }, onReady, onFatalError) -> Unit
port.clear() -> Unit
```

`target` 必须为 `{ kind: "whep", url }`，且 URL 只能是本机回环 HTTP(S) WHEP 地址。适配器必须负责 HTTP offer/answer、ICE、PeerConnection 和资源释放，但这些细节不能进入本模块公开状态。每次 select/clear 产生新的代次，旧代次首帧和故障不得污染新目标。

选择后状态为 `connecting`；适配器调用当前代次的 `onReady` 后进入 `playing`。适配器同步抛错或当前代次调用 `onFatalError` 后进入 `failed`，诊断固定为：`WHEP 播放器无法建立连接。请检查桌面媒体服务。`。

## 验收

契约测试覆盖目标校验、替换、清理、同步异常、异步故障、旧回调、重复清理和多实例隔离。平台适配器另行做 Electron/浏览器集成测试。
