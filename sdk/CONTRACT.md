# Sky Command SDK 契约

目标：将现有 Android 中继能力封装为独立 npm 包，Vue 3、React 18/19 与普通 TypeScript 共用核心。Node 20+ 提供中继监听和浏览器控制网关。手机协议 v1 与原有字节传输保持一致。

结构：`src/client.ts` 管理浏览器控制连接；`src/node.ts` 组合现有 RelayLink 与 NodeWebSocketRelayTransport；`src/vue.ts` / `src/react.ts` 仅订阅客户端；`src/entries` 复用现有业务模块；`tests` 验证真实本机网络、生命周期与错误路径。构建生成 ESM、CJS 和声明，npm pack 产生可安装文件。

接口：createSkyCommandClient({url}) 显式 connect/disconnect/dispose，getSnapshot/subscribe，sendCommand(deviceId,{name,fields,timeoutMs?,onPhotoProgress?})、sendMission(deviceId,payload)、measurePhoneLink(deviceId)。fields 保留现有无损 JSON AST；jsonFields 与 toPlainJson 提供普通 JSON 转换。`onPhotoProgress` 只留在调用端，网关把中继的 listing/downloading/receiving/verifying/saving/saved 进度推回同一请求。`timeoutMs` 为 1 到 3600000 毫秒，同时约束浏览器等待和中继命令。快照不可变且按 deviceId/sessionId 分离。useSkyCommand(client) 不启动或销毁共享连接，仅在框架卸载时解除订阅。

网关：手机连接独立 `/relay`；浏览器连接 `/sdk`；二进制航线经 `POST /sdk/mission` 上传。控制请求携带当前 sessionId；设备会话变更时拒绝旧请求。连接断开清空快照、拒绝在途请求；只重建连接，绝不重试命令或任务。超时表示结果未知，不代表动作未执行。网关限制请求大小、客户端数量与并发，并校验协议字段。

Node 网关默认监听 loopback，显式 allowedOrigins 才允许跨源浏览器；authorize(request) 接入部署侧认证。鉴权与 Origin 校验覆盖 WebSocket 和任务上传。手机端本身沿用原工程受控局域网无认证限制。反向代理可转发 `/sdk` 与 `/sdk/mission`，但不公开原手机端口。

业务模块保持既有职责：flight/mission 的门禁、确认、终态判定不下沉到连接核心；发送成功只代表收到协议结果。地图、Electron、系统设置、封存 WHIP/WHEP 不进入浏览器包。视频走独立 RTMP→HTTP-FLV，SDK 的 stream/media 入口提供现有业务与播放器端口。

验证命令：`npm --prefix sdk install`、`npm --prefix sdk test`、`npm --prefix sdk run typecheck`、`npm --prefix sdk run build`、`npm --prefix sdk pack`。原项目用 `npm test`、`npm run test:types` 检查回归。

Node 与 desktop 入口导出 `createRelayDiscovery`、`loadOrCreateServerId` 与 `DISCOVERY_PORT`，浏览器入口不导入 UDP 或文件系统。宿主仅在中继与控制服务就绪后启动广播，并在关闭中继前停止广播；身份由宿主的数据目录持久化，发现不可用不影响已有手动连接。公告沿用 `src/production/relay-discovery/CONTRACT.md` 与 v1 协议，不新增认证或飞行行为。
