# 本次任务进度与待办

更新日期：2026-10-14。当前阶段：正式电脑公告、手机纯 JVM 公告解析/候选核心、gateway/session 连接选择 API 与发现到会话桥接已实现并通过自动化测试；独立 Android WLAN 接收适配器已完成；正式 App 权限/前台运行容器接线及全链路实机验收尚未完成。

## 已完成：开发环境基线

2026-10-14 新完成设计阶段：配套 Relay `efb6b38` 新增 RUNTIME-CONTRACT.md，明确唯一进程容器/applicationContext、Activity detach、无地址权限恢复、AUTO/MANUAL 独占及稳定门禁、schema 1 和停止收敛。已交叉核对入口及权限/服务平台源码；发现 Activity 强引用与服务非预期销毁缺少 failed，列为待修复。此阶段仅文档，未运行新测试或构建/安装 APK；已有 142 项报告不作为接线证据。独立 Android Wi-Fi 接收适配器随后完成，接下来容器/UI/实机验收。

- [x] 三个仓库已克隆并保留各自原始 main。
- [x] Sky Command 依赖安装、构建、独立启动已完成。
- [x] 修复 RTMP 握手前断开导致主进程崩溃；实际重试检查通过。
- [x] Sky Command 构建、类型检查与差异格式检查通过。
- [x] Relay APK 编译、通过无线 ADB 安装并打开小米 10 主界面完成。
- [x] 本地中文提交记录已建立；尚未推送 GitHub。
- [x] 已定义 GitHub 源码分支、安装包及本机文件的交付范围，补充本地配置/签名文件/产物的忽略规则；见 GITHUB-DELIVERY.md。

这些是自动发现任务的环境基线，不代表自动发现已经实现或验收。

## 已确定：本次需求

- [x] 一台电脑、多个手机/无人机。
- [x] 电脑与手机都无线连接当前校园 Wi-Fi。
- [x] 采用最小方案：自动发现、自动连接、电脑离线低频等待和上线重连。
- [x] 日常手机免填地址、免点连接；首次系统权限确认例外。
- [x] 计划移除手机停止按钮；不新增电脑远程停止手机功能。
- [x] 不扩展航线规划，不修改既有航线、飞行及退出处理。
- [x] 保持当前电脑连接；未连接且发现多个候选时显示冲突并等待。
- [x] 第一版沿用现有未认证 v1 做受控联调，正式开放前再补可信接入。
- [x] 首轮验收规模为 2 台手机/2 架无人机；目前仅完成 1 台手机网络实测。
- [x] 后台、锁屏及划掉任务卡片后继续运行；电脑退出后等待，保留前台通知；不做开机自启/强制停止后的自行恢复承诺。
- [x] 保留隐藏手动地址调试入口，主界面不保留停止中继按钮。
- [x] 已授权且两端服务就绪后 15 秒内连接为验收目标；超时记录失败并继续等待。

## 待完成：按依赖顺序推进

- [x] 恢复手机无线 ADB，核对当前 IP/连接端口。
- [x] 准备独立 UDP 测试 App 与发送脚本，限定为网络探针，不触发 DJI 功能；离线构建、无线安装完成。
- [x] 当前校园位置三轮单播/定向广播/有限广播实测；记录接收序号、时间和发送源，结果见 NETWORK-RESULTS.md。
- [x] 手机独立探针直连电脑 WebSocket，验证二进制 hello/paired 并正常关闭测试会话。
- [ ] 补充 Wi-Fi 重连、跨 AP、电脑 IP 变化和多手机场景；当前单地点前台结果不能替代这些验证。
- [x] 确定公告 v1、512 字节、UDP 39082、1 秒双广播、3 秒观察/8 秒过期与身份/候选规则，见 WIRE-PROTOCOL.md。
- [x] 确认后台/锁屏与划掉任务卡片的行为、隐藏调试入口及连接耗时目标。
- [x] 核对正式手机源码并确定无地址授权、前台运行容器唯一归属、网络代次、只切换 session 的设计方向；session API 已完成，权限与前台容器契约已确定、接线待实施，见 DESIGN.md 和手机 IMPLEMENTATION.md。
- [x] 更新 electron-host 与 relay-discovery 契约并实现正式电脑周期公告、持久身份、网卡刷新、失败重试及退出清理。
- [x] 实现手机纯 JVM 公告解析/候选核心；严格字段/来源校验、观察/过期、冲突与容量恢复、ACTIVE 保持和网络/选择令牌隔离通过 34 项测试。
- [x] 扩展 gateway/session 契约/API：可选初始地址、暂停旧目标重试、串行替换、稳定选择身份、ACTIVE 前同步门禁与结束代次通知；自动化回归和 App Kotlin 编译通过。
- [x] 定义并实现独立 JVM 发现到 session 桥接：稳定选择映射、同步门禁、实际代次校正、延迟结束通知与锁顺序；22 项测试通过，正式 App 尚未依赖。
- [x] 确定无地址权限与前台运行容器契约、模式独占及停止收敛，见手机 RUNTIME-CONTRACT.md（接线待实现）。
- [x] 实现独立 Android WLAN/UDP 接收适配器：20 项新测试、Android Kotlin 编译通过；Lint 缺少离线依赖未执行，正式 App 未依赖。
- [ ] 接入正式 App 运行容器、graph、权限 detach、服务异常销毁及自动连接。
- [x] 完成权限宿主 detach/onDestroy、请求代次隔离及服务非预期销毁 failed（Relay `d127e9d`）；完整容器/graph 接线仍未完成。
- [x] 独立实现 AUTO/MANUAL 唯一连接控制器与稳定门禁路由（Relay `9c80393`）；新增 15 项测试、桥接共 37 项重跑通过，正式 App 尚未依赖。
- [ ] 调整手机界面并与对频迁移分支协调。
- [ ] 验证手机先开、电脑先开、电脑重启、IP 变化、多手机、Wi-Fi 切换和锁屏。
- [ ] 分仓库提交中文变更与验证结果；最终推送开发分支并整理 PR。

## 验证证据与当前限制

2026-10-14 模式控制阶段：新增纯 JVM RelayConnectionControl、DiscoverySourceFactory/SourceSink 接缝，具备自动/手动排他、旧来源隔离、门禁先撤销、清理异常保留资源和停止重启；不创建 Android/DJI 对象、不关闭 graph、不存储地址。15 项新测试连同原桥接 22 项共 37 项重跑通过，发现核心 34 项已有报告 UP-TO-DATE，共 71 项零失败/错误/跳过。Gradle 自动权限审核首次超时，按工具说明重试后运行成功。正式 App、Android 来源包装与进程容器尚未接线；没有新 APK/安装或后台/15 秒验收。

2026-10-14 生命周期准备阶段：新增 12 项行为测试，替换 1 项与异常销毁契约相反的源码字符串断言；权限适配器 24 项、服务适配器 18 项，加上运行时/权限/服务核心 14 项报告，共 56 项零失败/错误/跳过。最后一轮服务适配器测试重跑，权限与核心报告 UP-TO-DATE；正式 App Kotlin 编译通过。修复了新代码泛型及测试类型推断编译错误。未构建安装 APK，完整模式/进程容器/无地址启动仍待实施；真实权限弹窗、界面重建和后台等未验收，Lint 沿用缺少离线依赖的限制。下一步实现模式门禁与唯一连接控制，再接 graph/applicationContext 和进程容器。

2026-10-14 独立 Android 接收阶段（Relay `282136c`）：新增 WLAN 网络观察/UDP 39082 接收、IPv4 子网交付、网络换代、每秒 tick、64 包上限、错误退避与关闭/回滚。20 项新测试（15 项生命周期、5 项数据/真实本机 UDP/资源回滚）零失败/错误/跳过；Android Kotlin 编译通过。发现核心 34 项、桥接 22 项既有测试报告 UP-TO-DATE，共 76 项报告通过；没有重跑已有 56 项。离线 Lint 因未缓存 com.android.tools.lint:lint-gradle:31.7.0 未执行。正式 App 未依赖该模块，未构建/安装 APK，真实 WLAN 广播/跨 AP/后台/两手机及 15 秒验收仍未完成。模块契约和具体命令见手机 README。

| 项目 | 当前结论 |
| --- | --- |
| 桌面独立启动 | 先前实测 window ready；依赖和构建产物保存在本机 |
| Relay 安装打开 | 先前无线 ADB 安装成功；尚未验证 DJI 注册及飞机连接 |
| 当前电脑 WLAN | 已按本机 IPv4/掩码计算候选广播地址；具体值留在本机 START-HERE.md，不是协议常量，也未证明网络可达 |
| 当前手机在线状态 | 2026-10-13 无线 ADB 已连接；独立网络测试 App 已安装，测试结束后已停止 |
| 校园 UDP 广播 | 当前位置三轮：定向广播 8/20、11/20、15/20；有限广播 12/20、14/20、10/20，均可达且丢包明显 |
| 手机到电脑网络 | 单播三轮均 20/20；独立手机探针已完成现有 hello/paired，不代表 Relay 与 DJI 全链路已验收 |
| 正式电脑公告 | 已接入成功启动/退出流程；独立测试配置通过，含真实 UDP 回环，不代表手机收到校园广播 |
| 手机发现核心 | 纯 JVM 34 项测试通过；正式电脑编码器与手机样例一致；尚未接入 App/UDP/gateway |
| 手机自动连接功能 | 未实现；正式 UDP 39082 校园收包、hello/paired 与 15 秒目标尚未验收 |
| 后台/锁屏 | 尚未实机验收 |

## 已有提交

- Sky-Command：d6cb5a3，RTMP 修复、启动诊断及说明。
- MSDK-Relay：4f86996，本地构建、安装及配置记录。
- MSDK：0a55430，独立示例配置记录。

以上均在本地 dev/local-startup-20261012 分支。本文档阶段会新增中文文档提交；最新编号以各仓库 git log 为准。工作区父目录 START-HERE.md 和 AGENTS.md 为本机文件，不属于任何子仓库，不能声称已随子仓库提交到 GitHub。

本次网络探针与实测文档会分别新增两端中文提交；最新编号以各仓库 git log 为准。本机原始网络日志与发送记录已被忽略，不上传 GitHub。

## 2026-10-13 本轮推进记录

- Sky-Command `bba5d3b`：固定公告 v1 与生命周期接线设计，同步 TASK/DESIGN/PROGRESS。
- MSDK-Relay `4ef064b`：提交手机实施检查表与配套索引；正式 Android 运行源码未改动。
- 电脑实现位于 src/production/relay-discovery，正式宿主启动成功后发送，退出前停止；身份只写 userData，未提交生成身份或构建产物。无 WLAN 和错误诊断按固定码限频，不记录 UUID/原始异常。
- 最终验证：`npm test -- --config vitest.discovery.config.ts` 的 4 个文件/21 项测试全部通过（含真实 UDP 回环、公告格式、网卡筛选、周期重复、IP/掩码替换、无网等待、错误恢复、迟到回调、身份持久化和已有宿主回归）；`npm run test:types`、`npm run build`、`git diff --check` 通过。
- 原默认 Vitest 配置先构建 Android 跨运行时 harness，因该构建失败未执行本轮测试；新增独立公告/宿主回归配置以隔离不相关依赖。沙箱内首次 Vitest 遇到 spawn EPERM，按权限机制在沙箱外运行，未将其作为功能失败。
- 未执行本轮正式桌面 GUI/手机安装或现场收包；真实 UDP 回环只验证 Node 发送适配器。本轮没有 DJI/航线/飞行代码修改，没有推送 GitHub。

## 2026-10-13 手机核心推进记录

- 对应手机源码提交：MSDK-Relay `57238ed`（feat: 实现手机公告解析与候选选择核心），位于 dev/local-startup-20261012；本仓库同步共同 TASK/DESIGN/PROGRESS 与公告契约，不重复保存手机源码。

- 手机新增纯 JVM `:relay-discovery`，先写模块契约并更新根契约/Gradle 模块登记，再实现 AnnouncementParser 与 DiscoveryCoordinator；未改动 Android app、session、DJI 或飞行业务源码。
- 解析上限 512 字节，严格 UTF-8、JSON 唯一对象/重复字段/尾随内容、字段类型/范围及来源地址；接收子网用于识别定向广播。双广播与多地址去重、3 秒观察、8 秒过期、多电脑冲突与容量隔离；稳定选择令牌不因重复公告刷新，旧网络/过期/冲突/换地址令牌不得激活。
- 最终 `:relay-discovery:test` 离线构建成功，JUnit 报告为 12 项解析 + 22 项协调，共 34 项、零失败/错误；包含 2000 个随机报文、3000 步事件和 100 轮并发激活/冲突对照。运行依赖报告仅 Kotlin/JVM、Jackson，无 Android/DJI。
- 调用电脑现有 encodeAnnouncement，输出与手机 relay-discovery/src/test/resources/announcement-v1.json 逐字比对一致，随后 JVM 使用该样例解析。初次 Gradle 缓存锁及 tsx 子进程被沙箱拒绝，按权限机制在沙箱外验证成功；没有下载/重装依赖。
- build/ 下 JAR 与测试报告保持忽略；未构建/安装新 APK、没有正式校园 UDP 39082 收包或后台/多手机/15 秒验收，不把核心通过等同于自动连接完成。

## 2026-10-13 会话连接选择 API 推进记录

- 对应手机源码提交：MSDK-Relay `494ffb4`（feat: 支持会话连接选择与无地址等待），位于 dev/local-startup-20261012；本仓库同步 TASK/DESIGN/PROGRESS 与共享协议。
- 手机 gateway/session 完成可选初始 endpoint、稳定 ConnectionSelection 身份、selectConnection 暂停/替换及 connectionSnapshot。相同选择不重置指数退避；null 等待期间无 transport/定时器，stop 撤销运行意图；切换仅清理会话，保留命令注册与业务对象。
- 合法 paired 在 ACTIVE 前执行同步本地门禁，拒绝/异常即清理、撤销选择且不交付业务帧；获准时提供实际 generation，结束事件携带 endedGeneration，覆盖同一选择重连后迟到旧通知。MobileRelayGraph 仅补新结束原因的诊断文字，未调整生命周期、飞行、航线或对频业务。
- 新增 21 项连接选择测试和 4 项 gateway 测试；最终 8 模块报告共 167 项，零失败/错误/跳过：session 69、gateway 10、transport 14、command 13、mission 14、outbound 10、discovery 34、endpoint-settings 3。本轮重跑前 6 模块 130 项，后 2 模块 37 项 UP-TO-DATE；`:app:compileDebugKotlin` 和差异格式检查通过，离线使用既有依赖，报告/缓存保持忽略。
- 正式 App 尚未接入发现选择映射、UDP 或无地址前台运行容器；未构建/安装 APK，未做正式校园 39082 收包、后台/锁屏、2 手机/2 无人机或 15 秒验收。本轮没有推送 GitHub。

## 2026-10-14 发现到会话桥接推进记录

- 对应手机源码提交：MSDK-Relay `6218023`（feat: 实现发现核心到会话的运行桥接），位于 dev/local-startup-20261012；本仓库同步 TASK/DESIGN/PROGRESS 与公告协议，尚未推送。
- 新增独立纯 JVM `:app-runtime:discovery-session-bridge`，先写契约并登记模块，再实现核心持有、稳定 ConnectionSelection 映射、gateway 公开适配器及统一关闭。没有 Android/DJI/socket/线程/定时器，正式 App 尚未依赖；初始地址为空，授权与前台就绪后由未来容器调用 start，每秒 tick 驱动观察/过期。
- 桥接控制锁串行调用 session，状态锁不跨控制/注销调用；同步门禁不获取控制锁。记录实际获准代次，迟到旧结束事件不能清理新 ACTIVE；新尝试和 tick 能识别真实断线并重新观察，不因旧 ACTIVE 或通知滞后跳过冲突/过期。同代次门禁提交窗口不误判断线；选择控制调用前撤销应用缓存，适配器部分成功后抛错也能在后续冲突时暂停。
- 新增 22 项测试：真实 ConnectionSession、gateway 适配器、重复公告保留退避、候选冲突/过期、换地址/网络、健康 ACTIVE 保持、旧断线通知、门禁提交窗口、冲突和关闭各 30 轮并发、监听注销及控制失败收敛。最终 5 模块共 142 项报告零失败/错误/跳过（桥接 22、发现 34、session 69、gateway 10、app-runtime 7）；本轮重跑 22 项，其余 120 项及 App Kotlin 编译检查为 UP-TO-DATE。差异检查通过，离线使用既有依赖，没有重装或下载。
- 本轮修正了新代码返回类型/测试字段的编译错误，以及测试 transport 未实现幂等关闭的问题；最终测试通过。初次沙箱拒绝用户级 Gradle 缓存锁，按权限机制在沙箱外离线验证。报告/缓存/JAR 保持忽略，不提交日志或产物。
- 尚未修改正式 App 权限/服务/界面，没有构建/安装新版 APK，没有正式 39082 收包或后台/锁屏/两手机两无人机/15 秒验收，也未修改飞行/航线/对频或推送 GitHub。

下次接续：先读 TASK.md、DESIGN.md、WIRE-PROTOCOL.md、NETWORK-RESULTS.md 和本文；无地址权限、前台运行容器与 settings 接线契约及独立 Android WLAN 接收适配器已完成；下一步实现 graph/applicationContext、权限 detach、稳定模式门禁与唯一连接控制，再接进程容器/服务失效/界面。按 BROADCAST-TEST.md 补齐现场网络场景，不把 JVM 桥接测试或探针当成正式功能验收。

## 2026-10-14 graph 接线准备

- 对应手机提交：MSDK-Relay `0e8eaf1`（refactor: 为自动连接准备应用级运行图入口），开发分支未推送。
- 已完成 applicationContext 长期对象、可空初始 endpoint 与 gateway 同步握手门禁注入；MainActivity 仍使用既有手动启动，正式自动连接尚未完成。
- `:app:compileDebugKotlin` 与定向 `:app:testDebugUnitTest` 通过；graph 契约 17 项、Bootstrap 14 项共 31 项，零失败/错误/跳过。首次回归的旧 Activity 调用断言已同步为应用上下文，重跑通过。
- 未构建/安装 APK，未进行真实权限、WLAN/后台/两手机/15 秒验收。下一步 Android 来源包装与唯一控制接线，然后停止收敛、进程容器和 UI。
