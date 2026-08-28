# media-path-monitor 二级模块契约

状态：已封存的 WebRTC/WHIP/WHEP 旁路源码与独立测试；不纳入生产组合根。

> 封存规则：本模块只保留给历史低延迟旁路的源码和测试。生产 `desktop-application`、Electron 宿主、IPC 和操作台不得创建、调用或暴露它；重新启用必须先取得业务批准，并同步更新两端根契约、生产装配和跨端验证。

## 唯一职责

`media-path-monitor` 观察 MediaMTX 的公开管理事实，把合法的 `/live/{deviceId}` path 发布和断开转换为设备隔离的 `published`、`unpublished` 事件。它不启动进程、不播放视频、不判断首帧、不发送手机命令。

## 对外接口

```ts
MediaPathMonitor.create(port) -> MediaPathMonitorInstance
instance.start() -> StartResult
instance.refresh() -> Promise<RefreshResult>
instance.stop() -> StopResult
instance.snapshot() -> PathMonitorSnapshot
```

注入端口只提供 `listPaths(): Promise<readonly string[]>`。本模块不创建定时器；组合根决定刷新频率。`refresh` 将当前路径集合与上一次集合比较，并按设备标识字典序返回变化。

## 对外接口

```text
MediaPathMonitor.create(port, options) -> MediaPathMonitorInstance
instance.start(events) -> Result
instance.stop() -> Result
instance.snapshot() -> PathMonitorSnapshot
```

观察端口只接受注入的 HTTP/API 适配器。轮询产生的路径必须经过严格解析：只允许 `/live/{encodedDeviceId}`，必须验证编码往返一致，拒绝路径穿越、空设备标识和未授权路径。

同一设备在连续刷新中保持发布时不得重复产生事件；旧监听代次的结果必须被忽略。一个设备的路径异常不得清空其他设备。端口抛出的异常必须转为固定的 `LIST_FAILED` 诊断。

## 验收

契约测试覆盖路径解析、编码边界、重复发布、断开、轮询异常、代次隔离、排序、停止和异常脱敏。
