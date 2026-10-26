# photo-dispatcher 二级模块契约

状态：已实现
所属一级模块：`camera-photo-control`

## 唯一职责

`photo-dispatcher` 为每个手机检查命令可达性与同设备操作顺序，并把已允许的请求映射为精确的 `camera.photo.capture`、`camera.photo.fetch`、`camera.photo.fetch.stop` 及稳定的按设备控制快照。

它不写文件、不解码 `media-*` 帧、不创建 WebSocket、不读取 DJI。

## 对外接口

```ts
PhotoDispatcher.create({ relay, clock?, now?, knownPhotos? }) -> PhotoDispatcherInstance
instance.capture(deviceId) -> Promise<PhotoDispatchResult>
instance.fetch(deviceId, prepare?) -> Promise<PhotoDispatchResult>
instance.stopFetch(deviceId) -> Promise<PhotoDispatchResult>
instance.get(deviceId) -> PhotoDispatchSnapshot
instance.recordDisconnected(deviceId) -> PhotoDispatchSnapshot | null
instance.recordStored(deviceId, fileName, sha256) -> PhotoDispatchSnapshot | null
instance.storedConfirmation(deviceId) -> (fileName, sha256) => PhotoDispatchSnapshot | null
instance.subscribe(listener) -> unsubscribe
```

`relay.sendCommand` 是唯一出站效果。`fetch` 请求必须带入调用开始时的 `knownPhotos` 清单；`recordStored` 只能由 `photo-inbox` 在每张照片原子落盘成功后调用。一次批量中每张媒体结果都可先于最终 `DELIVERED` 命令结果到达，调度器必须按 `(fileName, sha256)` 累积收件箱事实。只有手机最终结果中的最后一张文件和数量与已确认收件箱事实匹配时，才把 `fetching` 转为 `stored` 并完成 fetch。摘要不一致不能产生临时成功，必须继续等待匹配的收件箱事实，直到注入的 `clock` 截止并返回 `TRANSFER_FAILED`。

## 规则

- capture 字段为冻结空对象，fetch 字段为冻结的 `knownPhotos` 清单；
- 同设备待完成的 capture 或 fetch 返回 `OPERATION_IN_PROGRESS`；`stopFetch` 不占用该锁，字段为冻结空对象。准备清单、即将发送和命令已在途时都必须停止：命令尚未发出时不得再发送 `camera.photo.fetch`，并在本地以 `STOPPED` 结束；命令已经发出时必须再发送 `camera.photo.fetch.stop`。手机回答尚未运行，但本地回传仍停在准备阶段时，对外结果仍是 `STOPPED`。
- fetch 不依赖最近 capture；手机明确返回 `NONE` 时才报告 `NOTHING_TO_FETCH`；
- 主相机不是 `CONNECTED` 时，capture 与 fetch 都在本地返回 `CAMERA_OFFLINE` 或 `CAMERA_CONNECTION_UNKNOWN`，不发命令；
- 手机在线与 MSDK `READY` 缺失时分别返回 `RELAY_OFFLINE` / `SDK_NOT_READY`；
- 断线后迟到命令结果丢弃；
- 手机 `ACTION_REJECTED` 必须把受限 `errorCode` / `errorDescription` 原样放进 `platformError`，不得只留下 `PHOTO_ACTION_REJECTED`。

## 回传进度

fetch 从锁定设备后开始报告 `preparing`；可选 prepare 负责读取电脑已有照片，结束后才发送清单并报告 `listing`。`relay.sendCommand(deviceId, request, onProgress?)` 的第三参数只观察本次请求，不进入 wire 字段。进度快照包含 `stage`、从 1 开始的 `photoIndex`（准备/清单为 0）、收件箱实际确认的 `completedCount`、安全文件名、本张本阶段的字节数/可空总字节数、本机起止与更新时间、最近最多八条阶段记录。阶段为 preparing/listing/downloading/receiving/verifying/saving/saved/completed/empty/failed/stopped/disconnected。fetch 终态为 `STOPPED` 时必须把已有进度收成 `stopped`，不能丢掉进度后让界面继续显示进行中。

下载、接收的同阶段字节更新约 250ms 发布一次；阶段、文件变化和最终字节立即发布。只有 recordStored 增加已保存数量；进度绝不代替收件箱确认或最终 DELIVERED。失败/断线保留本次已保存数量、当前文件、失败阶段与已有记录；终态后的进度丢弃，后续断线不改写已有批次终态。再次 fetch 清零批次记录。请求 generation 不匹配时只返回旧请求断线结果，绝不释放新请求锁或等待器。

`storedConfirmation` 在异步保存开始时捕获当前请求 generation，返回仅能为同一次 fetching 批次记录落盘的闭包；终态、断线及新请求使旧闭包无效。手机成功结果先于本地保存确认时仍可等待该闭包完成，但它不得跨批次复用。

## 验收

测试覆盖两个命令的精确字段、全部本地拒绝码、同设备互斥、多设备并行、capture 成功记下身份、fetch 成功但仍等 `recordStored`、断线和监听器隔离。
