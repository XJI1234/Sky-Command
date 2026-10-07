# 验证与审查记录

日期：2026-10-07。工作区：Sky-Command/sdk。包：`@xjicloud/sky-command-sdk@0.1.0`。

## 已执行

| 检查 | 结果 |
|---|---|
| SDK `npm test` | 4 个文件、20 项测试通过 |
| SDK `npm run typecheck` | 严格 TypeScript 检查通过 |
| SDK `npm run build` / npm pack prepack | ESM、CommonJS、双模块类型声明生成成功 |
| `npm run test:upstream` | 原有 181 个文件、1941 项单元/契约测试通过 |
| 原 `npm run test:types` | 通过 |
| 独立 tarball 安装 | 无源码仓库依赖；基础导入不需要安装 Vue/React |
| 全部 14 个公开入口 | ESM 与 CommonJS 导入成功，根与 Node 入口共享错误类身份 |
| 独立消费方类型 | NodeNext 下 `.mts`、`.cts`、React TSX 和业务 JS 的严格类型检查通过；未关闭声明校验 |
| 业务组合示例 | routes、operations、mission、flight、settings 创建与销毁通过 |
| Edge/Chromium 浏览器 | Vue 3.5 + React 18/19 均完成连接、设备列表、命令结果和手机断线列表清理；无页面异常/console error |

网络测试使用真实本机 TCP/WebSocket 与模拟手机协议对端，复用原 hello/paired/telemetry/command/mission 编解码。任务测试传输 300000 字节并逐字节验证两个原协议块，接收原 mission-result。客户端覆盖请求关联、超时不重试、断线/会话更换、旧 socket 回调隔离、上传取消、凭据等待超时和订阅异常隔离。网关覆盖认证、Origin、摘要错误、过期 session 请求以及鉴权等待中的关闭。

复现浏览器安装验证：

```powershell
# 默认 React 19
npm --prefix sdk run verify:package
# React 18
$env:SKY_SDK_REACT_MAJOR = '18'
npm --prefix sdk run verify:package
Remove-Item Env:SKY_SDK_REACT_MAJOR
```

验证脚本输出 archive 路径，浏览器报告保存在 `sdk/.verification/report-react18.json` / `report-react19.json`，截图在 `sdk/.verification/browser.png`。这些本地文件不打入 npm 包。

## 原默认测试的阻塞

原 `npm test` 的 `cross-runtime-e2e.global-setup` 默认要求相邻 `MSDK-relay/gradlew.bat` 并构建 `:cross-runtime-e2e:relay-test-harness:installDist`。工作区缺少这个项目，准备阶段报 `Invalid test host configuration`。

没有修改原测试或降低它的跨端验收标准。SDK 新增独立 upstream 配置，仅运行不需要该外部工程的原单元/契约测试。Android/JVM 测试、APK 构建、真实安卓连接、DJI 注册、飞机操作、真实航线执行、实际视频/照片链路尚未做本次验收。

## 自我 Code Review

审查范围：新增 SDK 源码、构建与出口映射、网络控制/上传边界、共享生命周期、示例、声明与文档。原生产源码没有被复制或修改，XJICloud 业务代码未变。

审查中已修复：

- 等待异步鉴权的升级连接未被 shutdown 管理：增加握手连接集合与数量限制，关闭时销毁。
- 上传异步凭据提供者卡住导致定时器不能结束调用：用 AbortSignal 约束凭据、fetch 与响应解析的全部等待。
- 每入口独立打包产生多个 SkyCommandError 构造器：共享内部 runtime，验证两个模块格式的 instanceof。
- 遥测缺少 sessionId 时可能误通过归属检查：同时验证活动设备和有效 sessionId。
- connect 状态订阅者立即 disconnect 时可能继续创建 socket：增加生命周期复查与回归测试。
- 示例中 RouteLibrary.create 的 Result 解包、设置适配器参数与 preflight 类型组合：按原接口修正，并在安装包消费方运行/检查。

当前无已知未修复的 High/Critical SDK 缺陷。部署仍须由宿主实现认证、设备所属用户/组织的权限、受保护的手机网络和媒体服务，文档没有将这些能力标为已完成。超时与上传取消后的设备结果可能未知，SDK 不自动重放动作。
