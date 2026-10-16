# Sky Command SDK

`@xjicloud/sky-command-sdk` 将 Sky-Command 的安卓设备中继封装为独立包。支持 Vue 3.3+、React 18/19、普通 TypeScript 和 Node 20+。提供 ESM、CommonJS 与类型声明，Vue 和 React 是可选 peer dependency。

## 连接方式

```text
Android 指定程序 ── ws://网关机器:8765/relay ── Node 中继
                                                 │
Vue / React ─── ws(s)://控制地址/sdk ───────────────┘
            └── HTTP(S) POST /sdk/mission（航线原始字节）
```

浏览器无法监听 TCP/WebSocket 服务。安卓程序维持原有客户端角色，Node 中继监听 `/relay`；前端使用另一个 `/sdk` 控制端点。`url` 必须配置为控制网关地址。原手机协议仍为 v1，控制协议另有 `version: 1`，二者不能混用。

## 构建与安装

在 Sky-Command 根目录执行：

```sh
npm ci --ignore-scripts
npm --prefix sdk ci
npm --prefix sdk test
npm --prefix sdk run typecheck
npm --prefix sdk run build
npm --prefix sdk pack -- --pack-destination artifacts
```

先创建 `sdk/artifacts`（打包验证脚本会自动创建）。编译直接复用上级项目源码；安装后的包完全独立，无需保留 Sky-Command 仓库。未发布到 npm，使用生成的 tarball 安装：

```sh
npm install /path/to/xjicloud-sky-command-sdk-0.2.0.tgz
# Vue 项目已有 vue；React 项目已有 react。无需同时安装两个框架。
```

## 启动网关

完整示例见 `examples/gateway.mjs`，安装包后可直接运行 `node examples/gateway.mjs`。默认安卓中继端口 8765，控制网关只绑定 `127.0.0.1:8766`。将 `allowedOrigins` 配成实际前端 Origin。

```js
import { createSkyCommandRelay, createSkyCommandGateway } from '@xjicloud/sky-command-sdk/node';

const relay = createSkyCommandRelay({ address: { host: '0.0.0.0', port: 8765 } });
const started = await relay.start();
if (!started.ok) throw new Error(started.error.message);
const gateway = createSkyCommandGateway({ relay, allowedOrigins: ['http://localhost:5176'] });
await gateway.start();
// 退出时依次 await gateway.stop(); await relay.stop();
```

`gateway.stop()` 不停止调用方拥有的 relay。重复 start 返回同一监听地址，重复 stop 可安全调用。手机地址应使用运行网关机器的可达 LAN IPv4，不能填手机自身的 localhost。

网关对外绑定时必须提供 `authorize(request)`；反向代理部署仍须验证 WebSocket 升级及上传请求的 cookie/session 和操作权限。它管理一组受信设备，不提供 XJICloud 的多租户设备归属、用户权限表或 JWT 校验。手机 `/relay` 沿用原工程的受控网络无认证协议；不要将这个手机端口直接公开到互联网。参见 [XJICloud 集成](docs/XJICLOUD-INTEGRATION.md)。

## 基础使用

```ts
import { createSkyCommandClient, jsonFields, toPlainJson, SkyCommandError } from '@xjicloud/sky-command-sdk';

const client = createSkyCommandClient({ url: 'ws://127.0.0.1:8766/sdk' });
const unsubscribe = client.subscribe(snapshot => console.log(snapshot.status, snapshot.relay?.devices));
await client.connect();
const deviceId = client.devices()[0]?.deviceId;
if (deviceId) {
  const result = await client.sendCommand(deviceId, { name: 'telemetry.read', fields: jsonFields({}) });
  console.log(result.status, result.result && toPlainJson(result.result));
}
unsubscribe();
client.dispose();
```

`connect()` 等到第一份合法快照才完成，并合并同时进行的连接调用。`subscribe` 仅通知后续变化，初值用 `getSnapshot()` 读取。快照不可变；设备、遥测与任务阶段均带 `deviceId`，遥测同时带 `sessionId`。SDK 连接状态为 `connected` 表示已连接控制网关；在线手机列表可能仍为空。

`sendCommand` 保留原接口 `{name, fields}`，可另带 `timeoutMs` 与 `onPhotoProgress`。回调不会写入控制报文；`camera.photo.fetch` 的中继进度由网关推回。照片回传应把 `timeoutMs` 设到一小时以内，否则浏览器仍按默认 35 秒放弃等待。fields 为协议 JSON AST。`jsonFields({confirm: true})` 转换普通 JSON；不接受 undefined、NaN、BigInt 或类实例。`toPlainJson(value, 'string')` 把所有数值 token 保留为字符串，适用于超出 JavaScript 安全整数精度的数据。默认数字转换遵循 JavaScript number 精度。

命令结果 `status` 为 `succeeded | rejected | timed-out | disconnected`；任务结果还可能是 `transport-failed`。网络/SDK 层故障抛 `SkyCommandError`，`code` 可用于业务映射。成功的协议结果不等于飞行动作完成，动作终态应交给 `/flight`、`/mission` 的原有业务判定。

默认连接超时 10 秒、控制请求超时 35 秒、任务 HTTP 超时 120 秒；默认最多 10 次重连，延迟从 1 秒倍增至 30 秒。可用 `reconnect: false` 禁用。恢复连接只刷新设备快照，命令和任务绝不自动重发。断线、dispose 或手机 sessionId 改变会拒绝在途请求、清理过期快照。超时、取消上传或浏览器断线可能发生在设备已执行动作之后，需重新查询状态。

## Vue 与 React

```ts
// Vue setup / effectScope
import { useSkyCommand } from '@xjicloud/sky-command-sdk/vue';
const { snapshot, devices, connected, sendCommand } = useSkyCommand(client);
```

```tsx
// React function component
import { useSkyCommand } from '@xjicloud/sky-command-sdk/react';
const { snapshot, devices, connected, sendCommand } = useSkyCommand(client);
```

完整组件见 `examples/VueDevices.vue`、`examples/ReactDevices.tsx`。两者都仅订阅同一客户端：组件卸载解除订阅，连接由应用/container 创建、connect 和 dispose。React 使用 `useSyncExternalStore`，不在 render 或 effect 中隐式创建网络连接。SSR 可创建未连接的客户端，在浏览器挂载后显式连接；服务端不要共享跨用户客户端。Vue 示例的 client prop 应在组件生命周期内保持不变，切换实例时重建组件。

## 模块导入

| 入口 | 能力 |
|---|---|
| 包根 | 远程客户端、快照、JSON 工具、错误与核心类型 |
| `/vue`、`/react` | 框架订阅 |
| `/node` | 安卓监听、浏览器网关及原 RelayLink/NodeTransport |
| `/protocol` | 原手机协议编解码、校验、限制与帧类型 |
| `/relay` | 框架无关中继核心，需传输与定时器端口 |
| `/operations` | 原遥测投影、业务网关；`createSkyCommandOperations(client)` 自动桥接远程客户端 |
| `/device` | 三段链路、能力门禁、配对状态、相机/图传设置与 RelayDeviceSettings 适配器 |
| `/flight` | 危险动作确认、飞行门禁与终态判定 |
| `/mission` | 航线暂存/上传/执行/暂停/恢复/停止及断线协调 |
| `/routes` | 原 KML/KMZ 导入、合格性检查、去重、目录与地图无关预览 |
| `/stream` | 原 RTMP 目标及直播开关业务 |
| `/photos` | 原拍照/照片获取业务与 PhotoInbox 文件端口 |
| `/media` | 原 RTMP/HTTP-FLV 管线与播放器端口，需调用方提供服务/播放器适配器 |

入口按需导入，包根不会装载 Vue、React、ws、Electron 或 Cesium。业务模块直接复用原实现，没有复制另一份源文件。各模块所需端口由调用方组装，参考 [业务组合示例](examples/business.mjs)。配对开始/停止目前由手机操作，网关仅开放 `pairing.status`，与生产适配器一致。

`sendMission(deviceId, {missionId,fileName,bytes,size,sha256})` 只传输字节，不执行航线；需先通过 `/routes` 取得合格 KMZ，然后交给 `/mission` 进行 upload/start 等流程。网关重新验证摘要；原 MissionSender 负责分块、背压、会话身份与结果关联，最大任务 100 MiB。

视频维持独立链路 Android→RTMP 服务→HTTP-FLV→播放器。`/stream` 可下发原有直播命令，`/media` 提供可替换端口；此控制网关不会自动部署媒体服务器、转发视频、提供公网播放地址或启动封存的 WebRTC/WHIP/WHEP。照片回传由 relay 的 `onPhoto` 服务端接收；没有配置 sink 时按原协议拒绝。照片文件存储/下载地址由宿主应用提供。

## 验证

```sh
npm --prefix sdk test
npm --prefix sdk run typecheck
npm --prefix sdk run test:upstream
npm --prefix sdk run verify:package
```

`verify:package` 重新打包、安装到隔离 consumer、检查 ESM/CJS/类型解析，并在实际 Edge/Chromium 浏览器中操作 Vue/React 示例。可用 `SKY_SDK_BROWSER_EXECUTABLE` 指定 Chromium 可执行路径；默认 Windows Edge，也可使用已安装的 Playwright Chromium。

完整执行结果和审查记录见 [VERIFICATION.md](docs/VERIFICATION.md)。默认验证 React 19，设置 `SKY_SDK_REACT_MAJOR=18` 可复现 React 18 验证。

原仓库 `npm test` 仍要求相邻 `MSDK-relay` Gradle 跨端测试工程。`test:upstream` 仅运行不依赖该工程的原单元/契约测试，不能替代 Android JVM、APK 和 DJI 真机验收。
