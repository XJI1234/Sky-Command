# XJICloud 集成

## 已核对的项目边界

当前用户端为 `apps/web2`，Vue 3.5、Vite、pnpm workspace；`apps/web` 已弃用。web2 要求 domain port、application 用例、infrastructure 适配器与 presentation 分离，并在 `src/app/create-container.ts` 组装。后端 Spring Boot 3.3 / Java 17，已有用户、管理员、Worker 三类认证与 API 响应契约。

本次 SDK 位于 Sky-Command 内，未修改 XJICloud 的业务代码、API 或 JWT。下面是后续接入方式，不代表 Spring Boot 设备接口已经实现。

## 安装

在 XJICloud 根目录使用产物路径安装到当前用户端：

```powershell
pnpm --filter @xjicloud/web2 add "C:/Users/21544/workspace/Sky-Command/sdk/artifacts/xjicloud-sky-command-sdk-0.1.0.tgz"
```

如果团队使用其他目录，将路径替换为自己的 tarball 位置。包内没有对工作区绝对路径的运行时依赖。

## 前端分层

建议为设备通讯增加独立限界上下文（例如 `features/devices`）：

| 位置 | 职责 |
|---|---|
| domain | 设备实体与 DeviceRepository port，不导入 vue、SDK 或 HTTP DTO |
| infrastructure | 创建 SDK/operations、转换快照、将 SkyCommandError 映射为 DomainError |
| application | 列设备、刷新遥测、导入和执行航线等用例，返回已有 `[error, data]` Result |
| presentation | 注入 container 并订阅 application 状态，按既有方式格式化错误和 i18n |
| app/create-container.ts | 只在此组装客户端与仓库，统一连接和销毁 |

SDK 的 `/vue` hook 是通用组件接入方式。XJICloud 的 presentation 应遵守自己的仓库 port，不能把 SDK DTO、socket 或 HTTP 直接塞到页面中。首次接入先落 infrastructure 适配器和用例，再做页面。

## Node 与 Spring Boot

Spring Boot 无法直接执行 TypeScript SDK。运行一个 Node 中继进程，或在原地面站宿主进程里导入 `/node`。安卓端仍连接 Node 的 `/relay`；云平台前端通过控制网关操作设备。

开发环境：前端 `http://localhost:5176`，控制地址 `ws://127.0.0.1:8766/sdk`。这里的 localhost 必须与浏览器/网关位于同一机器；远程用户访问需实际可达网关地址。

生产环境可在现有 Nginx 中增加独立设备控制路径。以下示例是部署模板，不是已经修改的服务器配置：

```nginx
location /device-control/sdk {
    proxy_pass http://127.0.0.1:8766/sdk;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header Origin $http_origin;
    proxy_read_timeout 180s;
    proxy_request_buffering off;
    client_max_body_size 100m;
}
```

前端 URL 为 `wss://平台域名/device-control/sdk`；SDK 自动使用 `https://平台域名/device-control/sdk/mission` 上传。代理将前缀剥离，Node 接收到的路径仍为 `/sdk`、`/sdk/mission`。HTTPS 页面需要 WSS/HTTPS，不能连接明文 WS。

认证可以通过已有后端认证入口提供同源会话 cookie，再由 `authorize(IncomingMessage)` 或可信反向代理验证。浏览器 WebSocket 不能任意设置 Authorization 请求头；不要把 XJICloud 的用户 JWT 假定成网关已识别的凭据。任务上传需要相同会话；跨源 cookie 场景配置 `credentials: 'include'` 并保留精确 allowedOrigins。网关校验 Origin 不等于用户认证。

网关本身管理一个受信设备集合。多用户云平台仍需由 XJICloud 定义用户与 deviceId 的归属、读写权限、会话撤销与审计。不能只验证“已登录”就把一个共享网关的全部设备暴露给所有用户。可先按设备所属组织隔离网关，再扩展后端授权与快照过滤。

手机协议目前没有鉴权，仅适用于受控网络。异地连接需要受保护的网络/隧道与协议认证配套，SDK 不会自动建立 NAT 穿透。

## 视频与照片

控制连接不承载实时视频。直播命令使用 RTMP URL，该地址必须从安卓端可达；浏览器播放器使用 HTTP-FLV，地址必须从浏览器可达，HTTPS 页面需 HTTPS 分发。`operations.streamGateway` 在云端没有 LAN ingressAddress 事实，RTMP 目标应显式由部署配置提供。

照片字节通过手机协议回传至 Node `onPhoto`。应用负责落盘/对象存储、鉴权下载接口和公开下载 URL。`/photos` 提供现有照片业务与文件端口，不自动创建 Spring Boot 下载接口。

## 集成验收

SDK 已提供独立网络/框架测试。真正接入 XJICloud 后按仓库规则再执行 `pnpm test:web2`、`pnpm build:web2`，若新增后端接口执行 Maven 测试；验证登录、设备归属、断线重连、任务未知结果与媒体播放的真实用户路径。安卓权限、DJI 注册、飞机链路与真实飞行动作需要实际设备验收。
