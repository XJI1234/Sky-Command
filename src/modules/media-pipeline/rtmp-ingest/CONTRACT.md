# rtmp-ingest 二级模块契约

状态：已批准实施

## 唯一职责

`rtmp-ingest` 管理 RTMP 接收适配器的生命周期，将来自固定路径 `/live/{deviceId}` 的发布开始与结束事实转换为按 `deviceId` 隔离、可由组合根消费的冻结流快照。

它不实现 RTMP 协议或 Socket、不转码、不读写媒体文件、不启动 HLS、不给播放器地址、不决定视频健康，也不校验手机是否已连接。组合根把 `active` 与 `ended` 事实分别报告给 `stream-health`、`transcode-runner` 和 `http-flv-server`。

## 公开接口与适配器

```ts
interface RtmpIngressPort {
  readonly listen: (port: number, events: Readonly<{
    readonly onPublished: (path: string) => void;
    readonly onUnpublished: (path: string) => void;
  }>) => void;
  readonly close: () => void;
}

interface IngestStreamSnapshot {
  readonly deviceId: string;
  readonly phase: "active" | "ended";
  readonly revision: number;
}

interface RtmpIngestSnapshot {
  readonly phase: "idle" | "listening" | "failed";
  readonly revision: number;
  readonly port: number | null;
  readonly streams: readonly IngestStreamSnapshot[];
  readonly diagnostic: string | null;
}
```

端口接口、启动和停止结果沿用 `http-flv-server` 的同步语义：端口必须为 1024..65535；监听固定接收所有路径，但模块只承认精确格式 `/live/{encodedDeviceId}`。`deviceId` 解码后为 1..128 字符、非空白且不含 NUL；编码必须是 `encodeURIComponent(deviceId)` 的规范结果。非规范路径、未知路径和适配器在停止后的迟到事件都必须静默忽略，不能创建流。

## 生命周期和流隔离

1. `start(port)` 成功后为 `listening`；适配器回调只在当前监听代次生效。启动失败为 `failed` 并给出 `无法启动 RTMP 接收服务。请检查端口与桌面端权限。`。
2. `onPublished('/live/{deviceId}')` 把该设备流标为 `active`。同设备重复发布不增加修订，不影响其他设备。
3. `onUnpublished('/live/{deviceId}')` 只将已有活动流改为 `ended`。未知或已结束流不改变状态。
4. `stop()` 成功后清空所有流并回到 `idle`；停止失败保持当前监听与流状态，诊断为 `无法停止 RTMP 接收服务。请检查桌面端权限。`。
5. 快照中流按 `deviceId` 字典序稳定排序；不包含 RTMP 完整地址、源 IP、会话 ID、令牌、原始异常或媒体数据。

## 边界与验收

本模块只能依赖语言标准能力，不导入 Node、Electron、RTMP/HTTP/FFmpeg 库、文件系统、UI 或 `media-pipeline` 的其他二级模块。测试必须覆盖监听生命周期、回调代次隔离、规范和非规范路径、重复发布、结束、跨设备隔离、稳定排序、异常脱敏和冻结副本，并达到类型检查、100% 覆盖率、100% 变异测试和架构边界测试。
