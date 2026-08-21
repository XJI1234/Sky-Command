# Electron 宿主

状态：窗口装配已接线；RTMP 19500 / HLS 18080 / FFmpeg 为真实媒体端口。Relay 提示地址与图传 RTMP 主机使用同一块网卡 IPv4。握手等待 15s，命令等待 120s，航线分块传输等待 600s，须长于手机端 DJI 上传/控制超时。图传收流等待 20s，HLS 播放列表等待 45s。

启动方式与 `MSDK-upgraded` 对齐：

```text
npm install
npm run build
npm run desktop
```

`npm run build` 把主进程打进 `electron/main.mjs`，把操作台渲染器打进 `dist/renderer/`。桌面快捷方式运行构建后的 Electron，不再用 `tsx` 直接执行源码。

Relay 监听 `0.0.0.0:8080`。设备页每次刷新都会重新读取本机局域网 IPv4，列出全部 `ws://<IPv4>:8080/relay`。手机填写其中能通的一条。渲染进程只通过 preload 白名单短名调用 `DesktopUiGateway`。

事故日志写在 `%LOCALAPPDATA%\Sky Command\diagnostics\`：`incident.log` 给人读，`incident.ndjson` 给检索。同一目录的 `relay-events.ndjson` 仍是手机上报原件。日志按三条链路标记 `phone-pc` / `uplink` / `downlink` / `phone`，记录配对、命令结局、图传 RTMP/FFmpeg/HLS，以及操作台拦住未发出的动作。不记录密钥、路径、RTMP URL 或原始异常。

## 低延迟 Electron 适配器

低延迟旁路使用独立端口，不改变旧 RTMP/HLS 端口：WHIP/WHEP HTTP 为 `8890`，WebRTC UDP 为 `8189`，MediaMTX API 为 `9997`，path 前缀为 `/live`。宿主向 `DesktopApplication` 传入 `legacyMediaRequired: false`：FFmpeg 缺失或旧 RTMP/HLS 启动失败只能记录旧链路故障，不得让应用退出，也不得阻止用户启动 WebRTC。MediaMTX 可执行文件由宿主独立配置；不存在时只影响低延迟旁路。

`electron-host/webrtc-ports` 提供三个适配器：

1. `MediaMtxProcess.ProcessPort` 用 `child_process.spawn` 启动独立 MediaMTX 临时配置，配置文件和子进程均为适配器私有资源；`terminate` 幂等，退出事件只报告 `exited` / `failed`。
2. `MediaPathMonitor.MediaPathPort` 只请求回环 `GET /v3/paths/list`，只返回严格合法的 `/live/{encodedDeviceId}`，API 响应、状态码和异常不越过端口。
3. `WhepPlayback.WhepPlaybackPort` 只通过 `BrowserWindow.webContents.send` 给渲染进程发独立播放器指令；主进程接收带代次的首帧/致命事件，旧代次事件必须丢弃。

播放器 IPC 使用固定频道 `webrtc-player-select`、`webrtc-player-clear`、`webrtc-player-ready`、`webrtc-player-fatal`。渲染进程通过 preload 暴露的受限回调接收选择/清理，不能直接访问 `ipcRenderer`。

渲染播放器对每个选择创建独立 `RTCPeerConnection`，使用 `recvonly` video transceiver、ICE gathering 完成后 POST SDP 到本机 WHEP URL、设置 answer、收到 `ontrack` 后设置视频源；`loadeddata` 或首个可播放状态才回报 `ready`。更换/清理播放器必须关闭旧 PeerConnection，旧代次回调不得影响当前播放。
