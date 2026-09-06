# Electron 宿主

状态：窗口装配已接线；RTMP 19500 收流后由本机过滤 HTTP-FLV（18080）供飞行页 flv.js 播放。每次图传启动优先使用该手机 WebSocket 实际接入的桌面 IPv4；缺失时才取当前首选网卡，绝不复用启动时已失效的网卡地址。握手等待 15s，命令等待 120s，航线分块传输等待 600s，须长于手机端 DJI 上传/控制超时。手机 DJI 操作超时为 30s，超时会回 `command-result`，操作台应在约 30s 看到失败；120s 只覆盖手机无应答或排队中的遗留 DJI 调用。图传收流等待 20s，推流开始后即可标记播放就绪。

启动方式与 `MSDK-upgraded` 对齐：

```text
npm install
npm run build
npm run desktop
```

`npm run build` 把主进程打进 `electron/main.mjs`，把操作台渲染器打进 `dist/renderer/`。桌面快捷方式运行构建后的 Electron，不再用 `tsx` 直接执行源码。

打包时 `appRoot` 可以是只读的 `resources/app.asar`，因此它只用于定位主进程、预加载脚本和渲染器资源。所有宿主运行时写入都必须在 `app.whenReady()` 后基于 `app.getPath("userData")` 解析：本机 HTTP-FLV 临时根目录是 `userData/tmp-http-flv`，启动日志是 `userData/tmp/desktop-launch.log`。不得在 `appRoot`、`projectRoot` 或 ASAR 内创建目录、写日志或写缓存。

Relay 监听 `0.0.0.0:8080`。每次读取设备页时重新枚举可用网卡，展示当前可填写的 `ws://<IPv4>:8080/relay`；手机已连接后，图传 RTMP 主机以该连接的实际本端 IPv4 为准。网卡切换只影响后续命令，不重启 `19500`、`18080` 或已发布流。渲染进程只通过 preload 白名单短名调用 `DesktopUiGateway`。其中 `device-link-measure` 只映射既有 WebSocket 的协议层 PING/PONG 往返测量，不发送 Relay 业务帧，不调用 DJI、图传、任务或飞行控制，也不写入工作流状态或控制门禁。

宿主在构造 `DesktopApplication` 时必须注入 `hardwareReadiness`：已选首选私网 IPv4 表示 `lanAddressAvailable: true`；生产装配将 `legacyMediaAvailable` 固定为 `true`（经典图传走 node-media-server + HTTP-FLV，不再依赖本机 FFmpeg 可执行文件）。这些桌面事实只供工作流报告旧图传的本机接收条件；不得替代 Relay/MSDK 可达性门禁，不得作为 DJI 设备安全退出条件，不得停止既有图传，也不得阻止已存在飞控确认的停止/取消动作。手机中继连接经过的时间不能替代 MSDK Key 观察。

事故日志写在 `%LOCALAPPDATA%\Sky Command\diagnostics\`：`incident.log` 给人读，`incident.ndjson` 给检索。同一目录的 `relay-events.ndjson` 仍是手机上报原件。日志按链路标记 `phone-pc`（配对/连接）、`uplink`（飞控/航线/设置命令）、`downlink`（图传 RTMP/HTTP-FLV 画面）、`phone`（手机上报），记录配对、命令结局、图传画面，以及操作台拦住未发出的动作。不记录密钥、路径、RTMP URL 或原始异常。连接类事实（SDK/遥控/飞控/飞机/对频）须连续两次快照一致才落盘；`unknown` 不写 WARN，避免遥测闪断误判为多次断连。

`IncidentJournal` 是观察者，接口为 `record(record): void` 和 `flush(): Promise<void>`。`record` 只能做脱敏、格式化和有界内存入队，绝不得在 Electron 主进程同步创建目录或写入文件；单一后台写入器必须保持两份日志的记录顺序。最多保留 512 条等待当前写入器的记录，外加最多一份已摘出、正在异步写入的批次（批次至多 512 条），故任何时刻内存中的未落盘记录不超过 1024 条。容量压力优先丢弃等待队列中最早的低优先级 INFO；新的 INFO 在没有可替换项时被丢弃，新的 WARN/ERROR 必须保留，并在后续日志留下安全的丢失计数。诊断积压不得影响 IPC、WebSocket、媒体接收或 DJI 命令。宿主正常关闭必须按“外壳释放、应用对象图完全释放、`flush` 完成、进程退出”的顺序执行；任一前置释放失败也不得跳过后续应用释放、日志刷出和退出。手机上报原件的确认不依赖此观察日志，而只依赖 `node-diagnostic-store` 异步持久化成功。

关闭序列的每个阶段（外壳释放、应用对象图释放、日志 `flush`）默认最多等待 5 秒，可由受控宿主或测试显式缩短。阶段超时只结束本次等待，不取消底层清理；无论阶段成功、失败还是超时，后续阶段都必须继续尝试。所有阶段均已尝试后，宿主必须调用 `quit()`；若有多个失败或超时，只保留首个结果用于诊断，不能因后续清理异常而跳过退出。

## 旧 RTMP 图传

旧图传由 `node-media-server` 收手机 RTMP（`19500`，`gop_cache: true`），HTTP 口（`18080`）用官方 `NodeFlvSession` **直连发布会话播放器槽位**输出 HTTP-FLV：`http://127.0.0.1:18080/live/{deviceId}.flv`。禁止再对本机 `19500` 做 RTMP 回环拉流。写出路径只过滤无图像的 SEI-only AVC 包，不得因 TCP 背压丢弃普通视频帧。同一 `deviceId` 新附着须停止旧 `NodeFlvSession`。不得再切 HLS，也不得默认拉起 `ffplay`。操作台飞行页用 `flv.js`（`isLive`、关闭 stash buffer，并追直播前沿）播到本页 `<video>`。推流开始后即可标记播放就绪并附着画面；已附着但长时间未出画，或出画后 `currentTime` 停住，必须软恢复或重挂。停止推流时结束播放附着。

HTTP-FLV 输出必须在**单个播放器连接**的 `ServerResponse.writableLength` 到达 `2 MiB` 时停止该 `NodeFlvSession` 并销毁该播放器 socket，释放已积压的媒体字节；这不是按帧降级或丢弃 P 帧。正常可排空的短暂 TCP 背压不改变视频内容。达到上限只终止那个 `deviceId` 的本地播放器会话，现有渲染器恢复机制负责重挂 HTTP-FLV；它不得停止 RTMP 发布者、共享服务、其他设备或手机端 DJI 推流。

HTTP-FLV 的 GET 只在 Node Media Server 当前已登记同一 `/live/{deviceId}` RTMP 发布者时创建 `NodeFlvSession`；没有发布者时必须立即返回 `404`，不得创建上游的全局 `idlePlayers` 等待会话。媒体管线仅在已收到 RTMP 发布事实后向渲染器发放播放地址，因此这条适配器级保护不改变正常的请求顺序；它只限制无源、过期或错误请求不能滞留本地会话。

宿主必须在 `app.whenReady` 之前设置 `autoplay-policy=no-user-gesture-required`，避免本页 `<video>` 静音自动播放被 Chromium 策略挡住。

Node 的端口绑定失败（例如 `EADDRINUSE`）是异步事件，不得因仅调用 `listen()` 就将服务或桌面运行时报告为 `listening` / `running`。生产 RTMP 与 HTTP-FLV 适配器的监听 Promise 只能在实际 `listening` 事件后兑现，必须在绑定错误时拒绝并释放本次适配器私有资源；`media-pipeline` 与 `desktop-runtime` 据此收敛为 `MEDIA_START_FAILED`，不会启动窗口或暴露假可用的图传服务。

这些限制不改变手机推流或旧 RTMP/HTTP-FLV 端口。

## 低延迟 Electron 适配器（已封存）

低延迟 WHIP/WHEP 旁路代码树保留但生产宿主不装配：不得在 `launch.ts` 传入 `lowLatency`，不得默认启动 MediaMTX，飞行页不提供对应按钮。旧图传是唯一生产路径。`operator-console.evaluate("webrtc-*")` 必须拒绝。

`electron-host/webrtc-ports` 仍提供三个适配器供封存代码树使用，但生产 `launch.ts` 不得接线：

1. `MediaMtxProcess.ProcessPort` 用 `child_process.spawn` 启动独立 MediaMTX 临时配置，配置文件和子进程均为适配器私有资源；`terminate` 幂等，退出事件只报告 `exited` / `failed`。
2. `MediaPathMonitor.MediaPathPort` 只请求回环 `GET /v3/paths/list`，只返回严格合法的 `/live/{encodedDeviceId}`，API 响应、状态码和异常不越过端口。
3. `WhepPlayback.WhepPlaybackPort` 只通过 `BrowserWindow.webContents.send` 给渲染进程发独立播放器指令；主进程接收带代次的首帧/致命事件，旧代次事件必须丢弃。

播放器 IPC 使用固定频道 `webrtc-player-select`、`webrtc-player-clear`、`webrtc-player-ready`、`webrtc-player-fatal`。渲染进程通过 preload 暴露的受限回调接收选择/清理，不能直接访问 `ipcRenderer`。封存适配器保留 recvonly PeerConnection / WHEP offer-answer 行为，但生产飞行页不得订阅或触发这些频道。
