# photo-dispatcher 二级模块契约

状态：已实现
所属一级模块：`camera-photo-control`

## 唯一职责

`photo-dispatcher` 为每个手机检查命令可达性与同设备操作顺序，并把已允许的请求映射为精确的 `camera.photo.capture`、`camera.photo.fetch` 及稳定的按设备控制快照。

它不写文件、不解码 `media-*` 帧、不创建 WebSocket、不读取 DJI。

## 对外接口

```ts
PhotoDispatcher.create({ relay, clock }) -> PhotoDispatcherInstance
instance.capture(deviceId) -> Promise<PhotoDispatchResult>
instance.fetch(deviceId) -> Promise<PhotoDispatchResult>
instance.get(deviceId) -> PhotoDispatchSnapshot
instance.recordDisconnected(deviceId) -> PhotoDispatchSnapshot | null
instance.recordStored(deviceId, fileName, sha256) -> PhotoDispatchSnapshot | null
instance.subscribe(listener) -> unsubscribe
```

`relay.sendCommand` 是唯一出站效果。`recordStored` 只能由 `photo-inbox` 在落盘成功后调用；它的文件名和 SHA-256 与手机 `DELIVERED` 结果是两个独立事实，先后顺序不限。只有两者都到达且完全一致时，才把 `fetching` 转为 `stored` 并完成 fetch。摘要不一致不能产生临时成功，必须继续等待匹配的收件箱事实，直到注入的 `clock` 截止并返回 `TRANSFER_FAILED`。

## 规则

- 发送字段必须是冻结空对象；
- 同设备待完成命令返回 `OPERATION_IN_PROGRESS`；
- 无最近一次 capture 身份时，`fetch` 在本地返回 `NOTHING_TO_FETCH`；
- 主相机不是 `CONNECTED` 时，capture 与 fetch 都在本地返回 `CAMERA_OFFLINE` 或 `CAMERA_CONNECTION_UNKNOWN`，不发命令；
- 手机在线与 MSDK `READY` 缺失时分别返回 `RELAY_OFFLINE` / `SDK_NOT_READY`；
- 断线后迟到命令结果丢弃；
- 手机 `ACTION_REJECTED` 必须把受限 `errorCode` / `errorDescription` 原样放进 `platformError`，不得只留下 `PHOTO_ACTION_REJECTED`。

## 验收

测试覆盖两个命令的精确字段、全部本地拒绝码、同设备互斥、多设备并行、capture 成功记下身份、fetch 成功但仍等 `recordStored`、断线和监听器隔离。
