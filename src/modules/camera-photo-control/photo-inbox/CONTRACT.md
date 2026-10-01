# photo-inbox 二级模块契约

状态：已实现
所属一级模块：`camera-photo-control`

## 唯一职责

`photo-inbox` 接收已经由 `relay-link/media-intake` 校验过大小和 SHA-256 的原图字节，通过注入的原子写入端口持久化，并提供按设备隔离的只读清单。它拥有照片的去重规则和本地清单；该清单是 `camera.photo.fetch` 判断当前电脑已同步照片的唯一输入。

它不下发命令、不解析原始 WebSocket 字节、不调用 DJI、不打开系统相册 UI。

## 对外接口

```ts
PhotoInbox.create({ now, fs? }) -> PhotoInboxInstance
instance.accept(deviceId, mediaFile) -> "accepted" | "duplicate" | "rejected"
instance.list(deviceId) -> readonly StoredPhoto[]
instance.forget(deviceId) -> boolean
instance.subscribe(listener) -> unsubscribe
```

`mediaFile` 只含安全基名、正整数 `size`、小写 `sha256` 和已由上游脱离接收缓冲区的字节。可选 `fs.writeAtomic(deviceId, fileName, bytes)` 是唯一持久化效果；目录布局、临时文件和原子替换由生产装配层的适配器负责。`now` 只用于生成安全的本机接收时间。

## 规则

- 同一 `deviceId` 下相同 `fileName` 或相同 `sha256` 返回 `Duplicate`，不覆盖已有文件，不二次写入；
- 配置持久化端口时，只有 `writeAtomic` 返回 `true` 才登记清单；写入失败不登记；
- 清单条目只有 `fileName`、`size`、`sha256` 和本机接收时刻；不含绝对路径；
- `forget` 只删除该设备清单记录，不删除磁盘文件，避免误删操作者已拷走的照片；
- 清单以冻结数组暴露；持久化端口收到字节副本，模块不保留照片字节。

## 验收

测试覆盖首次写入、文件名去重、摘要去重、写入失败回滚、非法基名拒绝、多设备隔离和路径不泄漏。
