# 相机拍照控制一级模块契约

状态：已实现

## 唯一职责

`camera-photo-control` 是桌面端拍照与原图回传的控制侧：它向已连接手机下发 `camera.photo.capture` / `camera.photo.fetch`，并把中继收齐的原图交给本地照片收件箱。它不接收 RTMP、不截图传帧、不调用 DJI、不创建 WebSocket，也不把手机接受快门显示成“电脑已经有照片”。

飞行页「图传」子页提供两个始终可见的按钮：**拍照**、**回传照片**。各走各的命令，互不等待。按钮回执与图传启停回执分区存放，不得互相覆盖。操作台不得把航点动作写成拍照。

## 对外接口

```ts
CameraPhotoControl.create({ relay, now, fs? }) -> CameraPhotoControlInstance

instance.capture(deviceId) -> Promise<PhotoDispatchResult>
instance.fetch(deviceId) -> Promise<PhotoDispatchResult>
instance.get(deviceId) -> PhotoDispatchSnapshot
instance.list(deviceId) -> readonly StoredPhoto[]
instance.recordDisconnected(deviceId) -> PhotoDispatchSnapshot | null
instance.recordStored(deviceId, fileName, sha256) -> PhotoDispatchSnapshot | null
instance.inbox -> PhotoInboxInstance
instance.subscribe(listener) -> unsubscribe
```

每一个可变状态都以 `deviceId` 为键。`capture` 成功只表示手机回报 DJI 已拍下，并记下本次 `fileName`/`index`。`fetch` 成功只表示手机 `DELIVERED` 结果与 `photo-inbox` 的落盘事实在文件名、SHA-256 上完全一致。图传是否仍在出画必须继续看 `media-pipeline`。

## 二级模块与依赖

| 二级模块 | 唯一职责 | 明确不负责 |
| --- | --- | --- |
| `photo-dispatcher` | 检查命令可达性、同设备互斥，并把请求映射为精确的两个命令 | 收字节、写磁盘、构造媒体帧 |
| `photo-inbox` | 接收 `relay-link/media-intake` 已校验的原图，按设备去重落盘并提供只读清单 | 下发命令、解析 WebSocket |

一级组合根只组合这两个公开二级接口。它只依赖注入的中继命令端口、时钟和可选的原子写入端口；媒体交接由生产装配层在 `photo-inbox.accept` 成功后调用 `recordStored`。禁止二级模块导入 `relay-link`、WebSocket、DJI 或 Electron 的内部实现。

## 已确认的协议契约

```text
camera.photo.capture    fields: {}
camera.photo.fetch      fields: { knownPhotos: [{ fileName, sha256 }] }
```

桌面在发送前只检查：已选图传/任务所用的那台在线手机、MSDK 为 `READY`、主相机 `CameraKey.KeyConnection(LEFT_OR_MAIN)` 为 `CONNECTED`。不要求 AirLink（那是视频源，不是快门）。`fetch` 使用该设备收件箱当前的 `(fileName, sha256)` 清单，不要求本次桌面会话刚刚执行过 `capture`；手机会逐张回传清单中缺失的照片，直到明确返回 `NONE`。飞控、遥控器、电量、航线、图传是否正在推流均不得作为本地拒绝理由。手机将在调用 MSDK 前再次检查硬件；DJI 拒绝必须原样显示。

命令超时沿用桌面中继的 120_000 ms。回传期间桌面必须继续处理遥测、图传和其它命令；媒体分块不得堵住命令结果。

## 状态、并发和断线

每台设备的控制快照仅为 `idle`、`capturing`、`captured`、`fetching`、`stored`、`failed` 或 `disconnected`，并包含最后一次安全文件名、稳定失败码。状态不保存绝对路径、原始异常或照片字节。`stored` 表示本次批量回传的最后一张文件已在收件箱确认；同一文件名或同一 SHA-256 再次到达不得覆盖，只保持已有记录。`fetch` 成功结果额外包含本次实际回传数量 `count`。

同一设备在等待命令结果或本地收件箱确认时，第二个 capture 或 fetch 返回 `OPERATION_IN_PROGRESS`，且不触发依赖；不同设备互不阻塞。capture 与 fetch 不得合成一次点击。一次 fetch 必须携带调用开始时该设备收件箱的 `(fileName, sha256)` 清单，手机逐张等待 `media-result.ok=true` 后继续，直到返回 `NONE`；中途失败不得把未确认文件写入本次清单。设备断开时进行中的结果不能覆盖 `disconnected`；重连后必须由操作者再点，不能自动重拍或自动回传。

本地照片目录由生产装配层提供的原子写入端口决定。控制模块只暴露文件安全基名、大小、摘要和接收时间，禁止把绝对路径写进快照或 UI 文案。

## 验收

测试覆盖空字段命令、无拍照身份时拒绝 fetch、同设备互斥、多设备并行、断线、迟到结果、收件箱去重、磁盘写入失败、文件名与摘要双事实匹配，以及不导入 WebSocket/DJI/Electron 的架构边界。
