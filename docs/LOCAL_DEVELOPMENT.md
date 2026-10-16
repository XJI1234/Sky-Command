# 独立启动与本次修改记录

日期：2026-10-12。开发分支：`dev/local-startup-20261012`。

## 首次安装

本次使用 Node.js 24.21.0 / npm 11.19.0 完成依赖安装。Electron 默认下载遇到等待，可在当前 PowerShell 会话指定镜像：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
npm ci --foreground-scripts --no-audit --no-fund
npm run build
```

## 以后启动

在本仓库目录的普通 PowerShell 中执行 `npm run desktop`，或执行 `./open-sky-command.cmd`。无需 Codex，也无需重复安装依赖。修改源码后先运行 `npm run build`。

2026-10-14 正式自动连接版本已通过 USB 安装到测试手机。在电脑与手机接入同一可互通 Wi-Fi/热点后，打开手机 Relay 并完成系统授权，再打开电脑程序；顺序可反过来，手机会等待电脑上线。日常不填写 WebSocket 地址，不需要 ADB。手机启动后由前台服务持续等待/监听并保留通知；仅连接 Wi-Fi 不会自行启动 App，强制停止/系统杀进程后应重新打开。本轮热点单手机自动连接、Wi-Fi 重连、短时后台和电脑退出重启已实测；校园网互通、锁屏/划卡/长期后台及多设备未验收，见 [实机记录](auto-discovery/DEVICE-RESULTS-20261014.md)。

正常启动只运行一个电脑实例；源码更新后手动先构建，启动脚本不会因已有构建文件而自动重建。电脑正常退出仍执行既有活动航线处理。

`node_modules/` 保存依赖，`electron/main.mjs`、`electron/preload.cjs`、`dist/` 保存构建输出，这些产物已被 Git 忽略。其他开发者拉取分支后需自行安装、构建。

电脑端需要可用的局域网 IPv4；默认服务端口为 WebSocket 8080、RTMP 19500、HTTP-FLV 18080。Android 联调使用同级 MSDK-Relay 项目；MSDK 示例的 HTTP API 是独立链路。

## 本次修改

- `src/production/electron-host/media-ports.ts`：为握手前断开的 RTMP 客户端初始化空连接元数据，避免 NMS 2.6.6 在清理时访问不存在的 `connectCmdObj` 并导致主进程异常；保留原有会话清理。
- `src/production/electron-host/launch.ts`：在渲染器加载失败时记录具体错误，便于定位启动失败。
- `src/production/electron-host/CONTRACT.md`：记录握手前断开连接的清理约束。
- 本文：记录独立安装、启动方式及验证结果。

验证：依赖安装成功（613 个包）；`npm run build`、`npm run test:types` 和 `git diff --check` 通过；实际启动日志记录 `window ready`；三个服务端口已监听；重复 RTMP TCP 连接并在握手前关闭，没有再出现 `bytesWritten` 异常。未验证无人机图传或飞行操作。

## Git 协作

2026-10-13 起，重新构建后的正式宿主在服务就绪后每秒通过 WLAN 公告 UDP 39082，退出时自动停止；不需要另起发送脚本。39081 仍只供网络探针使用。稳定电脑身份自动保存在应用 userData 的 discovery-server-id，不填写硬件标识或密钥；无 WLAN 或公告失败时隐藏手动调试仍可用。2026-10-14 手机正式接线已完成，并在独立手机热点下验证单手机自动连接。

电脑公告与宿主回归检查运行 `npm test -- --config vitest.discovery.config.ts`，该配置不构建不相关的 Android harness。协议、验证范围和下一步见 docs/auto-discovery/PROGRESS.md。

本次分支基于原始 main 提交 `d13bb23`。后续修改在开发分支中完成并提交记录。分享时推送开发分支，通过 Pull Request 由维护者决定是否合并；main 保留原始提交。本机路径、DJI Key、无线调试配对码、运行日志及依赖产物不放入提交。

提交标题采用 `fix: 中文摘要`、`feat: 中文摘要`、`docs: 中文摘要` 等格式；正文以中文写清问题或目的、具体改动、验证结果与未验证范围。每个提交围绕一个明确目的；已推送的提交不擅自改写。

GitHub 交付清单、安装包交付及分享前检查见 [GITHUB-DELIVERY.md](auto-discovery/GITHUB-DELIVERY.md)。公开源码分支包含必要源码、构建配置、锁文件和通用文档；本机依赖、真实配置及运行数据留在本机。
