# photo-inbox 二级模块契约

状态：待实现
所属一级模块：`camera-photo-control`

## 唯一职责

`photo-inbox` 接收已经由 `relay-link/media-intake` 校验过大小和 SHA-256 的原图字节，写入该设备的本地照片目录，并提供按设备隔离的只读清单。它是桌面照片文件的唯一拥有者。

它不下发命令、不解析原始 WebSocket 字节、不调用 DJI、不打开系统相册 UI。

## 对外接口

```ts
PhotoInbox.create({ directory }) -> PhotoInboxInstance
instance.accept(deviceId, mediaFile) -> Accepted | Duplicate | Rejected
instance.list(deviceId) -> readonly StoredPhoto[]
instance.forget(deviceId) -> boolean
instance.subscribe(listener) -> unsubscribe
```

`mediaFile` 只含安全基名、正整数 `size`、小写 `sha256` 和脱离引用的字节副本。`directory` 是注入的已校验根目录；模块在其下只创建 `photos/{deviceId}/` 分段，文件名必须等于媒体帧基名。

## 规则

- 同一 `deviceId` 下相同 `fileName` 或相同 `sha256` 返回 `Duplicate`，不覆盖已有文件，不二次写入；
- 写入必须先写临时文件再原子替换；失败删除临时文件，不留下半张照片；
- 清单条目只有 `fileName`、`size`、`sha256` 和本机接收时刻；不含绝对路径；
- `forget` 只删除该设备清单记录，不删除磁盘文件，避免误删操作者已拷走的照片；
- 字节、清单和结果均冻结或复制。

## 验收

测试覆盖首次写入、文件名去重、摘要去重、写入失败回滚、非法基名拒绝、多设备隔离和路径不泄漏。
