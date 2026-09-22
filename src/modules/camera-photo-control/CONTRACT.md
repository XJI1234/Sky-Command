# 相机拍照控制一级模块契约

状态：契约已批准；实现未开始

## 唯一职责

`camera-photo-control` 是桌面端拍照与原图回传的控制侧：它向已连接手机下发 `camera.photo.capture` / `camera.photo.fetch`，并把中继收齐的原图交给本地照片收件箱。它不接收 RTMP、不截图传帧、不调用 DJI、不创建 WebSocket，也不把手机接受快门显示成“电脑已经有照片”。

飞行页「图传」子页提供两个始终可见的按钮：**拍照**、**回传照片**。各走各的命令，互不等待。按钮回执与图传启停回执分区存放，不得互相覆盖。操作台不得把航点动作写成拍照。

## 对外接口

```ts
CameraPhotoControl.create(dependencies) -> CameraPhotoControlInstance

instance.capture(deviceId) -> Promise<PhotoControlResult>
instance.fetch(deviceId) -> Promise<PhotoControlResult>
instance.get(deviceId) -> PhotoControlSnapshot
instance.list() -> readonly PhotoControlSnapshot[]
instance.recordDisconnected(deviceId) -> PhotoControlSnapshot | null
instance.forget(deviceId) -> boolean
instance.subscribe(listener) -> unsubscribe
```

每一个可变状态都以 `deviceId` 为键。`capture` 成功只表示手机回报 DJI 已拍下，并记下本次 `fileName`/`index`。`fetch` 成功只表示 `photo-inbox` 已有与该次身份匹配、摘要一致的本地文件。图传是否仍在出画必须继续看 `media-pipeline`。

## 二级模块与依赖

| 二级模块 | 唯一职责 | 明确不负责 |
| --- | --- | --- |
| `photo-dispatcher` | 检查命令可达性、同设备互斥，并把请求映射为精确的两个命令 | 收字节、写磁盘、构造媒体帧 |
| `photo-inbox` | 接收 `relay-link/media-intake` 已校验的原图，按设备去重落盘并提供只读清单 | 下发命令、解析 WebSocket |

一级组合根只组合这两个公开二级接口。它只可以依赖注入的 `relay-link` 命令端口、`media-intake` 的已完成媒体交接，以及只读设备在线判定；禁止导入它们的内部实现。

## 已确认的协议契约

```text
camera.photo.capture    fields: {}
camera.photo.fetch      fields: {}
```

桌面在发送前只检查：已选图传/任务所用的那台在线手机、MSDK 为 `READY`、主相机 `CameraKey.KeyConnection(LEFT_OR_MAIN)` 为 `CONNECTED`。不要求 AirLink（那是视频源，不是快门）。`fetch` 还必须已有该设备最近一次 `capture` 成功身份；没有身份时本地拒绝，不发命令。飞控、遥控器、电量、航线、图传是否正在推流均不得作为本地拒绝理由。手机将在调用 MSDK 前再次检查硬件；DJI 拒绝必须原样显示。

命令超时沿用桌面中继的 120_000 ms。回传期间桌面必须继续处理遥测、图传和其它命令；媒体分块不得堵住命令结果。

## 状态、并发和断线

每台设备的控制快照仅为 `idle`、`capturing`、`captured`、`fetching`、`stored`、`failed` 或 `disconnected`，并包含最后一次安全文件名、稳定失败码。状态不保存绝对路径、原始异常或照片字节。`stored` 表示收件箱已有该次文件；同一文件名或同一 SHA-256 再次到达不得覆盖，只保持已有记录。

同一设备在等待命令结果时，第二个 capture 或 fetch 返回 `OPERATION_IN_PROGRESS`，且不触发依赖；不同设备互不阻塞。capture 与 fetch 不得合成一次点击。设备断开时进行中的结果不能覆盖 `disconnected`；重连后必须由操作者再点，不能自动重拍或自动回传，也不能复用断线前未完成的传输 ID。

本地照片目录固定为用户数据下的 `photos/{deviceId}/{fileName}`。模块只暴露只读目录句柄和基名，禁止把绝对路径写进快照或 UI 文案。

## 验收

实现前每个二级模块必须有中文 `CONTRACT.md`。测试必须覆盖空字段命令、无拍照身份时拒绝 fetch、同设备互斥、多设备并行、断线、迟到结果、收件箱去重、磁盘写入失败、以及不导入 WebSocket/DJI/Electron 的架构边界。
