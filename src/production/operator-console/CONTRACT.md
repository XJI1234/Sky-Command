# 操作台投影

状态：已实现；生产胶水，不加入覆盖率/变异门禁

## 职责

把 `DesktopUiGateway` 快照和渲染进程本地选择投影成操作员视图，并解释动作前置事实。它把工作区固定为「设备 → 航线 → 飞行」，只显示已确认事实，不发送命令、不保存选择、不创建窗口。

## 工作区

### 设备状态分区

设备详情按 MSDK 组件与运行归属分区呈现，取代此前把 Key 与事实混入同一个「连接状态」或「动态飞行事实」列表的布局：

- **连接状态**：仅显示电脑到手机中继、MSDK 生命周期、遥控器连接和对频状态。
- **手机连接质量 `[WebSocket PING/PONG]`**：仅显示操作者手动发起的当前 RTT、中位 RTT、最大 RTT 与抖动，或不可测原因；它不是 DJI MSDK Key、不是图传指标、不是遥测刷新结果，也绝不参与任何控制门禁。
- **飞控状态 `[FlightControllerKey]`**：显示 `KeyConnection`、飞行状态、电机、低电量返航状态与预估、飞行模式、相对起飞点高度、位置、GPS、视觉传感器、降落确认及起飞/电机失败原始事实。
- **飞行辅助状态 `[FlightAssistantKey]`**：显示视觉系统告警、视觉定位开关和降落保护的原始事实。
- **图传状态 `[AirLinkKey / CameraKey]`**：显示 AirLink 和主相机的 `KeyConnection`，以及手机 MSDK 图传运行观测、分辨率、帧率、码率、丢包、缓存长度和 RTT。
- **电池状态 `[BatteryKey]`**：显示主电池 `KeyConnection` 和电量；电池值不因飞控明确断开而被渲染层隐藏。
- **设备信息**：显示机型、遥控器型号和桌面接收时间；接收时间只说明观察到达桌面的时刻，不参与按钮授权。
- **运行状态**：显示任务、手机推流和桌面播放，三者彼此独立。

每一个 Key 只出现在其所属组件分区；分区只是操作员视图，不得改变手机端 MSDK 订阅、Relay 协议字段、状态快照或任何控制门禁。

- 设备页：观察手机、MSDK、遥控器、对频、飞控、AirLink 和主相机，以及已确认的机型、遥控器型号、电量、低电量返航状态与预估、飞行状态、电机状态、飞行模式、相对起飞点高度、位置和直播指标。设备详情必须固定为「电脑到手机中继」「MSDK 生命周期 [SDKManager]」「遥控器连接 [RemoteControllerKey.KeyConnection]」「对频状态 [RemoteControllerKey.KeyPairingStatus]」「飞控连接 [FlightControllerKey.KeyConnection]」「AirLink 连接 [AirLinkKey.KeyConnection]」「主相机连接 [CameraKey.KeyConnection, LEFT_OR_MAIN]」七个具名独立行；一行只表示该部分的一个状态，不能以横向串联标签、相同的无主语文案或合并的“飞机链路”代替。除电脑到手机中继外，每行必须分别直接使用 `sdkAvailability`、`remoteController`、`pairingState`、`flightController`、`airLink`、`camera` 的受限原始枚举；不得使用兼容布尔值、组合 Key 或显示保持。`ProductKey.KeyConnection` 不进入设备页；它只保留在生产适配层原始遥测中供诊断，不得翻译为飞机物理在线。MSDK 必须单独显示为「MSDK 已就绪」/「MSDK 正在初始化」/「MSDK 初始化失败」/「MSDK 已停止」/「MSDK 状态未知」，并且不得借此推断飞机或图传状态。对频是连接新飞机或更换遥控器时的独立维护状态，不得降低已连接链路的就绪状态，也不得阻塞图传、航线或直接控制。明确断开显示「遥控器未连接」/「飞控未连接」/「AirLink 未连接」/「主相机未连接」，状态未知显示对应的「状态未知」，已连接显示对应的「已连接」。对频 `UNKNOWN` 必须写成「对频状态未知」，不得写成「未对频」。动态事实必须逐行展示：空值显示「尚未取得」或「尚未确认」，MSDK 明确返回的 `UNKNOWN` 必须显示为「未知（MSDK 返回 UNKNOWN）」，不得伪造成 `0`。低电量返航状态与预估必须分行显示；状态 `UNKNOWN + 0` 显示返航状态未知和「不适用（无有效返航预估）」，不得显示零秒。`KeyAltitude` 的行名必须为「相对起飞点高度」，不得声称是海拔或下视测距高度。飞控明确断开时必须清空动态事实；飞控状态未知时可显示当前快照仍保留的最后确认值，但「状态更新时间」必须明确写成「上次更新于 ...，飞控状态当前未确认」，其中时间是电脑最后验证收到该遥测的时刻，不能借此授权任何控制操作。设备页还必须将「任务」「手机推流」「桌面播放」作为三行独立运行状态：手机接受图传命令不等于正在推流，手机推流不等于桌面播放，播放失败不得改写任务或飞控状态。设备页只消费工作流快照，不读取原始中继帧、不发对频、任务或图传命令。

设备页的「测量手机连接」只在选中在线手机时可用。点击后按钮在本次测量完成前禁用，报告显示为「当前 X ms · 中位 X ms · 最大 X ms · 抖动 X ms」或明确不可测状态；它只使用受控 `device-link-measure` IPC，不调用 `device-refresh`，不改写任何 MSDK 或运行状态行，也不写入操作门禁。
- 航线页：导入、在三维地图上预览、选择或删除本地资产。KML 只能预览；`upload-candidate` 的 KMZ 才可执行。地图底图与杭州白模沿用既有桌面方案，航迹来自 `route-preview`，不在本模块解析 KMZ。地图必须绘制完整折线，并为每个航点显示点标记；首尾点保留现有起点/终点标签，中间航点使用统一的小点标记。
- 飞行页：分别选择任务机与图传机，执行准备航线/上传至飞机/执行航线、旧 RTMP 图传启停、起飞降落返航。全部直接飞行动作只要求所选手机在线且 MSDK 已就绪；遥控器、飞控、飞行状态、飞行模式、电量、电机和降落确认只作为显示事实，不能让页面替 DJI Action 拒绝操作。降落命令已经被 DJI 接受后，页面继续显示观测到的降落进度，但新的人工降落请求仍须经过独立确认并交由 DJI Action 裁决；停止自动降落入口保持独立可用。飞行页不提供低延迟/WHIP 按钮，也不提供「附着播放器」；图传画面由本页 `flv.js` 播放 HTTP-FLV。设备页和 `control` 都读取同一包遥测中的原始 MSDK Key，按钮门禁只使用对应操作的最小可达性或业务阶段，显示不能放宽新操作。飞行页必须在点「启动图传」前展示图传是否可启动（`streamCanStart` / `streamLabel`）；未就绪时禁用启动按钮。图传进行中必须可点「停止图传」（`streamCanStop`），文案要指向停止而不是只说不能启动。

飞行页提供“实机预检”显式动作，使用当前任务机调用 `hardware-readiness`。返回的阻塞项须以模块给出的安全中文消息呈现；它不发送图传、飞控或低延迟命令。该预检只覆盖桌面媒体接收服务和直接调用 MSDK 所需的最小可达性；图传能力由 `live-stream-control`、飞控设备安全由 DJI Action 回调分别裁决，不得在操作台重复推断。

### 事实来源标注

动态 MSDK 事实也必须逐行标出精确来源：机型 `[ProductKey.KeyProductType]`、遥控器型号 `[RemoteControllerKey.KeyRemoteControllerType]`、飞行状态 `[FlightControllerKey.KeyIsFlying]`、电机 `[FlightControllerKey.KeyAreMotorsOn]`、电量 `[BatteryKey.KeyChargeRemainingInPercent, LEFT_OR_MAIN]`、低电量返航状态和预估 `[FlightControllerKey.KeyLowBatteryRTHInfo]`、飞行模式 `[FlightControllerKey.KeyFCFlightMode]`、相对起飞点高度 `[FlightControllerKey.KeyAltitude]`、位置 `[FlightControllerKey.KeyAircraftLocation]`、GPS 信号 `[FlightControllerKey.KeyGPSSignalLevel]`、GPS 卫星数 `[FlightControllerKey.KeyGPSSatelliteCount]`、视觉传感器使用 `[FlightControllerKey.KeyIsVisionSensorUsed]`、降落确认请求 `[FlightControllerKey.KeyIsLandingConfirmationNeeded]`、起飞失败原因 `[FlightControllerKey.KeyTakeoffFailureError]`、电机启动失败原因 `[FlightControllerKey.KeyMotorStartFailureError]`、视觉告警 `[FlightAssistantKey.KeyVisionSystemWarning]`、视觉定位开关 `[FlightAssistantKey.KeyVisionPositioningEnabled]` 与降落保护 `[FlightAssistantKey.KeyLandingProtectionState]`。图传观测、分辨率、帧率、码率、RTT、任务、播放器和桌面接收时间不是 MSDK Key，必须如实注明其运行时来源，不能伪造 Key。

设备页显示与控制门禁读取同一 Relay 会话的当前 MSDK 设备事实。稳定事实不能仅因没有新事件或接收时间变旧而降级；会话替换、MSDK 观察重建和明确的未知/断开事件才会更新其可用性。状态更新时间只说明桌面何时收到该观察，不参与按钮授权。

## DJI 操作回执

每个会调用 DJI MSDK 的飞行、航线和图传按钮下方都必须单独显示该按钮在当前手机会话中的最新结果。`ACTION_REJECTED` 显示为「DJI MSDK 回调：拒绝操作；错误码：...；错误说明：...」，这两项仅来自手机实际收到的 `IDJIError.errorCode()` / `description()` 的受限副本。`SUCCEEDED` 显示为 DJI 已接受该 API 调用，并明确说明不代表物理动作或图像播放已经完成。中继/手机在取得 DJI 结果前失败、超时、取消或断连，必须显示「结果未确认」，不得假装 DJI 拒绝或假装未调用。

桌面本地门禁、人工确认、航线文件暂存不是 DJI 回调，必须明确写成「未调用 DJI MSDK」或「手机中继回调」。图传运行期 `LiveStreamStatusListener.onError` 也不是启动或停止按钮的完成回调：它必须在图传运行状态处独立显示「DJI MSDK 图传运行回调：错误码：...；错误说明：...」，优先于旧播放器 ready 文案，并且绝不能覆盖任一按钮的历史回执。手机会话变化后，旧会话的按钮回执必须立即隐藏。

## 选择规则

- 任务机与图传机分开选择，允许不是同一台。
- 未选择且仅有一台在线设备时自动选中。
- 已选设备离线后清空，不得改选到另一台。
- 航线库非空时必须有当前航线。快照里选择为空或指向已删除航线时，投影到剩余航线中的第一条；库空时 `selectedRoute` 才为 null。
- 地图点只使用同时具备有限 lat/lon 的位姿；任务机与图传机重合标 `both`。
- 待确认飞行动作只显示任务机上的 `pendingFlightAction`。
- 已存在任务时，飞行页显示和执行确认只能使用任务快照中的 `routeId` 及其稳定显示名，绝不能将航线页后来选中的 `selectedRoute` 当作已上传或待执行的航线。若两者不同，必须同时诚实显示。

## 图传启动门禁（以本节为准）

`evaluate("stream-start")` 只拦截未选择图传手机或 MSDK 未就绪的情形。桌面图传调度器在发送前还必须确认媒体接收端点正在运行、RTMP 目标合法、手机 Relay 在线，并避免同设备的启动/停止命令并发。

由 `AirLinkKey.KeyConnection` 和 `CameraKey.KeyConnection(LEFT_OR_MAIN)` 推导的 `liveVideo` 只是当前图传源观测：为 false 或未知时，操作台必须如实显示提示，但不得禁用「启动图传」、拒绝 `live-stream.start` 或代替 DJI 判定硬件不可用。命令已可达时，必须交给 DJI `startStream` 回调裁决；回调成功只表示 MSDK 已接受，只有 `LiveStreamStatus.isStreaming` 和桌面端实际收流/播放分别能表示正在推流与正在播放。
在图传已活动时，AirLink 或主相机的明确失效仍是断源清理规则：禁止自动重启，清理本地播放器，并以 MSDK 运行回调和流状态继续确认终态。它与开始时是否允许人工请求是两个独立问题。

## 证据

- `staging` 必须说明手机仍在传输和校验；`staged` 必须说明航线只准备到手机且下一步是上传至飞机；`uploaded` 必须说明下一步是执行航线。任一阶段都不得把手机暂存写成飞机已收到。
- `starting` 必须说明仅启动调用已受理、仍等待飞机实际进入航线；只有 `running` 才是「正在执行航线」。暂停、恢复或停止待确认时必须说明不能重复同一命令；暂停/恢复待确认时仍必须允许停止作为唯一保守处置。断线必须说明飞机状态未知，不能写成已停止。
- 图传只有 `video.phase === ready` 才是可播放；手机接受推流不是实时图传。生产只保留经典 RTMP/HTTP-FLV；低延迟 WHIP 已封存，`evaluate("webrtc-*")` 必须拒绝并引导使用「启动图传」。空闲时 `streamLabel` 必须写明是否具备本地命令可达性，并将 AirLink/主相机的未就绪或未知如实表述为非阻断提示；不得笼统写成「空闲」，也不得将遥控器、飞控或图传源观测写成图传启动阻塞原因。
- 旧图传由飞行页 `flv.js` 播放本机 HTTP-FLV。媒体管线 `ready` 只表示 RTMP 已到达且 HTTP-FLV 可取；渲染器成功附着当前图传机时必须同步播放器选择，只有同一渲染器观察到 `video` 正持续出帧才可显示「正在播放」。其他设备必须显示未被当前播放器选择，不能把另一台手机的播放状态投射过来。播放抖动时优先 `unload/load` 软恢复，连续失败才退避重挂；已附着但长时间未出画或画面停住必须看门狗恢复。面向操作员的状态栏不得展示 `readyState`、错误码或英文动作名。
- `evaluate("stream-start")` 仅要求已选图传机与 MSDK 已就绪；桌面图传调度器在发送前还会验证媒体服务、有效 RTMP 目标、在线中继与同设备命令顺序。`liveVideo` 由手机端的 MSDK 就绪状态、AirLink Key 和主相机 Key 当前三态推导，只作为图传源观测：未知或 false 可显示提示，不得禁用按钮、拒绝命令或代替 DJI 裁决。飞控与遥控器不参与。真实推流与收流结果仍由 DJI `startStream` 回调、`LiveStreamStatus.isStreaming` 和既有图传状态机明确呈现。`streamCanStart` 与该最小可达性门槛对齐。`streamPhase === "stopping"` 时必须优先显示「正在停止图传」，不得被遗留的播放器 `ready` 状态写成「图传播放中」；若启动门禁已满足，启动按钮必须表示“停止后重启”，其请求只会在手机确认停止后由控制调度器重新预检并下发。`streamPhase` 已是 starting/streaming 但 `video.phase` 尚非 ready 时，文案须写成「电脑还没收到画面」，不得暗示已有实时图传。所有 `evaluate("flight-*")` 只检查已选在线手机与 MSDK 已就绪，不使用飞行状态、飞行模式、降落确认需求、电量、电机、遥控器或飞控状态替 DJI Action 拒绝；MSDK 拒绝和未确认结果必须如实展示。`KeyStartAutoLanding` 成功后状态必须写为「等待 MSDK 确认落地」；只有 `KeyIsFlying=false` 且 `KeyAreMotorsOn=false` 才写为「已确认落地」。飞行页不展示低延迟按钮。
- 手机因 AirLink 或主相机失效报告 `failed/SOURCE_UNAVAILABLE` 时，手机已排队恢复性停止；操作台必须清理本地播放器和重试，不得让旧播放器 URL 重新启用停止键，`streamCanStop` 与 `evaluate("stream-stop")` 必须拒绝重复停止。普通 `failed` 状态仍允许人工停止一次，以处理启动半成功等不确定结果。
- 对频由手机完成。`evaluate("pairing-start")` / `evaluate("pairing-stop")` 必须说明该事实，不得假装桌面已经发出对频命令。
- `mission-stage` 只要求已选可执行航线和在线手机，且任务阶段为 `idle`、`completed`、`failed` 或 `disconnected`；KMZ 传到手机不依赖飞机已连接。`mission-upload` 仅在阶段为 `staged` 且 MSDK 已就绪时允许；后端在发送前用同一会话的当前遥测复核 Relay/MSDK 可达性。六个航线按钮均须直接使用 `evaluate` 的结果禁用和显示原因，渲染层不得自行增加设备安全门禁。
- `mission-pause` 仅 `running`，`mission-resume` 仅 `paused`，`mission-stop` 仅 `starting`、`running`、`pausing`、`paused`、`resuming` 或已重新在线设备的 `disconnected` 任务；这些三个按钮还必须确认所选手机在线且 MSDK 已就绪，确保命令能够到达 DJI。暂停、恢复和停止不应先被飞控或飞机的显示状态阻断；它们的电量、飞行状态、电机等设备安全条件仍由 DJI 回调裁决。后者是断线后的保守处置，不恢复或重发启动。上传完成未开始执行时不得发 `wayline.stop`。`mission-start` 仅要求任务为已上传且 MSDK 已就绪；遥控器、飞机、飞控、电量、在飞与电机状态都必须交由 `startMission` 的 DJI 回调裁决。对频不是日常前置条件，只有接入新飞机或更换遥控器时才应在手机端作为独立维护操作。点击「执行航线」只能创建本地确认意图；确认时必须重新读取快照，且目标手机、`missionId` 与任务 `routeId` 三者仍完全匹配才可发送启动命令。
