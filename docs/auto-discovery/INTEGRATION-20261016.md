# 2026-10-16 本地合并验证记录

合并输入：电脑端 `619a63b4b50ae609387c8d2251ca619d59f11117`，手机端 `d9606493af084546c6072b5ccaa42afa6627c749`。本地原改动分别保存在 checkpoint `bce7e6d`、`e38694d`；手机端合并提交为 `cedcb11d`。

电脑端冲突同时保留 DJI 无符号 RTMP 时间戳/FLV 时间线修复和握手前 TCP 断连清理。手机组合根保留原命令身份的照片进度回调；自动发现的连接切换不得将旧请求进度发送到新会话。SDK 0.2.2 从 Node/desktop 公开广播 API，并修正 CommonJS 模块路径；浏览器入口不导出 Node 广播能力。

## 有限集合核对

将合并前两个 checkpoint 的完整 `src` 导出后，使用同一 `SourceFiniteInventory.collect` 对比：旧清单正好匹配 319 项及 `633a503d3412a559d2e1b36369a541db1387b921a1de82180e9d8431e669045a`。合并后 328 项及 `35993e6be7555fb8e3ed46ebe64de7bdfe745f88448899a9de4f21b1bfdfb757`，无删除，唯一已有集合变化是 SessionEndKind 新增 CONNECTION_PAUSED、ENDPOINT_CHANGED。

| 新增/变化集合 | 已核对的行为证据 |
| --- | --- |
| desktop DiscoveryDiagnostic | `tests/relay-discovery.test.ts`：无 WLAN、接口枚举异常、bind/broadcast/send 失败、限频诊断及恢复 |
| mobile ForegroundServiceLifetime.End | `ForegroundServiceLifetimeTest`：STOPPED/FAILED、销毁、启动失败、重复和旧操作事件 |
| mobile RelayConnectionMode | `RelayConnectionControlTest`：AUTO/MANUAL 切换、非法手动地址不打断健康连接、旧来源撤销、失败回滚 |
| mobile DiscoveryReceiverState | `DiscoveryReceiverLoopTest`：WAITING_WIFI、LISTENING、RETRYING、FAILED、网卡变化与退避 |
| mobile AnnouncementParseResult / AnnouncementRejection | `AnnouncementParserTest`：Accepted/Rejected，SIZE/UTF8/JSON/FIELDS/SOURCE 边界与随机输入；地址仅来自报文源 |
| mobile DiscoveryPhase | `DiscoveryCoordinatorTest`：WAITING/OBSERVING/SELECTED/ACTIVE/CONFLICT、到期、重启实例冲突、旧代次与容量限制 |
| mobile ConnectionSelectionResult / SelectionResult | `ConnectionSelectionTest`：输入校验、Changed/Unchanged、重复选择保持退避、旧回调隔离 |
| mobile SessionEndKind 新增值 | `ConnectionSelectionTest`：所有存活状态暂停/切换均释放旧代次；停止/暂停不重复终止已结束代次 |

手机本轮强制执行 107 个 Test 任务，1424 次用例执行（Android Debug/Release 重复计入），0 失败/错误/跳过；Debug APK 和 Manifest 契约构建通过。该源码清单更新不替代状态转换或跨端行为测试。

## 验证边界

本轮电脑端 `npm test -- --maxWorkers=4`：196 个测试文件通过、2049 项通过；另有 1 个验证报告检查依赖 `CROSS_RUNTIME_VERIFICATION_STARTED_AT`，默认运行跳过。`npm run test:types`、`npm run build` 通过；SDK 25 项测试、类型检查和构建通过，15 个公开入口均验证 ESM/CJS 加载。XJICloud 已实际安装新压缩包并运行网关，被动监听收到 6 条有效 UDP 公告，握手前断开 RTMP TCP 后网关仍运行。

XJICloud Web2 168 项测试及 Vite 打包通过；完整 `pnpm build:web2` 仍被合并前既有的 5 处类型错误阻挡（外部 renderer/main.ts 三处、CloudLayout.vue 一处、vite.config.ts 一处）。地图降载 bundle 与合并前 checkpoint 无差异，原 32 航点航线已恢复。

本次合并不安装 APK、不下发飞行命令。手机权限、热点发现、后台生命周期、真实图传和飞行器操作仍需真机验收；历史分支中的实机记录不作为本次验收结果。
