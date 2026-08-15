# Sky Command 电脑端程序总契约

**文档用途：** Sky Command 电脑端重构的唯一模块地图和验收依据
**当前版本：** v1
**状态：** 待审阅
**适用范围：** `D:\Desktop\Sky Command` 中的新电脑端项目

> 这份文档回答三个问题：电脑端负责哪些业务、这些业务分给哪些模块、模块之间允许怎样协作。
> 手机端总契约见 [`../MSDK-relay/CONTRACT.md`](../MSDK-relay/CONTRACT.md)。两份文档共同覆盖整个系统；任何一端新增业务能力，都必须先更新对应根契约的业务覆盖检查表。

已有的一级模块契约：

- [`src/modules/app-shell/CONTRACT.md`](src/modules/app-shell/CONTRACT.md)
- [`src/modules/route-library/CONTRACT.md`](src/modules/route-library/CONTRACT.md)

---

## 1. 一句话定义

电脑端是操作员使用的地面站程序。

它负责界面、三维地图、外部生成航线文件的导入与预览、向手机端下发操作命令、接收并播放飞行器视频，以及在操作前告诉用户为什么某个操作不可用。

电脑端不直接连接 DJI 设备。所有设备侧动作都必须通过手机端中继完成。

---

## 2. 电脑端能做什么

电脑端必须支持以下能力：

1. 作为服务端接受手机端中继连接，并管理多台手机的会话。
2. 显示电脑、遥控器、飞行器三段链路状态，并发起遥控器与飞行器配对。
3. 读取并持续显示手机端遥测，包括连接、飞行状态、电量、位置、直播和任务状态。
4. 导入 Wayline 项目或其他外部工具生成的 KML/KMZ 文件，在三维地图上预览，并管理多条航线；只有合格 KMZ 可进入执行链路。
5. 把已导入的 KMZ 航线文件交给手机端，并驱动上传、开始、暂停、恢复和停止。
6. 下发起飞、降落、返航等直接飞行动作，并在执行前要求用户确认。
7. 读取和修改遥控器图传参数与相机参数。
8. 让飞行器把视频推送到电脑端，并在界面上播放。
9. 在操作不可用时给出具体原因，而不是显示一个无反应的按钮。

这些能力分别属于以下一级模块：

| 一级模块 | 唯一职责 |
| --- | --- |
| `app-shell` | Electron 进程生命周期、窗口、渲染进程装载和模块组装 |
| `desktop-settings` | 本地设置的保存、读取、迁移和校验 |
| `relay-link` | 与手机端的唯一 WebSocket 通道，收发协议帧，分发命令和结果 |
| `device-console` | 设备连接、配对、设备参数和操作可用性的界面业务 |
| `geo-map` | 三维地图引擎适配、底图和本地城市模型 |
| `route-library` | 航线文件导入、合格性判定、目录管理和预览模型 |
| `mission-control` | 航线任务阶段、起飞前门禁和任务命令调度 |
| `flight-control` | 直接飞行动作的确认与下发 |
| `media-pipeline` | 接收飞行器视频、转码、本地分发和播放 |
| `live-stream-control` | 直播协议配置与直播开关命令 |

模块之间只通过公开接口协作。`relay-link` 不得包含任何飞行业务语义；业务模块不得自己创建 WebSocket、不得自己启动 FFmpeg、不得自己读写设置文件。这样更换网络库、地图引擎、转码器或界面框架时，不需要同时修改所有模块。

### 2.1 模块拆分原则

一级模块代表一个完整的业务职责，二级模块代表该职责内部一个可以独立理解、独立测试和独立替换的工作单元。

每个二级模块都必须满足：

- 有一个明确的负责人：它只对一类结果负责；
- 有一个小而稳定的外部接口：调用方不需要知道内部类、进程、DOM 或第三方库；
- 有明确的输入、输出、前置条件、失败方式和生命周期；
- 有自己的模块契约文件，先写契约再写实现；
- 不直接访问兄弟模块的内部状态，只使用对方公开的接口；
- 不重复保存另一模块已经拥有的状态；
- 可以用内存替身或纯 Node/浏览器无关测试验证主要业务规则。

不要为了追求"模块数量多"而拆分。只有当一个职责满足以下条件之一时才建立二级模块：

1. 存在不止一个真实调用方，并且它们需要同一稳定接口；
2. 存在至少两个真实适配器，需要在同一个 seam 上替换；
3. 该行为可以通过独立接口完成有业务价值的契约测试，而不是只转发另一个模块的调用。

实现文件较长、使用了第三方库或便于分类，都不构成新增模块的理由。简单的纯函数留在所属二级模块内部。

### 2.2 电脑端二级模块地图

下面的名称是电脑端重构的规范名称。实现时目录名和契约文件名必须一致；每个二级模块目录都必须先创建 `CONTRACT.md`。

#### `app-shell`

| 二级模块 | 只负责 | 明确不负责 |
| --- | --- | --- |
| `process-lifecycle` | 单实例锁、启动顺序、退出顺序和资源释放 | 不实现任何业务规则 |
| `window-manager` | 创建窗口、聚焦已存在窗口、应用内容安全策略 | 不决定窗口里显示什么业务数据 |
| `renderer-host` | 装载渲染进程，失败时清缓存并有限次重试 | 不解释业务错误 |
| `runtime-paths` | 解析数据目录与运行期路径，隔离打包与开发环境差异 | 不决定文件内容格式 |
| `ipc-bridge` | 用白名单方式把主进程能力暴露给渲染进程 | 不实现业务逻辑，不提供通用转发入口 |

`app-shell` 是组合根。其他模块不得反向依赖 `app-shell`，也不得自己读取 Electron 全局对象、`process.argv` 或 `app.getPath`。

`ipc-bridge` 只能暴露显式列举的方法，不得提供 `invoke(channel, args)` 这类通用通道。

#### `desktop-settings`

| 二级模块 | 只负责 | 明确不负责 |
| --- | --- | --- |
| `settings-store` | 原子写入、读取、版本迁移和损坏文件恢复 | 不解释设置对业务操作的影响 |
| `network-settings` | 局域网监听地址、手动 IP 覆盖和私网地址合法性 | 不建立网络连接，不枚举网卡 |
| `map-settings` | 地图底图源与凭据配置的保存和合法性 | 不装载地图，不发起地图请求 |

`desktop-settings` 不得依赖 `relay-link`、`media-pipeline` 或 `geo-map`。它只提供已校验的设置值。

#### `relay-link`

| 二级模块 | 只负责 | 明确不负责 |
| --- | --- | --- |
| `protocol-core` | 消息帧模型、编码、解码和协议字段校验 | 不建立网络，不访问文件系统，不理解飞行业务 |
| `relay-server` | 监听、握手、会话代次、替换旧会话和关闭码 | 不解释命令语义，不执行业务规则 |
| `device-registry` | 保存当前已连接手机的 `deviceId` 和会话归属 | 不保存遥测内容，不保存任务状态 |
| `command-tracker` | 命令 ID 关联、超时判定和断线时拒绝全部等待中命令 | 不实现具体命令，不重试业务操作 |
| `telemetry-intake` | 接收遥测帧、按 `deviceId` 暴露最新只读快照 | 不推导业务可用性，不渲染界面，不自己下发命令 |
| `mission-sender` | 分块发送任务文件、流式摘要、背压和传输中断检测 | 不解析 KMZ 内容，不决定是否上传 |

`relay-link` 是电脑端唯一的手机通信入口。任何业务模块都不得直接依赖 WebSocket 库。

`protocol-core` 与手机端 `relay-gateway/protocol-core` 是同一份协议的两端实现，必须保持字段、限制、错误码和状态机完全一致。协议的唯一定义见 [`../MSDK-relay/relay-gateway/protocol-core/CONTRACT.md`](../MSDK-relay/relay-gateway/protocol-core/CONTRACT.md)。任何一端单方面修改协议都是违约。

`mission-sender` 必须在传输过程中重新确认会话身份。传输期间发生重连时，旧传输必须中止，不得把字节继续写进新会话。

#### `device-console`

| 二级模块 | 只负责 | 明确不负责 |
| --- | --- | --- |
| `link-chain` | 从遥测推导电脑→遥控器→飞行器三段链路状态 | 不发起连接，不保存遥测原始帧 |
| `pairing-controller` | 发起配对开始/停止/查询，并维护进行中互斥 | 不判断飞行器型号是否支持，不发布遥测 |
| `capability-gate` | 依据遥测能力字段判断操作可用，并给出不可用的具体原因 | 不执行操作，不定义命令名 |
| `device-settings-panel` | 读取和修改图传参数与相机参数 | 不调用 DJI SDK，不解释链路状态 |
| `device-guidance` | 连接引导步骤与文案状态 | 不代替用户执行连接动作 |

`capability-gate` 使用的能力字段名必须与手机端遥测 `capabilities` 字段逐字一致，并且必须有一个测试断言这一点。旧项目在这里出现过能力名不匹配导致整个门禁失效的缺陷：电脑端使用了 `waypoint.start`、`video.start` 这类手机端并不存在的能力名，结果除 `telemetry.read` 之外的门禁全部成为死代码，且长期无人发现。

能力字段名的唯一定义来源是手机端根契约的 `capabilities` 字段表，见 [`../MSDK-relay/CONTRACT.md`](../MSDK-relay/CONTRACT.md) §8.2。本契约不重复列举字段名，避免出现第二份会漂移的清单。手机端每个命令族都必须有对应能力字段；`capability-gate` 判断某个操作是否可用时，必须使用该表规定的对应字段，不得自行发明字段名或用命令名当作能力名。

能力字段为 `true` 只表示设备侧当前不存在已知阻塞条件，不是执行会成功的承诺。`capability-gate` 不得把它当作跳过结果校验的理由。

#### `geo-map`

| 二级模块 | 只负责 | 明确不负责 |
| --- | --- | --- |
| `map-engine-adapter` | 场景创建、图元增删、视角定位和引擎生命周期 | 不定义业务航线语义，不读取文件 |
| `basemap-provider` | 底图来源、凭据保护代理和无凭据时的回退底图 | 不渲染业务图元 |
| `city-model` | 本地三维城市模型的装载与可见性 | 不生成模型，不参与航线业务 |

`geo-map` 是唯一允许依赖具体地图引擎的一级模块。引擎类型、图层对象和瓦片请求细节不得出现在它的公开接口中。

底图凭据不得进入渲染进程。凭据必须留在主进程，由签名代理转发请求。

#### `route-library`

已有契约见 [`src/modules/route-library/CONTRACT.md`](src/modules/route-library/CONTRACT.md)。二级模块为 `route-domain`、`route-importer`、`route-qualification`、`route-catalog`、`preview-model`、`route-workspace`。

本总契约对它做一处修订：原 `map-adapter` 二级模块提升为一级模块 `geo-map`。理由是它现在有两个真实调用方（航线预览和航线规划），符合 §2.1 的第一条新增条件。`route-library` 只输出与引擎无关的预览模型，由 `geo-map` 负责渲染。

`route-library` 不规划航线、不修改航点、不重新生成航线文件。

#### 外部航线规划边界

当前生产工作流不包含电脑端航线规划或航线编辑。`Wayline-master` 或其他外部工具负责规划并导出 KML/KMZ；Sky Command 的 `route-library` 只负责导入、合格性判定、目录管理和三维预览，`mission-control` 只负责将已导入的合格 KMZ 传输、上传并执行。

仓库内遗留的 `route-planning` 目录仅保留为未装配的历史研究代码：它不在生产组合根、IPC、地图工作区、任务控制器或命令下发路径中，且不得成为 UI 可达能力。重新启用它必须先取得业务批准，并新建契约版本、跨端执行格式和完整测试，不得把规划结果隐式转换为可执行航线。

#### `mission-control`

| 二级模块 | 只负责 | 明确不负责 |
| --- | --- | --- |
| `mission-phase-domain` | 任务阶段状态机与合法转换 | 不发送命令，不读取文件 |
| `preflight-check` | 起飞前门禁判定和拒绝原因码 | 不执行任务，不修改设备状态 |
| `mission-dispatcher` | 下发上传、开始、暂停、恢复和停止命令并关联结果 | 不判断是否应该执行，不解析或规划航线内容 |
| `mission-recovery` | 重连后依据遥测对账任务阶段 | 不重新发起任务，不修改航线文件 |
| `mission-workspace` | 飞行页任务导轨交互 | 不承载业务规则 |

`mission-control` 必须把"文件已暂存到手机""已上传到飞行器""任务已开始执行"作为三个不同阶段，不能合并成一个成功标志。

`preflight-check` 必须把"电量未知"和"电量不足"作为两种不同的拒绝原因。任何拒绝都必须带可显示给用户的具体原因，不允许只返回布尔值。

#### `flight-control`

| 二级模块 | 只负责 | 明确不负责 |
| --- | --- | --- |
| `flight-command-dispatcher` | 下发起飞、降落、取消降落、确认降落、返航、取消返航 | 不判断现场是否安全，不承载界面 |
| `dangerous-action-confirm` | 危险动作的显式二次确认与取消 | 不执行动作，不代替用户确认 |

`flight-control` 与 `mission-control` 是两个不同的一级模块。直接飞行动作和航线任务的风险等级、确认要求和状态模型都不同，不得合并。

任何飞行动作都必须先经过 `dangerous-action-confirm` 和 `preflight-check` 的公开判定接口。不得存在绕过确认的下发路径。

#### `media-pipeline`

| 二级模块 | 只负责 | 明确不负责 |
| --- | --- | --- |
| `network-endpoint` | 枚举本机网卡、排除虚拟与隧道网卡、给出可用局域网地址 | 不保存设置，不建立连接 |
| `rtmp-ingest` | 接收推流、按设备分配流标识、报告推流开始与结束 | 不转码，不播放 |
| `ffmpeg-locator` | 在多个来源中定位可用转码器并报告缺失原因 | 不启动转码进程 |
| `transcode-runner` | 转码子进程的启动、停止、异常退出和清理 | 不决定何时开始直播，不服务播放请求 |
| `hls-server` | 本地分片分发与生命周期 | 不转码，不决定播放器行为 |
| `stream-health` | 就绪判定、无帧超时、自动停止和诊断文本 | 不启动转码，不渲染界面 |
| `video-player` | 播放器装载与致命错误分类恢复 | 不管理服务端进程 |

`network-endpoint` 必须拒绝把公网地址作为推流目标，并且必须排除虚拟机、容器和 VPN 网卡。手动覆盖地址由 `desktop-settings/network-settings` 校验后提供。

`ffmpeg-locator` 找不到转码器时，必须返回可显示的具体缺失原因，不得静默失败。

`stream-health` 在超时自动停止时必须给出诊断文本，说明是没有收到推流、转码失败还是分片未就绪。

#### `live-stream-control`

| 二级模块 | 只负责 | 明确不负责 |
| --- | --- | --- |
| `stream-protocol-config` | RTMP 直播配置模型与地址合法性 | 不启动直播，不接收视频 |
| `stream-dispatcher` | 下发直播开始/停止命令并维护请求状态 | 不接收视频，不管理转码进程 |

当前手机端 `live-stream` 的公开契约只支持 RTMP；桌面端不得虚构 RTSP、GB28181 或 Agora 的可用配置。未来新增协议必须先在手机端增加对应命令、能力字段和契约，再为每个协议增加独立的配置模型与校验规则，不能用一套字符串规则代替。

`live-stream-control` 是控制侧，`media-pipeline` 是接收侧。前者向后者索取接收端点，后者不得反向调用前者。

### 2.3 模块依赖方向

依赖方向固定为：

```text
app-shell
  -> desktop-settings
  -> relay-link
  -> geo-map
  -> device-console
  -> route-library
  -> mission-control
  -> flight-control
  -> media-pipeline
  -> live-stream-control

relay-link
  -> protocol-core
  -> desktop-settings 的已校验监听地址

geo-map
  -> desktop-settings 的已校验底图配置与凭据

device-console
  -> relay-link 的命令接口和遥测只读接口

route-library
  核心（route-domain、route-importer、route-qualification、route-catalog、preview-model）
    （不依赖任何其他一级模块）
  route-workspace
    -> geo-map 的公开地图接口

mission-control
  -> route-library 的一级公开接口（取任务载荷）
  -> relay-link 的命令接口、任务发送接口和遥测只读接口

flight-control
  -> relay-link 的命令接口
  -> mission-control 的门禁判定接口
  -> device-console 的能力判定接口

media-pipeline
  -> desktop-settings 的已校验设置

live-stream-control
  -> media-pipeline 的接收端点只读接口
  -> relay-link 的命令接口
```

以下依赖永远禁止：

- `relay-link` -> 任何飞行、航线、直播或地图业务语义；通道不能知道业务；
- 除 `geo-map` 以外的任何模块 -> 具体地图引擎；
- 除 `media-pipeline` 以外的任何模块 -> 转码器进程或推流服务库；
- 除 `relay-link` 以外的任何模块 -> WebSocket 库；
- 除 `desktop-settings` 以外的任何模块 -> 直接读写设置文件；
- 除 `app-shell` 以外的任何模块 -> Electron 全局对象、命令行参数或路径 API；
- 渲染进程代码 -> Node API；只能经过 `ipc-bridge`；
- `media-pipeline` -> `live-stream-control`；
- 任意二级模块 -> 另一个二级模块的内部类或内部状态；
- `telemetry-intake` 推导业务可用性；
- `device-registry` 保存遥测内容或任务状态；
- `mission-phase-domain` 直接发送命令。

### 2.4 核心层与工作区层

每个包含界面的一级模块都分为两层，这是电脑端唯一允许的分层方式：

- **核心层**：领域值、解析、判定、状态机和命令构造。不依赖界面框架、地图引擎、Electron、DOM 和任何其他一级模块的实现。必须能在纯 Node 环境下测试。
- **工作区层**：唯一一个位于系统边缘的适配器，名称固定以 `-workspace` 或 `-panel` 结尾。它负责界面交互、把核心层结果交给 `geo-map` 或界面框架，允许依赖界面框架和其他一级模块的公开接口。

规则：

- 一个一级模块最多有一个工作区层模块；
- 工作区层不得包含业务规则、校验、去重、分类、状态机或阶段判定；
- 核心层不得反向依赖工作区层；
- 跨一级模块的界面依赖只允许发生在工作区层；
- 判断一段代码属于哪一层的标准是：删掉界面后它是否还需要存在。需要则属于核心层。

当前的工作区层模块只有 `route-library/route-workspace`、`mission-control/mission-workspace`、`device-console/device-guidance` 和 `media-pipeline/video-player`。新增工作区层模块必须先修改本契约。

### 2.5 模块之间的协作方式

跨模块只允许使用以下五种方式：

1. **命令下发接口：** 业务模块把已构造的命令交给 `relay-link`，由它负责发送和结果关联。
2. **只读状态接口：** 调用方读取另一模块提供的不可变快照，例如遥测、任务阶段、接收端点。
3. **结果与事件回调接口：** 拥有状态的模块向注册的监听器发布变化，不主动调用调用方的内部方法。
4. **数据交接接口：** `route-library` 通过一级公开接口把任务载荷交给 `mission-control`，`mission-control` 通过 `mission-sender` 交给通道，不互相传递文件路径。
5. **判定接口：** `preflight-check` 和 `capability-gate` 提供纯判定结果，调用方据此决定是否继续，判定模块本身不执行动作。

禁止通过全局可变对象、模块级单例状态、直接引用对方存储或共享框架生命周期对象传递状态。

### 2.6 多设备状态原则

电脑端必须同时支持多台手机和多架飞行器。

因此所有与设备相关的状态都必须以 `deviceId` 为键保存，不允许存在"当前设备"的隐式全局变量。视频来源设备和任务执行设备可以是不同设备，必须分别选择。

"多设备"不是一个模块，而是所有状态仓库的共同约束。任何保存设备状态却不以 `deviceId` 为键的实现都是违约。

### 2.7 业务覆盖检查表

| 业务需求 | 负责一级模块 | 关键二级模块 |
| --- | --- | --- |
| 应用启动、单实例和窗口 | `app-shell` | `process-lifecycle`、`window-manager` |
| 渲染进程装载失败恢复 | `app-shell` | `renderer-host` |
| 数据目录与打包环境差异 | `app-shell` | `runtime-paths` |
| 主进程能力受限暴露 | `app-shell` | `ipc-bridge` |
| 本地设置持久化 | `desktop-settings` | `settings-store` |
| 局域网地址与手动覆盖 | `desktop-settings` | `network-settings` |
| 地图凭据与底图配置 | `desktop-settings` | `map-settings` |
| 接受手机连接与会话管理 | `relay-link` | `relay-server`、`device-registry` |
| 协议帧编解码与校验 | `relay-link` | `protocol-core` |
| 命令超时与断线拒绝 | `relay-link` | `command-tracker` |
| 接收遥测 | `relay-link` | `telemetry-intake` |
| 一次性刷新遥测（`telemetry.read`） | `relay-link` + `relay-operations-adapter.refreshTelemetry` | `sendCommand` 下发空字段；`telemetry-intake` 只收随后入站帧 |
| 发送航线文件 | `relay-link` | `mission-sender` |
| 三段链路状态显示 | `device-console` | `link-chain` |
| 遥控器与飞行器配对 | `device-console` | `pairing-controller` |
| 操作可用性与原因提示 | `device-console` | `capability-gate` |
| 图传与相机参数读写 | `device-console` | `device-settings-panel` |
| 连接引导 | `device-console` | `device-guidance` |
| 三维地图显示与定位 | `geo-map` | `map-engine-adapter` |
| 底图与无凭据回退 | `geo-map` | `basemap-provider` |
| 本地城市模型 | `geo-map` | `city-model` |
| 导入 KML/KMZ | `route-library` | `route-importer`、`route-qualification` |
| 多航线管理与选择 | `route-library` | `route-catalog` |
| 航线预览模型 | `route-library` | `preview-model` |
| 起飞前门禁 | `mission-control` | `preflight-check` |
| 上传、开始、暂停、恢复、停止航线 | `mission-control` | `mission-dispatcher`、`mission-phase-domain` |
| 重连后的任务安全处置：保持 `disconnected`，要求重新暂存与上传 | `mission-control` | 根模块的中继断线协调 + `mission-dispatcher` |
| 起飞、降落、返航 | `flight-control` | `flight-command-dispatcher`、`dangerous-action-confirm` |
| 接收飞行器视频 | `media-pipeline` | `rtmp-ingest`、`network-endpoint` |
| 转码与本地播放 | `media-pipeline` | `ffmpeg-locator`、`transcode-runner`、`hls-server`、`video-player` |
| 视频就绪与超时诊断 | `media-pipeline` | `stream-health` |
| 直播协议配置 | `live-stream-control` | `stream-protocol-config` |
| 开始与停止直播 | `live-stream-control` | `stream-dispatcher` |

没有列在表中的一级或二级模块不得自行增加新的业务能力；新增能力必须先更新本表和对应契约。

### 2.8 二级模块契约的统一写法

每个二级模块的 `CONTRACT.md` 至少要回答：

1. 这个模块唯一负责的结果是什么，明确不负责什么。
2. 调用方需要提供什么，模块会返回什么，哪些字段有单位、范围和长度限制。
3. 调用前必须满足什么条件，模块启动、停止、重连和销毁时怎样变化。
4. 超时、取消、重复调用、并发调用、设备断开和数据损坏时分别怎样处理。
5. 哪个模块拥有状态和文件，当前模块只能读取哪些公开接口。
6. 调用方和测试替身如何使用这个模块，不需要了解哪些 Electron、地图引擎或转码器细节。
7. 正常、失败、边界、断线和第三方回调异常分别由哪些测试覆盖。

契约中可以使用语义化接口名称，不要求提前固定 TypeScript 类名；但接口的输入、输出、前置条件、失败方式和生命周期必须固定。没有契约的二级模块不得进入实现阶段。

---

## 3. 电脑端明确不做什么

以下能力不属于当前电脑端契约：

- 直接连接 DJI 设备或直接调用 DJI SDK。
- 虚拟摇杆或任何连续飞行姿态操纵。
- 在 Sky Command 内规划、编辑、重采样或生成航线；航线必须由 Wayline-master 或其他外部工具生成后再导入。
- 生成 DJI WPMZ 航线文件；电脑端只传输经 `route-library` 合格性判定的外部 KMZ。
- 修改导入的航线文件字节。
- 手机端的 FPV 取景界面、相机控件和机上文件浏览。
- 代替用户确认危险动作。
- 长期保留的本机 HTTP 控制接口。
- 媒体文件下载、录像管理和本地截图。
- 飞行记录回放、地理围栏和限高管理。

其中虚拟摇杆、地理围栏、限高和媒体下载在旧项目中也不存在，属于明确不扩大范围。

---

## 4. 安全边界

当前版本不实现连接认证。这是一个已知并被接受的限制，必须按以下方式约束，不得当作安全：

- 中继服务只在受控局域网内使用，部署时必须确保网络本身可信；
- `deviceId` 只表示手机身份，不是凭据，不得当作密码使用；
- 任何操作结果和错误信息都不得包含本机绝对路径、凭据、令牌或第三方异常堆栈；
- 地图与直播凭据必须留在主进程，不得进入渲染进程或日志；
- 渲染进程必须受内容安全策略约束，播放来源限制为本机回环地址。

正式版本必须补充认证策略。补充时应在协议中增加兼容的认证字段，或提升协议主版本，并同步修改两端根契约。在认证落地之前，任何"局域网内即可信"的假设都必须写在部署说明里，而不是留在代码注释中。

---

## 5. 完成定义

电脑端重构只有同时满足以下条件才算完成：

- 本契约和全部一级、二级模块契约已批准；
- §2.7 表中每一行都有对应实现和通过的契约测试；
- 依赖方向由自动化测试机械化约束，不依赖人工检查；
- 地图引擎只出现在 `geo-map`，转码器只出现在 `media-pipeline`，WebSocket 只出现在 `relay-link`；
- 渲染进程没有 Node API 直接访问；
- 能力字段名与手机端遥测逐字一致，并有测试断言；
- 所有设备状态以 `deviceId` 为键；
- 任何失败都不会让界面显示无原因的禁用按钮；
- 旧实现中绕过新契约的代码已删除或完全停止使用。

---

## 6. 与手机端的对应关系

| 电脑端模块 | 手机端对应模块 | 关系 |
| --- | --- | --- |
| `relay-link/protocol-core` | `relay-gateway/protocol-core` | 同一份协议的两端实现，必须逐字一致 |
| `relay-link/relay-server` | `relay-gateway/transport-adapter` + `connection-session` | 服务端与客户端 |
| `relay-link/mission-sender` | `relay-gateway/mission-transfer` | 发送端与接收端 |
| `relay-link/telemetry-intake` | `telemetry/telemetry-publisher` | 接收端与发布端 |
| `device-console/pairing-controller` | `device-connection/pairing-controller` | 请求方与执行方 |
| `device-console/capability-gate` | `telemetry/capability-calculator` | 消费方与生产方 |
| `device-console/device-settings-panel` | `device-settings` | 请求方与执行方 |
| `mission-control/mission-dispatcher` | `wayline-mission/mission-uploader` + `mission-executor` | 请求方与执行方 |
| `flight-control/flight-command-dispatcher` | `flight-control/flight-command-handler` | 请求方与执行方 |
| `live-stream-control/stream-dispatcher` | `live-stream/stream-command-handler` | 请求方与执行方 |
| `media-pipeline` | 无 | 仅电脑端；手机端不接收也不播放视频 |
| `geo-map`、`route-library` | 无 | 仅电脑端；手机端不做地图和航线规划 |

任何一端修改上表涉及的接口，都必须同时更新两端根契约。

### 6.1 命令下发归属表

手机端 [`../MSDK-relay/CONTRACT.md`](../MSDK-relay/CONTRACT.md) §7 中当前生产流程公开的每一条命令都必须在本表中有唯一的电脑端下发方。没有下发方的命令等于无法被使用，属于覆盖缺口。`wayline.generate` 已从手机端生产命令目录和 APK 组合中移除；收到该名称必须按未知命令拒绝。重新增加任何手机端航线生成功能，必须先取得业务批准并更新两端根契约和本表。

| 手机端命令 | 电脑端下发方 |
| --- | --- |
| `telemetry.read` | `relay-operations-adapter.refreshTelemetry` |
| `pairing.start`、`pairing.stop`、`pairing.status` | `device-console/pairing-controller` |
| `wayline.upload`、`wayline.start`、`wayline.pause`、`wayline.resume`、`wayline.stop` | `mission-control/mission-dispatcher` |
| `flight.takeoff`、`flight.land`、`flight.return-home` | `flight-control/flight-command-dispatcher` |
| `live-stream.start`、`live-stream.stop` | `live-stream-control/stream-dispatcher` |
| `device.settings.transmission.read`、`device.settings.transmission.write` | `device-console/device-settings-panel` |
| `device.settings.camera.read`、`device.settings.camera.write` | `device-console/device-settings-panel` |

规则：

- 一条命令只能有一个下发方。两个模块下发同一条命令意味着职责重叠，必须先修改契约；
- 手机端新增生产公开命令时，必须同时在本表和手机端 §8.2 能力字段对应表中增加对应行，否则电脑端不得实现；
- 下发方必须先取得 `capability-gate` 的判定结果，再决定是否下发；
- 本表不规定命令的触发界面。界面属于对应模块的工作区层。
