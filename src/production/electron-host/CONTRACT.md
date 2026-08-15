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
