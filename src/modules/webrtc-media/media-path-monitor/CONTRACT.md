# media-path-monitor 二级模块契约

状态：实验设计，尚未实现。

## 唯一职责

`media-path-monitor` 观察 MediaMTX 的公开管理事实，把合法的 `/live/{deviceId}` path 发布和断开转换为设备隔离的 `published`、`unpublished` 事件。它不启动进程、不播放视频、不判断首帧、不发送手机命令。

## 对外接口

```text
MediaPathMonitor.create(port, options) -> MediaPathMonitorInstance
instance.start(events) -> Result
instance.stop() -> Result
instance.snapshot() -> PathMonitorSnapshot
```

观察端口只接受注入的 HTTP/API 适配器。轮询或回调产生的路径必须经过严格解析：只允许 `/live/{encodedDeviceId}`，必须验证编码往返一致，拒绝路径穿越、空设备标识和未授权路径。

同一设备重复发布必须产生稳定拒绝或幂等事实；旧监听代次的结果必须被忽略。一个设备的路径异常不得清空其他设备。

## 验收

契约测试覆盖路径解析、编码边界、重复发布、断开、轮询异常、代次隔离、排序、停止和异常脱敏。
