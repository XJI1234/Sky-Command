# 自动发现与连接：第一阶段最小方案设计

更新日期：2026-10-14。方案级别：最小方案（MVP）。状态：电脑公告器已接入正式宿主，手机纯 JVM 解析/候选核心、gateway/session 连接选择 API 与独立桥接已完成，均通过自动化测试；独立 Android WLAN 接收适配器已实现并测试，正式 App 权限/前台运行容器接线及现场场景仍待实施/验证。公告参数以 [WIRE-PROTOCOL.md](WIRE-PROTOCOL.md) 为契约，实施进度以 PROGRESS.md 为准。

## 已确定的业务行为

一台 Sky Command 为多个手机提供现有 WebSocket 服务。电脑和手机均连接当前校园 Wi-Fi。手机打开后自动等待发现；电脑不在线时持续低频等待，再次上线后自动连接。手机移除停止按钮是目标；不新增电脑远程停用手机功能，不扩展航线规划或改变原有飞行业务。

## 实现流程

1. 电脑应用启动成功（含 WebSocket 监听成功）后，每秒通过实际 WLAN IPv4 向其子网定向广播及有限广播各发送公告，UDP 39082、512 字节上限；39081 保留给探针。发现网卡独立筛选，不改变已有图传网卡选择。退出开始先停止公告，再执行原退出流程。
2. 手机在 App 打开后启动发现监听。首次所需权限由系统询问，拒绝时显示状态；授权完成后自动继续。
3. 收到符合协议的公告，结合 UDP 来源地址及公告中的服务端口/路径，生成现有格式 `ws://<电脑IPv4>:8080/relay`。路径与端口校验后才能交给现有连接模块。
4. 复用 `hello / paired` 及既有会话机制；只有 WebSocket 握手成功才算连接完成，收到广播本身不是连接成功。
5. 未连接时观察 3 秒，唯一候选才连接，多候选冲突等待，8 秒未收到的 endpoint 过期；已连接保持当前电脑。相同 endpoint 失败沿用现有退避，重复公告不重置退避；无候选/冲突时暂停旧地址重试。gateway/session API 与独立桥接已实现，正式 App 仍待接线。
6. 电脑离线时低频等待。重新连通后同步状态，不重新执行旧命令或续传旧会话资源。

候选状态为“等待权限 → 搜索电脑 → 连接中 → 已连接”；失败返回等待/重试。广播监听、定时器和网络变化回调需有明确所有者及统一清理，不能在每次 Activity 重建时重复创建。

## 生命周期接线设计与约束（待实现）

1. Activity 在可见时请求已有权限，不以 endpoint 为前提；授权后自动启动唯一前台运行容器。拒绝时显示状态，后续授权自动继续；USB 授权沿用现有协调器，不作为发现电脑的先决条件。
2. 前台服务/进程级容器拥有 graph、发现协调器、socket、单调定时器及网络回调；Activity 只订阅状态并重绑权限适配器，不能由容器保留销毁的 Activity。界面退出只注销 UI 监听，真正服务销毁才统一清理。
3. graph 允许无 endpoint 就绪，gateway 保持 STOPPED；设备启动与发现解耦，不能填伪地址或等待电脑时反复注册 DJI。endpoint 更新必须在 session 串行事件序列中清理旧代次并替换配置，保留 deviceId、命令注册及 SDK/图传/任务对象，禁止重放旧操作。
4. Wi-Fi 切换关闭旧监听、清空旧候选并失效旧网络回调；新网络重新绑定并观察。重复网络通知不重建健康会话；无电脑时被动监听与每秒候选检查，不主动扫描或忙重连。
5. 划掉任务卡片不停止服务（清单保持 stopWithTask=false），空 intent 不重建缺失业务图或伪造 RUNNING；进程杀死后再次打开按正常流程恢复。隐藏手动模式显式进入/退出，手动模式暂停自动选择；旧保存地址不覆盖自动发现。

源码已核对 MainActivity、RelayRuntimeHolder、MobileRelayGraph、RelayBootstrapModule 和 RelayForegroundService；以上是接线方向，前台服务对象归属尚未实现。gateway/session 已支持可选 endpoint 和串行选择替换，graph/App 尚未调用。实施检查表见手机仓库 docs/auto-discovery/IMPLEMENTATION.md。

2026-10-13 手机核心已实现为独立纯 JVM `:relay-discovery`（契约位于手机仓库同名模块）。严格解析合法公告并按单调时间选择候选；输出稳定选择令牌，使用网络令牌隔离旧监听，ACTIVE 目标不因候选变化重选。容量限制 32 候选/每候选 8 地址，溢出时停止刷新并隔离 8 秒后从新包重新观察。独立桥接现已组合选择与 paired/断线事件；未来 Android 容器每秒调用桥接 tick 驱动核心 snapshot。核心不拥有 socket、会话退避或 DJI，未被 app 依赖，不能宣称正式手机已自动连接。

2026-10-13 会话扩展已实现：初始 endpoint 可为 null，start 只保留运行意图且无连接/定时器；selectConnection(null) 暂停旧目标，新的 ConnectionSelection 在会话优先事件序列中清理旧代次并替换目标，同一对象幂等且不重置退避。同 URL 的新对象代表新意图；运行容器须按发现令牌稳定映射对象，不能每个公告都创建。合法 paired 在 ACTIVE/业务交付前同步 admit(selection, generation)，拒绝/异常即清理并撤销旧选择；获准时桥接记录激活代次。异步结束事件提供 endedGeneration，只有匹配当前激活代次才通知发现 disconnected，避免同选择重连后旧通知误清除新 ACTIVE。门禁是本地选择检查，不提供认证，不能阻塞或反向调用 gateway 控制；桥接锁顺序现已实现/测试，Android 生命周期仍待设计/接线。接口见手机 connection-session/CONNECTION-SELECTION.md。

2026-10-14 独立 JVM `:app-runtime:discovery-session-bridge` 已实现：桥接持有核心、稳定映射选择并组合 gateway 公开接口；配置先注入 pairingAdmission，再 bind，权限与前台就绪后 start，网络适配器送入带令牌/子网的数据，每秒 tick。桥接的状态锁不跨 session 控制，独立控制锁串行 start/select/stop；门禁只检查本地核心，监听注销在控制锁外，避免互相等待。若旧断线通知延迟，tick 比较已获准代次与非阻塞 session 快照；新代次门禁也先释放旧 ACTIVE 并重新观察，不能借 ACTIVE 幂等绕过新冲突/过期。门禁获准到 session 提交 ACTIVE 的同代次窗口不误判断线。控制部分成功后抛错会使应用缓存失效，后续冲突仍能暂停。桥接关闭撤销门禁、暂停/停止 gateway 并注销监听，不关闭 SDK/graph；正式容器须停止 UDP/计时来源并接入真实服务销毁，Activity 销毁不能关闭桥接。22 项测试覆盖这些边界及 gateway 适配器；模块尚未被 App 依赖，Android 服务所有权及隐藏手动模式切换另行实施。

- 授权后的日常路径是打开 App 自动运行；切到后台或锁屏后由前台服务维持运行，保留 Android 要求的通知。
- 用户已确认划掉任务卡片后仍应运行，电脑退出后仍继续等待；此要求必须在正式 Relay 中实机验收，独立前台探针不覆盖。
- 第一版不做手机开机自启动；不承诺 Android 强制停止或系统杀进程后无条件恢复。
- 手机退出界面不等于停止中继；电脑退出后手机进入等待，因此会有持续监听与耗电，需要低频等待和实际观察。
- 目前运行对象主要由 Activity 和内存中的 RelayRuntimeHolder 保留；现有通知服务返回 START_STICKY 不代表系统重启进程后能恢复完整 DJI/发现对象图，需要单独验证和设计。
- 地址改变时不能关闭并重建整套 MobileRelayGraph，因为它同时持有 SDK、图传和任务相关对象；仅更新 session 的 API 已完成，graph/运行容器接线待实施。
- 正常关闭电脑现有代码会尝试停止活动航线。本次保留该既有行为，不将它改成新设计，也不添加新的飞行指令。

## 实施与验证边界

2026-10-14 模式控制已独立实现为 RelayConnectionControl（手机 discovery-session-bridge 子模块）：gateway 使用稳定门禁路由，模式切换先撤销旧门禁再清理来源/桥接/会话；AUTO 每轮新建桥接，MANUAL 先校验地址、同地址复用意向，返回 AUTO 从新包重新观察。来源按模式代次隔离，清理失败保留句柄并阻止第二来源；门禁不等待控制锁，状态通知在控制锁外。15 项新测试和原桥接 22 项重跑通过。此能力尚未接正式 graph/Android 来源/进程容器，设备对象和业务规则未改动。

2026-10-14 生命周期准备已实现：权限平台使用 applicationContext 观察 USB 和检查权限，Activity 按身份 detach/onDestroy，运行权限用独立注册键与请求令牌隔离取消/重绑/重复结果。解绑使等待收敛 Failed，不保留宿主对象；纯 USB 等待不随界面解绑取消。服务销毁通过终态持有器区分 stopped 与 failed，启动失败不重复发布，无活动操作的空 intent 退出。新增 12 项测试和 App Kotlin 编译通过，完整进程容器/模式控制仍待接线；历史审计中的两个缺口已在此阶段修复，真实权限弹窗与后台场景待实机验证。

2026-10-14 运行接线契约已收敛到配套 Relay `docs/auto-discovery/RUNTIME-CONTRACT.md`（待实施）：AppRuntime 保持权限→服务→bootstrap 顺序，唯一进程容器使用 applicationContext，UI 按宿主 attach/detach；无地址使用稳定身份启动，USB 不阻塞发现。稳定门禁路由器与串行连接控制器独占 gateway，MANUAL 先关闭旧桥接/来源再选择手动地址，返回 AUTO 新建桥接并重新观察；地址/模式改变均保留整个业务 graph，schema 1 不变。停止先禁用来源/门禁，再等 STOPPING 收敛后释放 graph/端口。源码审计发现权限平台尚无 detach、服务非预期 onDestroy 尚未报告 failed，接线时修复；空 intent 不恢复缺失业务图。独立 Android 网络接收适配器已完成；下一步接容器与界面。

| 边界 | 当前状态 / 建议 |
| --- | --- |
| 校园广播送达 | 当前位置两类广播均可达且明显丢包；单播和 WebSocket 握手通过，见 NETWORK-RESULTS.md；重连 Wi-Fi、跨 AP 等未测 |
| 发现协议 | 已固定 v1、消息标识、512 字节上限、serverId/instanceId 与字段校验，见 WIRE-PROTOCOL.md |
| UDP 端口与发送周期 | 已选 39082、每秒定向广播和有限广播；39081 仅用于探针 |
| 首次权限与未发现电脑 | 接线方向已确定：无地址先授权/启动前台容器，gateway 等待候选；待实现 |
| 后台运行 | 前台运行容器唯一拥有发现/graph，Activity 只绑定；契约已确定、接线待实施，锁屏/省电限制待测 |
| 重连与 IP 变化 | 发现负责候选选择，session 唯一负责连接/退避；选择替换/暂停 API 与独立桥接已完成，Android 监听/容器接线待实施 |
| 非预期第二台电脑 | 保持当前连接；未连接多候选等待；候选键、8 秒过期、3 秒观察与容量保护见公告契约 |
| 校园共享网接入 | 已确认：第一版沿用现有未认证 v1 做受控联调；deviceId/公告均不是认证，正式开放前再补可信接入 |
| 广播在其他校园场景不可达 | 当前位置已收到包，不代表一定跨 AP/VLAN 送达；尚未选择不可达时的替代方案 |
| 多手机数量 | 已确认首轮 2 台手机/2 架无人机；生产配置当前 maxConnections=8，不能承诺无限连接。遥控器型号仍待补充 |
| 调试入口 | 已确认保留隐藏手动地址入口，日常连接不能依赖；入口布局和手动模式与发现的协调由实现方案定义 |
| 连接耗时 | 已确认 15 秒验收目标，授权且两端服务就绪开始计时；超时记为失败并继续等待，不保证所有校园场景必达 |
| 对频迁移 | 核对同事的分支与接口，避免重复工作 |

2026-10-14 接收来源实现：手机新增独立 Android WLAN 适配器，只提供 NetworkCallback/LinkProperties、按 WLAN 绑定的 UDP socket、MulticastLock 和每秒 tick，不拥有发现策略、session 或 DJI。重复链路通知保留 socket，链路变化先关闭旧来源并推进网络令牌；513 字节缓冲拒绝超长包，按实际长度复制，最多 64 个待交付包，错误按 1/2/4/8 秒退避。20 项测试及 Android 编译通过；真实手机接收、后台和正式 App 接线尚未验证。模块契约位于配套 Relay `src/modules/relay-discovery/android-discovery-adapter/CONTRACT.md`。

## 后续改进方案（不属于当前实现）

如果最小方案受实际网络限制，再讨论 DNS-SD/mDNS、受控发现服务、手机主动查询或其他网络部署方式。mDNS 同样可能被校园网过滤，不是天然保证可达的替代方案。

多电脑选择、完善的可信接入、自动恢复进程、电脑远程停用手机、跨网段发现等需要独立需求、契约和验收，不在本次草案中默认为已批准。

2026-10-14 graph 接线准备：MobileRelayGraph.create 接受 Context 后统一取 applicationContext，空 endpoint 交给既有 gateway 等待能力，SessionPairingAdmission 由调用方注入。旧手动调用继续兼容；正式来源/唯一控制器及进程容器尚未接线。长期对象已脱离 Activity 上下文，停止仍需等待 runtime 与前台服务各自终态后释放端口/执行器，初始化失败回滚亦待实现。

2026-10-14 正式 graph 接线：App 依赖接收适配器和连接桥接，gateway 创建初始 endpoint=null，稳定门禁来自 graph 内唯一 RelayConnectionControl；bootstrap 的 start/stopGateway 只调用该控制器。Android 来源 start 时才创建接收器，透传网络代次/子网/包/tick，仅 FAILED 停止控制，Wi-Fi 等待/重试保留来源内部恢复。graph 的模式接口只切换连接选择，不重建业务对象；原非空地址入口兼容 MANUAL。进程容器及停止/初始化收敛待实现，38 项 App 回归不能替代现场验收。

2026-10-14 graph 生命周期收敛已完成：close 先永久撤销连接来源/门禁，再等待在途 start/stop/模式操作返回并请求 AppRuntime.stop；runtime 和 ForegroundServiceController 均为 STOPPED/FAILED 后才释放注册、Android 端口及执行器。两路状态通知驱动检查，不阻塞 UI 或服务回调；重复 close 幂等。组装过程中逐项登记已创建资源，失败逆序清理、保留原始错误与清理异常，成功才转移所有权；部分安装的状态注册也会解绑。新增停止 7 项（含真实 AppRuntime 延迟服务回调）、回滚 4 项，完整 App 98 项通过。全仓离线 test 与 assembleDebug、清单检查成功：JVM 718 项，Android Debug/Release 各 344 项报告零失败/错误/跳过（包括 App 98 项；部分既有模块 UP-TO-DATE）。新 Debug APK 已生成且保持忽略，未安装，未做现场权限/后台/15 秒验收。下一步进程容器与无地址 UI；已在本机远端引用 origin/xing-20261012 找到同事对频迁移 a607399，UI 前先核对该已有修改，避免重复实现。
