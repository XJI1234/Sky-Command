# Sky-Command 源码整合记录

阅读对象包括根 CONTRACT、relay-link 及其协议/会话/命令/遥测/任务/媒体子模块、Node WebSocket 适配器、桌面 NodeRuntime/应用/UI 网关、operations/工作流组合，以及设备、飞行、任务、航线、直播和媒体的公开接口、关键实现与已有契约测试。下列结论以当前实现和测试为依据；根 CONTRACT 中个别描述早于生产实现，例如照片和额外飞行中止动作。

## 原有运行时

Electron 组合根负责桌面路径、窗口、IPC、媒体进程与 UI。`DesktopApplication` 同时依赖 Node 文件系统、业务模块和媒体端口，不能直接塞进 Vue/React 浏览器 bundle。`DesktopUiGateway` 是同进程白名单调用，不是网络服务；返回 unknown/sanitized workflow 状态，且隐藏部分播放 URL，因此也不能直接当远程浏览器 SDK。

`NodeRuntime.createRelay` 是已有 Node 组合，默认创建本地诊断存储。新的 SDK `/node` 复用相同 RelayLink 和 NodeTransport，注入 UUID、定时器与时钟，诊断存储和照片 sink 交给宿主明确提供，避免导入 SDK 就产生目录和文件副作用。

## 通讯与协议

`NodeWebSocketRelayTransport` 在 `/relay` 监听手机连接，把 ws 转换为中继端口。只接受协议字节，具有 ping/pong 和传输级 RTT 测量。Android 是客户端，握手发送 hello/deviceId/protocolVersion，电脑生成 paired/sessionId；替换同 deviceId 的旧连接后旧会话立即失效。

`protocol-core` 使用无损 JSON AST：number.value 为原始十进制字符串，不用 JS number 重写入站遥测。严格校验 UTF-8、JSON 深度/字段/数值文本、消息类型、ID、摘要与块大小。最大帧 512 KiB，最大任务 100 MiB，最大任务块 256 KiB。wire command 中 name 与其他字段处于同一 command 对象；内部 command.fields 只是 TypeScript 模型，不是额外的 wire 嵌套层。

`RelayLink` 将 RelayServer、DeviceRegistry、CommandTracker、TelemetryIntake、MissionSender、MissionPhaseIntake 和 MediaIntake 组合起来。状态仅按 deviceId/connectionId/sessionId 归属，不允许隐式全局“当前设备”。遥测和执行阶段只属于当前连接；命令用唯一 ID 关联结果，断线拒绝全部等待命令。

MissionSender 检查原始字节长度和 SHA-256，串行发送 begin/chunk/complete，等待手机 mission-result。传输接收与 DJI 航线上传是两个步骤；`wayline.upload` 才进入设备侧上传。不能把“传输成功”显示成“任务已开始”。

## 业务模块

| 模块 | 可复用部分与关键语义 | SDK 入口 |
|---|---|---|
| relay-link | 原协议、手机会话、遥测、命令结果、任务传输 | `/relay`、`/protocol`、`/node` |
| relay-operations-adapter | JSON AST→设备事实投影、会话观测、遥测读结果协调、各命令族网关 | `/operations` |
| device-console | 三段链路、能力门禁、设备设置缓存、配对状态 | `/device` |
| relay-device-settings | 相机/图传命令字段及结果转换 | `/device` |
| route-library | KML/KMZ 导入、ZIP/XML 限制、摘要、合格性、目录与预览；保留原始文件字节 | `/routes` |
| mission-control | stage/upload/start/pause/resume/stop；执行里程碑与会话变更后的安全处置 | `/mission` |
| flight-control | 危险动作确认 ID/期限、门禁、设备返回终态的语义判定 | `/flight` |
| live-stream-control | RTMP 配置和开关，要求当前遥测/设备事实 | `/stream` |
| media-pipeline | RTMP/HTTP-FLV 管线状态与播放器端口；不绑定 Vue/React DOM | `/media` |
| camera-photo-control | capture/fetch、已知照片摘要与 PhotoInbox 端口 | `/photos` |

生产配对 start/stop 由手机执行，operations 适配器明确拒绝电脑端发起。SDK 的生产网关白名单据此只开放 pairing.status。flight 的 confirm-landing 和三个 stop 动作、camera.photo.capture/fetch 在当前代码存在，不能只按旧根文档中的较短命令列表封装。

摄像链路是 RTMP→HTTP-FLV。WebSocket 不承载直播视频；摄取服务、浏览器播放器和播放地址需要宿主端口。WHIP/WHEP/MediaMTX 等封存路径没有加入网关命令白名单，也不会在导入 SDK 时创建相关进程。

## 新边界

浏览器控制网关在原手机协议之上新增独立 version=1 控制协议，按原公共接口转发命令/任务。控制请求必须携带设备 sessionId，网关在发送前校验，异步命令完成后再核对。快照推送共享原 RelayLink 状态；浏览器断线清空快照并拒绝旧请求，重连刷新状态但不重发动作。

任务由 HTTP 上传原始二进制，避免控制 WebSocket 中 Base64 放大百兆文件；网关限并发/长度并重新校验摘要。完成上传后仍调用原 MissionSender，手机不需要为 SDK 修改协议。

浏览器客户端的请求超时与手机命令结果超时是两个不同层次。前者抛 SDK 错误，后者返回原 status=timed-out。二者都不能证明设备动作没发生。网关/浏览器取消后已经交付给中继的动作可能继续，不能自动补发。

Vue 使用 shallowRef 与 effectScope 清理，React 使用 useSyncExternalStore。框架层不保存第二份设备业务状态，不隐式连接、不销毁共享客户端。包根可在 SSR/Node 中安全导入，WebSocket 仅在显式 connect 时创建。

## 未纳入自动化替代的内容

Electron 壳、地图场景/Cesium 城市瓦片、系统本地设置、凭据代理与封存 WebRTC 运行时不属于此通讯 SDK 的宿主无关接口。复用地图预览数据时应由平台自有地图实现渲染。

当前工作区缺少原默认跨运行时测试所要求的 `MSDK-relay` Gradle 工程，原 `npm test` 的全局准备会失败。独立 upstream 配置保留所有不依赖该工程的测试，原跨端门槛未修改。SDK 的网络验证使用真实本机 TCP/WebSocket 和模拟手机协议对端，不能代替 Android/JVM、APK 或 DJI 真机测试。
