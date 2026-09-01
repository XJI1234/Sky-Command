# 飞行作业工作流模块契约

状态：已实施；生产图传已实机验证，航线与飞行动作仍待对应实机验收

## 1. 唯一职责

`operation-workflow` 是 Sky Command 桌面端的作业编排模块。它把已经构造好的设备、中继、航线库、任务控制、图传控制、媒体管线和直接飞控模块组合为可供桌面界面消费的统一飞行作业工作流。

它唯一拥有下列跨模块规则：

1. 每台在线中继设备的可作业事实汇总；
2. 当前航线选择与每台设备的航线分配；
3. 航线任务的暂存、上传、启动、暂停、恢复、停止操作入口；
4. 图传控制状态与媒体可播放状态的并列呈现；
5. 直接飞行动作的确认请求转交；
6. 设备断连、航线删除、释放时的跨模块清理和状态失效；
7. 不泄露传输、DJI 或文件系统细节的只读工作流快照。

它不解析、生成或编辑 KMZ/WPML；不创建 WebSocket、Android 或 DJI 对象；不启动 Electron 窗口、定义 IPC 或渲染页面；不直接操作地图引擎、RTMP、FFmpeg 或文件系统；不保存设置；不重新实现任务、图传、飞控、能力门禁或预检状态机；也不自动发送起飞、降落、返航、上传、启动、暂停、恢复、停止或图传命令。

航线必须由 Wayline 项目生成后导入。Sky Command 的职责限于导入、预览、分配与执行。

## 2. 术语与不变量

| 术语 | 含义 |
| --- | --- |
| 中继设备 | 一台主动连入电脑的 Android Relay，以稳定 `deviceId` 标识。 |
| 飞机 | 当前中继设备背后 DJI SDK 报告的飞行器。一个中继设备至多对应一架飞机。 |
| 在线设备 | 当前 `relay-operations-adapter.devices()` 中存在的设备；没有“离线但仍可操作”的设备。 |
| 当前航线 | 航线库显式选中的航线，只用于航线页预览和新建分配的默认候选，不等同于某台飞机已经分配的航线。 |
| 分配 | 某个 `deviceId` 与一个可上传 `routeId` 的显式关联。分配本身不发送网络命令。 |
| 作业 | 一台设备上独立存在的航线任务、图传控制和直接飞控确认的组合视图。不同设备的作业互不共享可变状态。 |
| 任务暂存 | 手机已保存 KMZ，不表示飞机已收到。 |
| 任务上传 | 手机已经确认 DJI 飞机端航线上传成功。 |
| 启动接受 | 手机已经确认 DJI 接受 `wayline.start`，不表示飞机已经开始执行。 |
| 实际执行 | 仅在当前任务收到匹配的 DJI `ROUTE_EXECUTION_STARTED` 正式阶段事件后成立。 |
| 图传控制成功 | 手机端已成功处理图传开始命令，不表示电脑已经有可播放画面。 |
| 画面可用 | `media-pipeline` 对同一设备报告 `ready`，并具有可播放地址。 |

不变量：

1. 所有任务、图传和直接飞控动作必须带有明确 `deviceId`；不存在隐式“当前飞机”。
2. 同一设备每时刻至多拥有一个航线任务通道、一个图传控制通道和一个待确认直接飞行动作；该约束由各下游模块执行，本模块不得复制其状态机。
3. 不同设备允许并行作业；一个设备的失败、断连或迟到结果不得影响其他设备。
4. 任务、图传、直接飞控的成功语义必须严格区分，工作流不得把中继接受、DJI 接受和实际飞行/播放混为一谈。
5. 任何未知、缺失、畸形或过期设备事实均不得提升为“可执行”。
6. 本模块不保存原始 KMZ 字节、RTMP 地址、播放地址、会话 ID、连接 ID、令牌、文件路径、DJI 异常或原始协议帧。

## 3. 对外接口

```ts
OperationWorkflow.create(dependencies) -> OperationWorkflowInstance

instance.snapshot() -> OperationWorkflowSnapshot
instance.subscribe(listener) -> unsubscribe

instance.importRoute(input, cancellation?) -> Promise<WorkflowResult>
instance.getRoutePreview(routeId) -> WorkflowResult
instance.selectRoute(routeId) -> WorkflowResult
instance.removeRoute(routeId) -> WorkflowResult
instance.assignRoute(deviceId, routeId) -> WorkflowResult
instance.clearAssignment(deviceId) -> WorkflowResult

instance.stage(deviceId) -> Promise<WorkflowResult>
instance.upload(deviceId) -> Promise<WorkflowResult>
instance.start(deviceId) -> Promise<WorkflowResult>
instance.pause(deviceId) -> Promise<WorkflowResult>
instance.resume(deviceId) -> Promise<WorkflowResult>
instance.stop(deviceId) -> Promise<WorkflowResult>

instance.startStream(deviceId) -> Promise<WorkflowResult>
instance.stopStream(deviceId) -> Promise<WorkflowResult>
instance.checkHardwareReadiness(deviceId) -> WorkflowResult
instance.selectVideo(deviceId) -> WorkflowResult
instance.clearVideo() -> WorkflowResult
instance.refreshMedia() -> WorkflowResult

instance.readTransmissionSettings(deviceId) -> Promise<WorkflowResult>
instance.writeTransmissionSettings(deviceId, patch) -> Promise<WorkflowResult>
instance.readCameraSettings(deviceId) -> Promise<WorkflowResult>
instance.writeCameraSettings(deviceId, patch) -> Promise<WorkflowResult>

instance.refreshDeviceState(deviceId) -> Promise<WorkflowResult>
instance.requestFlightAction(deviceId, action) -> Promise<WorkflowResult>
instance.confirmFlightAction(deviceId, confirmationId) -> Promise<WorkflowResult>
instance.cancelFlightAction(deviceId, confirmationId) -> WorkflowResult

instance.forgetCompletedTask(deviceId) -> WorkflowResult
instance.dispose() -> void
```

接口不提供以下方法：直接发送中继命令、绕过既有设置校验直接写设置、直接访问协议 JSON、直接设定任务阶段、直接设定媒体健康状态、自动重试、自动恢复任务、批量执行、全局停止所有飞机或按页面状态改变任务。

每个公开返回值和快照都必须是深度隔离、冻结的副本。任何不可信输入、依赖异常、订阅回调异常、设备断连、重复释放或迟到结果都不得把原始异常抛给调用方。

## 4. 依赖与装配

`OperationWorkflow.create` 只接受已构造的一级模块公开接口：

```ts
{
  readonly relayOperations: RelayOperationsAdapterInstance;
   readonly routeLibrary: RouteLibraryInstance;
   readonly missionControl: MissionControlInstance;
   readonly liveStreamControl: LiveStreamControlInstance;
   readonly mediaPipeline: MediaPipelineInstance;
  readonly flightControl: FlightControlInstance;
  readonly deviceSettings: DeviceSettingsPanelInstance;
  readonly hardwareReadiness: {
    readonly lanAddressAvailable: boolean;
    readonly legacyMediaAvailable: boolean;
  };
}
```

它还接收唯一的运行时选项 `now(): number`，用于调用既有 `mediaPipeline.evaluate(now)`。该函数必须返回非负有限毫秒数；不可用时 `refreshMedia()` 返回稳定失败，且不执行后续效果。模块不创建计时器，未来 Electron/IPC 装配或页面按固定频率调用 `refreshMedia()`。

`hardwareReadiness` 是装配根确认过的桌面事实。开始型操作只消费当前同一 Relay 会话的 `controlTelemetry`，它来自 Android 的持续 MSDK Key 订阅和首次异步硬件读取；不得用连接时间、缓存重读或一次操作前刷新推定状态可信。设备页显式刷新可以发送一次只读 `telemetry.read`，但该命令只回传当前已观察快照，不能重启或重建手机端 MSDK Key 观察。

`desktop-runtime` 负责启动、停止中继与媒体服务；`operation-workflow` 不得替代其生命周期职责。最外层生产装配根负责按下列顺序构造：

```text
NodeRuntime -> RelayLink -> RelayOperationsAdapter
RouteLibrary
MissionControl(航线库 + 任务中继门面)
LiveStreamControl(图传中继门面 + 媒体只读端点)
FlightControl(飞控中继门面)
DesktopRuntime(中继 + 媒体 + 图传控制生命周期)
OperationWorkflow(上述业务模块)
```

本模块只允许导入这些一级模块的公开入口和类型。禁止导入任何二级实现、Electron、Node 网络或文件 API、`ws`、地图引擎、React/Vue、Android/Kotlin、DJI SDK、FFmpeg、协议帧或原始命令对象。

## 5. 统一快照

```ts
interface OperationWorkflowSnapshot {
  readonly phase: "ready" | "disposed";
  readonly selectedRouteId: string | null;
  readonly routes: readonly WorkflowRoute[];
  readonly devices: readonly WorkflowDevice[];
  readonly selectedVideoDeviceId: string | null;
  readonly revision: number;
  readonly media: {
    readonly streams: readonly {
      readonly deviceId: string;
      readonly phase: string;
      readonly playbackUrl: string | null;
    }[];
  };
}
```

`routes` 按航线库顺序输出，包含安全的 `routeId`、显示名称、导入时间、航点数量、航线资格、是否当前选中、是否可上传以及预览可用性。预览的空间几何必须继续由 `route-library.getPreview()` 按需获取，不能在每次工作流快照中复制大量坐标。

`devices` 按 `deviceId` 字典序输出；每项必须包含：

```ts
interface WorkflowDevice {
  readonly deviceId: string;
  readonly connection: {
    readonly relay: "online";
    /** 桌面最后成功验证一份手机遥测的时刻；仅供显示，不能授权控制。 */
    readonly telemetryReceivedAtMs: number | null;
    readonly sdk: "ready" | "not-ready" | "unknown";
    readonly msdk: "stopped" | "starting" | "ready" | "failed" | "unknown";
    readonly remoteController: "connected" | "disconnected" | "unknown";
    readonly flightController: "connected" | "disconnected" | "unknown";
    readonly aircraft: "connected" | "disconnected" | "unknown";
    readonly batteryPercent: number | null;
    readonly aircraftModel: string | null;
    readonly remoteControllerModel: string | null;
    readonly flightState: "grounded" | "flying" | "unknown";
    readonly motorsOn: boolean | null;
    readonly flightMode: string | null;
    readonly lowBatteryRthState: "IDLE" | "COUNTING_DOWN" | "EXECUTED" | "CANCELLED" | "unknown";
    readonly remainingFlightTimeSeconds: number | null; // DJI low-battery return-to-home estimate only
    readonly pairingState: "UNKNOWN" | "IDLE" | "PAIRING" | "PAIRED" | "STOPPING" | "FAILED" | "unknown";
    readonly pose: {
      readonly latitude: number | null;
      readonly longitude: number | null;
      readonly altitudeMeters: number | null;
    } | null;
    readonly live: {
      readonly streaming: boolean | null;
      readonly resolution: string | null;
      readonly fps: number | null;
      readonly videoBitrateKbps: number | null;
      readonly rttMillis: number | null;
    };
  };
  readonly capabilities: {
    readonly waypointMission: "supported" | "unsupported" | "unknown";
    readonly liveVideo: "supported" | "unsupported" | "unknown";
  };
  readonly assignment: {
    readonly routeId: string | null;
    readonly routeName: string | null;
  };
   readonly mission: MissionDispatchSnapshot;
   readonly preflight: PreflightSummary;
   readonly stream: StreamDispatchSnapshot;
   readonly video: {
    readonly phase: "unavailable" | "awaiting-ingest" | "awaiting-playback" | "ready" | "failed";
    readonly selected: boolean;
  };
  readonly settings: DeviceSettingsSnapshot;
  readonly pendingFlightAction: PendingConfirmation | null;
}
```

`sdk` 仅表示来自安全适配层的 SDK 门禁事实，不能替代遥控器、飞控或飞机连接状态。`msdk` 是独立的精确 DJI MSDK 生命周期事实，用于设备页观察；它不改变 `sdk` 的既有门禁语义，也不代表飞机或图传状态。`connection` 与 `control` 必须投影自同一 Relay 会话中的当前 MSDK 设备事实；`control` 只是该事实的最小门禁视图，不能来自另一条命令结果缓存。`telemetryReceivedAtMs` 是桌面验证收到当前遥测的时间，可能为 `null`；它只供显示，绝不能因年龄增长而单独使 `control` 失效。会话替换、MSDK 观察重建或明确的未知/断开事实才会改变门禁。

`preflight` 必须直接投影任务控制的同一套启动前检查结果，包含 `ready` 与按既有契约固定排序的阻塞项；不得创建第二套规则。只有“已上传任务”的设备才可以是 `ready`。其它任务阶段一律返回 `not-applicable`，而不是假装预检通过。

媒体管线未运行、设备还未推流、HTTP-FLV 分发未就绪或视频播放器未选择时，视频均不可被报告为 `ready`。快照不得含 `playbackUrl`；未来 IPC 白名单可单独提供受控播放资源入口。任务、手机图传控制和本机播放必须始终作为三项独立运行事实输出：任务不能由图传成功推导，手机接受推流命令不能由此推导本机播放，播放失败也不能修改 DJI 任务或飞控状态。

## 6. 航线管理与分配规则

1. `importRoute(input, cancellation?)` 只调用 `routeLibrary.importFile`；它接收调用方已读取的文件名与字节，不读取本地文件系统。成功导入后发布新快照；拒绝、取消或重复导入保持航线库既有语义。
2. `getRoutePreview(routeId)` 只调用 `routeLibrary.getPreview(routeId)`；它不初始化或驱动地图引擎。
3. `selectRoute(routeId)` 只调用 `routeLibrary.select(routeId)`；成功后更新 `selectedRouteId`，失败保留旧选择。
4. `removeRoute(routeId)` 必须先检查当前分配：被任何设备分配的航线一律拒绝删除，直到所有关联设备清除分配；通过后才调用 `routeLibrary.remove(routeId)`。删除只针对这一条航线。若删除的是当前选中航线，工作流必须采用航线库返回的剩余选择；库为空时才将 `selectedRouteId` 置为 `null`。非当前选中航线被删除时，保留原选择。
5. `assignRoute(deviceId, routeId)` 仅对当前在线设备和航线库中的 `upload-candidate` 航线成功。它不暂存、不上传、不改变飞行器状态。
6. 若设备任务处于 `staging`、`staged`、`uploading`、`uploaded`、`starting`、`running`、`pausing`、`paused`、`resuming` 或 `stopping`，重新分配必须被拒绝，避免 UI 把在途任务的航线解释为另一条。
7. `clearAssignment(deviceId)` 只允许没有活动任务时执行；它不删除航线库文件，也不调用 `missionControl.forget`。
8. 路线库中的当前选中航线变化不得自动替换任何设备既有分配。

## 7. 航线任务规则

对于一个已分配设备，工作流操作固定映射为：

```text
stage(deviceId)  -> missionControl.stage(deviceId, assignedRouteId)
upload(deviceId) -> missionControl.upload(deviceId)
start(deviceId)  -> missionControl.start(deviceId)
pause(deviceId)  -> missionControl.pause(deviceId)
resume(deviceId) -> missionControl.resume(deviceId)
stop(deviceId)   -> missionControl.stop(deviceId)
```

工作流不得跳过、合并或自动串联这些操作。`stage`、`pause`、`resume`、`stop` 只要求手机仍在线；`upload` 与 `start` 必须使用当前同会话的完整 `controlTelemetry` 进入下游预检，不得在操作前发送 `telemetry.read` 或重建 MSDK Key 观察。该事实缺失、畸形或会话变化均返回 `CONTROL_STATE_UNAVAILABLE`，且不发送 `wayline.*`。每次操作必须等待其结果，保持下游 `MissionDispatchSnapshot` 的原始阶段含义：

| 阶段/结果 | 对操作者的准确含义 |
| --- | --- |
| `staged` | 手机端已保存航线，飞机尚未确认收到。 |
| `uploaded` | 飞机端航线上传已确认完成。 |
| `starting` | DJI 已接受启动请求，尚未得到实际执行证明。 |
| `running` | 已收到匹配当前任务的 `ROUTE_EXECUTION_STARTED`。 |
| `completed` | 收到匹配当前任务的完成遥测。 |
| `failed` | 下游任务失败，保留失败码。 |
| `disconnected` | 设备已断连，旧任务不能恢复。 |

`start` 的失败结果必须携带下游预检阻塞项。工作流不得弱化为“启动失败”，也不得把 `wayline.start` 成功显示为“正在执行”。

任务完成、失败、停止或断连后，操作者若要再次执行，必须再次显式分配（如已被清除）、暂存、上传和启动；模块绝不复用旧任务 ID 或自动继续。

## 8. 图传与媒体规则

1. `refreshDeviceState(deviceId)` 是设备页的显式只读刷新入口。它仅发送一次 `telemetry.read` 并返回稳定结果；成功只表示桌面取得了当次手机状态，绝不表示飞机或图传就绪，也不发送 DJI、任务、图传或飞控命令。
2. `checkHardwareReadiness(deviceId)` 只评估当前中继上报的显示事实，返回生产图传与直接飞控两个独立的 `hardware-readiness` 结果及按稳定优先级去重后的阻塞项。它不发送任何中继、DJI 或媒体命令。
3. `startStream(deviceId)` 在委托 `live-stream-control.start` 前必须取得当前同会话的控制遥测，再通过基于该控制事实的 `legacy-video` 实机预检；事实缺失、畸形或会话变化返回 `CONTROL_STATE_UNAVAILABLE`，不发送启动命令。该预检只检查电脑媒体服务、在线中继和 MSDK 已就绪；它不以遥控器或飞控作为图传门槛。预检未通过返回 `{ ok: false, code: "HARDWARE_NOT_READY", value }`，且不得向手机发送启动命令。预检通过后，`live-stream-control` 必须以同会话手机实时 `capabilities.liveVideo === true` 作为最终启动门禁；该值由手机端的 `ProductKey.KeyConnection`、`AirLinkKey.KeyConnection` 与 `CameraKey.KeyConnection(LEFT_OR_MAIN)` 三态共同推导。值缺失或为 false 只能表示当前图传链路未就绪，绝不表示机型永久不支持。由 DJI 完成回调与 RTMP 入流确认真实结果。
4. `stopStream(deviceId)` 不经过实机预检或控制遥测读取，仍只委托 `live-stream-control`，确保操作者总能停止旧图传。
4. 图传开始成功只能显示“手机端已开始推流”；只有媒体快照中同设备进入 `ready` 才能显示“画面可用”。
5. `selectVideo(deviceId)` 仅允许该设备视频已经 `ready`；它委托 `mediaPipeline.selectPlayer(deviceId)`，失败时不改变原视频选择。生产渲染器在成功附着当前图传机的 HTTP-FLV 播放器时必须调用该入口，使主进程选择状态与实际播放器目标一致；该选择本身不等同于首帧已经绘制。
6. 图传与航线任务彼此独立：可以在航线开始前或飞行期间启动；图传失败不修改任务状态，任务失败不替其他设备停止图传。
7. 设备断连时，工作流必须调用 `liveStreamControl.recordDisconnected(deviceId)`。同一设备编号换了会话时同样必须复位生产 RTMP 图传车道，不得继续显示“已启动”。任何迟到图传结果都不得覆盖断连状态。重新连接后必须由操作者重新启动图传。
8. `clearVideo()` 只清空本地播放器选择，不向手机发送停止推流命令。
9. `refreshMedia()` 调用已运行媒体管线的 `mediaPipeline.evaluate(now())`，并据其返回的既有媒体快照更新工作流快照。它不启动媒体服务、不构造 RTMP 地址，也不创建额外的转码、播放或健康状态机。仅当媒体快照中某在线设备已 `failed`、且该设备图传仍为 `starting` 或 `streaming` 时，必须对该设备调用 `stopStream`；设备已离线时不得补发停止。
10. `notifyPlaybackReady(deviceId)` 只委托 `mediaPipeline.notifyPlaybackReady(deviceId)`。生产路径在 RTMP publish 时已由 `media-pipeline` 自行标记 ready；该入口保留为幂等补标，不启动图传。

## 9. 设备设置规则

1. 四个设置操作只委托注入的 `deviceSettings`：图传设置读取/写入对应 `readTransmission`/`writeTransmission`，相机设置读取/写入对应 `readCamera`/`writeCamera`。
2. 每次设置操作前，工作流必须取得当前同会话控制遥测，再以该事实调用既有 `CapabilityGate.evaluate`，操作名分别为 `transmission-settings` 或 `camera-settings`。事实缺失、畸形或会话变化返回 `CONTROL_STATE_UNAVAILABLE`；门禁失败时不得调用设置模块。
3. 设备快照应包含 `deviceSettings.snapshot(deviceId)` 的已确认设置快照和请求中标识。写入成功只能展示手机端 DJI 回调返回的完整确认快照，禁止以提交补丁作乐观更新。
4. 设置读取、写入、超时、拒绝、畸形结果和同设备同域并发语义全部保持 `device-settings-panel` 契约；工作流不解析字段、不维护机型枚举，也不将设置失败归类为任务或图传失败。
5. 设备断连后，后续设置结果不得重新出现在在线设备视图；同设备的新会话必须重新读取设置。

## 10. 直接飞控规则

1. `requestFlightAction` 在委托 `flightControl.request` 前必须取得当前同会话控制遥测，再通过基于该事实的 `flight-control` 实机预检；事实缺失、畸形或会话变化返回 `CONTROL_STATE_UNAVAILABLE`，且不得创建确认或向手机发送飞控请求。预检未通过时返回 `{ ok: false, code: "HARDWARE_NOT_READY", value }`。通过后只委托 `flightControl.request`，从不直接发送命令。
2. `confirmFlightAction` 在消费确认、可能发送飞控命令之前，必须再次取得当前同会话控制遥测；事实缺失、畸形或会话变化返回 `CONTROL_STATE_UNAVAILABLE`，且必须保留原待确认动作，以便操作者在恢复控制状态后重试或显式取消。只有已实际委托确认或确认本身被下游拒绝、过期时才可清除该待确认动作。`cancelFlightAction` 不需要控制遥测或实机预检。确认不可跨设备、跨动作、重复或过期复用。
3. 起飞、降落、返航始终属于独立的人工安全动作，不由航线暂存、上传、启动、暂停、恢复、停止或设备重连隐式触发。
4. 飞控命令成功只表示 DJI 调用完成；工作流必须等待后续遥测再显示飞机实际飞行状态。
5. 工作流只保存由 `requestFlightAction` 返回的待确认 ID。设备断连时，如该动作仍未确认，工作流只能调用既有 `flightControl.cancel(deviceId, confirmationId)` 取消确认；它绝不补发飞控命令。已经发送中的 DJI 调用不可由本模块撤销，其迟到结果也不得让离线设备重新出现在工作流快照中。

## 11. 断连、异常与释放

`operation-workflow` 必须订阅中继设备、任务、图传和飞控的既有订阅接口；媒体状态只由 `refreshMedia()` 从既有媒体快照读取。某在线设备从中继快照消失时，必须在同一次工作流更新中：

1. 从 `devices` 移除该设备；
2. 清除该设备的本地航线分配；
3. 让 `mission-control` 保留其 `disconnected` 任务终态；
4. 调用 `live-stream-control.recordDisconnected(deviceId)`；
5. 用保存的确认 ID 取消该设备尚未确认的直接飞行动作；
6. 不发送 `wayline.stop`、`live-stream.stop` 或任何飞控命令；
7. 不自动重连、不自动重传、不自动恢复任务或图传。

同一 `deviceId` 仍在线但 `sessionId` 已替换时，同样必须：取消尚未确认的直接飞行动作、复位图传车道；不得让旧确认对话框在新会话上继续可点。

设备页连接快照必须直接显示同一包遥测中的 `sdkAvailability`、`remoteController`、`flightController`、`aircraft`、`airLink`、`camera` 与 `pairing`，只将每个封闭状态值一对一翻译为操作员中文；不得使用 `sdkRegistered`、`remoteControllerConnected`、`flightControllerConnected`、`connected` 或 `pairingState` 等兼容投影，不得组合多个状态，也不得施加连接滞回。每个设备快照仍须输出同一次控制遥测的 `control` 连接事实，供操作台提前提示与禁用明显不满足前置条件的操作；它不是后端授权。图传启动、直接飞控、设备设置、航线上传或航线启动分别只接受当前同会话的完整控制遥测；事实缺失、会话变化、明确 `false` 或 `unknown` 都必须拒绝新操作。

同 ID 的新手机会话后续重新出现时被视为新在线设备：旧任务和旧图传都不得复活，操作者必须重新分配、暂存、上传、启动和开始图传。

所有依赖异常都必须收敛为稳定、可显示的工作流错误码；不得泄露原始异常、地址、端口、文件路径、令牌、会话标识或 DJI 文本。某一个订阅者抛出异常不得阻碍其它订阅者或破坏已提交状态。

`dispose()` 必须幂等：释放全部订阅、清空本地分配和视频选择、停止对外发布；它不停止桌面运行时、不停止媒体服务、不发送任务/图传/飞控命令，也不删除航线库内容。

## 12. 前端与 IPC 的后续职责

本模块不包含前端，但为未来三页提供唯一业务入口：

| 页面 | 只能消费的工作流能力 |
| --- | --- |
| 设备 | `snapshot.devices` 的连接、能力、设置入口和安全反馈。 |
| 航线 | `snapshot.routes`、航线选择、航线预览数据、分配与删除前置条件。 |
| 飞行 | 设备-航线分配、任务操作、预检、图传、视频选择和直接飞控确认。 |

未来 IPC 只能暴露本模块上述白名单操作及受控航线预览/播放资源读取，不得把下游模块实例、WebSocket、文件路径、RTMP 地址、FFmpeg 参数或 DJI 对象交给渲染进程。

## 13. 验收与测试

实现已经按下列二级模块拆分；每个二级模块都有独立中文契约。后续修改必须保持职责归属不变：

| 二级模块 | 唯一职责 |
| --- | --- |
| `workflow-snapshot` | 从各一级模块快照构造、冻结和排序统一工作流快照。 |
| `assignment-registry` | 管理设备-航线分配及其失效规则，不发送命令。 |
| `workflow-actions` | 校验工作流操作并委托正确下游模块，含设置门禁，不维护下游状态机。 |
| `workflow-subscriptions` | 汇合订阅、隔离监听器异常、处理断连和释放。 |

测试必须经由 `OperationWorkflow` 公开接口覆盖：

1. 所有工作流动作的精确委托、非法阶段拒绝、错误码和冻结返回值；
2. 航线导入的成功、拒绝、取消和重复语义，航线选择与预览，合格/不合格航线分配、在途任务禁止重分配、删除已分配航线拒绝；
3. 所有任务阶段及“暂存/上传/启动接受/实际执行”的严格区分；
4. 全部预检阻塞项、空设备、未知能力、电量边界和设备状态未知；
5. 图传控制成功、媒体刷新中的媒体未到达、HTTP-FLV 分发未就绪、可播放、播放器失败、时钟失败和视频选择切换；
6. 三项直接飞控动作、一次性确认、取消、过期、跨设备隔离和遥测迟到；
7. 两类设备设置的读取、写入、门禁、完整确认快照、同设备同域互斥和多设备隔离；
8. 断连、会话替换、迟到任务/图传/飞控结果、重复释放和订阅者异常；
9. 与 `desktop-runtime`、`relay-operations-adapter`、`route-library`、`mission-control`、`live-stream-control`、`media-pipeline`、`flight-control` 的跨公开接口集成测试；
10. 类型测试、模块范围 100% 语句/分支/函数/行覆盖率、性能测试、架构边界测试和 Stryker 变异测试 100%。

跨端验证模块必须新增包含多设备、航线时序、图传播放状态、直接飞控确认、断连及资源清理的真实 WebSocket + Kotlin Harness 场景。通过该验证只能证明定义的软件边界一致；Android 权限、DJI 注册、遥控器、真实机型、真实 KMZ/WPML、相机/AirLink 与无线环境仍必须真机验证。
