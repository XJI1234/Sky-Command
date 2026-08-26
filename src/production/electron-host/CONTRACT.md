# Electron 宿主

状态：窗口装配已接线；RTMP 19500 收流后由本机过滤 HTTP-FLV（18080）供飞行页 flv.js 播放。Relay 提示地址与图传 RTMP 主机使用同一块网卡 IPv4。握手等待 15s，命令等待 120s，航线分块传输等待 600s，须长于手机端 DJI 上传/控制超时。手机 DJI 操作超时为 30s，超时会回 `command-result`，操作台应在约 30s 看到失败；120s 只覆盖手机无应答或排队中的遗留 DJI 调用。图传收流等待 20s，推流开始后即可标记播放就绪。

启动方式与 `MSDK-upgraded` 对齐：

```text
npm install
npm run build
npm run desktop
```

`npm run build` 把主进程打进 `electron/main.mjs`，把操作台渲染器打进 `dist/renderer/`。桌面快捷方式运行构建后的 Electron，不再用 `tsx` 直接执行源码。

Relay 监听 `0.0.0.0:8080`。设备页提示与图传 RTMP 主机使用同一块首选网卡：`ws://<首选IPv4>:8080/relay`。渲染进程只通过 preload 白名单短名调用 `DesktopUiGateway`。

宿主在构造 `DesktopApplication` 时必须注入 `hardwareReadiness`：已选首选私网 IPv4 表示 `lanAddressAvailable: true`；生产装配将 `legacyMediaAvailable` 固定为 `true`（经典图传走 node-media-server + HTTP-FLV，不再依赖本机 FFmpeg 可执行文件）；`sessionStableAfterMs` 固定为 15,000。它们只供工作流在旧图传开始和直接飞控请求前做纯预检；不得作为退出条件，不得停止既有图传，不得阻止已存在飞控确认的停止/取消动作。

事故日志写在 `%LOCALAPPDATA%\Sky Command\diagnostics\`：`incident.log` 给人读，`incident.ndjson` 给检索。同一目录的 `relay-events.ndjson` 仍是手机上报原件。日志按链路标记 `phone-pc`（配对/连接）、`uplink`（飞控/航线/设置命令）、`downlink`（图传 RTMP/HTTP-FLV 画面）、`phone`（手机上报），记录配对、命令结局、图传画面，以及操作台拦住未发出的动作。不记录密钥、路径、RTMP URL 或原始异常。连接类事实（SDK/遥控/飞控/飞机/对频）须连续两次快照一致才落盘；`unknown` 不写 WARN，避免遥测闪断误判为多次断连。

## 旧 RTMP 图传

旧图传由 `node-media-server` 收手机 RTMP（`19500`，`gop_cache: true`），本机再拉回该流并过滤掉无图像的 SEI-only 包，在 HTTP 口（`18080`）提供干净 HTTP-FLV：`http://127.0.0.1:18080/live/{deviceId}.flv`。HTTP 写出必须尊重 `drain` 背压，避免 MSE 跟不上时无界堆积。不得再切 HLS，也不得默认拉起 `ffplay`。操作台飞行页用 `flv.js`（`isLive`、关闭 stash buffer）播到本页 `<video>`。推流开始后即可标记播放就绪并附着画面；已附着但长时间未出画，或出画后 `currentTime` 停住，必须软恢复或重挂。停止推流时结束播放附着。

宿主必须在 `app.whenReady` 之前设置 `autoplay-policy=no-user-gesture-required`，避免本页 `<video>` 静音自动播放被 Chromium 策略挡住。

这些限制不改变手机推流或旧 RTMP/HTTP-FLV 端口。

## 低延迟 Electron 适配器（已封存）

低延迟 WHIP/WHEP 旁路代码树保留但生产宿主不装配：不得在 `launch.ts` 传入 `lowLatency`，不得默认启动 MediaMTX，飞行页不提供对应按钮。旧图传是唯一生产路径。`operator-console.evaluate("webrtc-*")` 必须拒绝。

`electron-host/webrtc-ports` 仍提供三个适配器供封存代码树使用，但生产 `launch.ts` 不得接线：

1. `MediaMtxProcess.ProcessPort` 用 `child_process.spawn` 启动独立 MediaMTX 临时配置，配置文件和子进程均为适配器私有资源；`terminate` 幂等，退出事件只报告 `exited` / `failed`。
2. `MediaPathMonitor.MediaPathPort` 只请求回环 `GET /v3/paths/list`，只返回严格合法的 `/live/{encodedDeviceId}`，API 响应、状态码和异常不越过端口。
3. `WhepPlayback.WhepPlaybackPort` 只通过 `BrowserWindow.webContents.send` 给渲染进程发独立播放器指令；主进程接收带代次的首帧/致命事件，旧代次事件必须丢弃。

播放器 IPC 使用固定频道 `webrtc-player-select`、`webrtc-player-clear`、`webrtc-player-ready`、`webrtc-player-fatal`。渲染进程通过 preload 暴露的受限回调接收选择/清理，不能直接访问 `ipcRenderer`。封存适配器保留 recvonly PeerConnection / WHEP offer-answer 行为，但生产飞行页不得订阅或触发这些频道。
