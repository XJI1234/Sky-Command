# 飞行任务调度器模块契约

状态：已批准实施

## 1. 职责

`mission-dispatcher` 是桌面端 `mission-control` 的有副作用编排子模块。它把一条已合格的 KMZ 暂存到指定中继手机，再显式请求该手机上传、启动、暂停、恢复或停止航线。每个 `deviceId` 拥有完全独立的任务轨道，并向上层提供不可变调度快照。

它是桌面端唯一允许发送下列业务命令名的模块：

```text
wayline.upload
wayline.start
wayline.pause
wayline.resume
wayline.stop
```

它不解析、编辑、创建、持久化或选择航线；不编码协议帧、不管理 WebSocket 生命周期、不解释原始 DJI 错误；不调用 Android、DJI、Electron、图传或界面代码；不做自动起飞、返航、重试或恢复决策。`sendMission` 成功不等于飞机已收到航线，`wayline.start` 成功也不等于已观察到完整飞行结束。

## 2. 对外接口

```ts
MissionDispatcher.create(dependencies, options) -> MissionDispatcherInstance

instance.stage(deviceId, routeId) -> Promise<DispatchResult>
instance.upload(deviceId) -> Promise<DispatchResult>
instance.start(deviceId) -> Promise<DispatchResult>
instance.pause(deviceId) -> Promise<DispatchResult>
instance.resume(deviceId) -> Promise<DispatchResult>
instance.stop(deviceId) -> Promise<DispatchResult>
instance.recordDisconnected(deviceId) -> MissionDispatchSnapshot | null
instance.recordExecutionTerminal(deviceId, fileName, outcome) -> MissionDispatchSnapshot | null
instance.get(deviceId) -> MissionDispatchSnapshot
instance.list() -> readonly MissionDispatchSnapshot[]
instance.forget(deviceId) -> boolean
instance.subscribe(listener) -> unsubscribe
```

所有方法面对畸形或恶意 JavaScript 输入时，都返回稳定的拒绝结果、空结果或无操作，绝不泄露异常。所有返回对象和数组均是冻结副本。订阅不会回放虚构快照；每次已提交的轨道变化后发布一次。监听器异常或重入读取不得回滚已提交变化；退订可重复调用。

## 3. 依赖接口

构造函数只接收窄的结构化端口，而不是 UI 或传输类：

```ts
interface MissionRouteSource {
  getMissionPayload(routeId: string):
    | { readonly ok: true; readonly value: RouteMissionPayload }
    | { readonly ok: false; readonly error: { readonly code: string } };
}

interface MissionRelayGateway {
  sendMission(deviceId: string, payload: RelayMissionPayload): Promise<MissionSendOutcome>;
  sendCommand(deviceId: string, request: WaylineCommand): Promise<CommandSendOutcome>;
  latestTelemetry(deviceId: string): RelayTelemetry | null;
}
```

航线负载为 `{ routeId, fileName, sizeBytes, sha256, bytes }`；调度器复制为中继负载 `{ missionId, fileName, size, sha256, bytes }`。航线字节仅可经本次暂存操作离开航线源。每个命令固定包含 `{ confirm: true }`。

`createMissionId(deviceId, routeId)` 必须存在，且返回非空、无控制字符、最多 128 个 Unicode 码点的标识。每次被接受的 `stage` 尝试仅调用一次，绝不复用为命令 ID。工厂抛错为 `DEPENDENCY_FAILURE`；返回不可用标识为 `MISSION_ID_UNAVAILABLE`。畸形依赖响应同样为 `DEPENDENCY_FAILURE`，不得破坏轨道。

生产组合只能通过公开端口接入 `RouteLibrary`、`RelayLink`、`MissionPhaseDomain` 和 `PreflightCheck`，禁止导入它们的内部实现、协议编解码器、Android/Kotlin、DJI、Electron、Node Socket/文件系统 API 或 UI 框架。

## 4. 任务轨道

每个 `deviceId` 至多一个轨道：

```ts
interface MissionDispatchSnapshot {
  readonly deviceId: string;
  readonly routeId: string | null;
  readonly missionId: string | null;
  readonly phase: MissionPhase;
  readonly failureCode: string | null;
  readonly lastResult: LastDispatchResult | null;
}
```

`phase`、`missionId`、`failureCode` 只镜像该轨道状态机。`routeId` 在暂存被接受时设置，并跨终态保留以便界面解释。`lastResult` 仅为 `{ operation, ok, code }`，不得包含手机详情、路径、字节、令牌、连接/会话 ID 或堆栈。

设备轨道相互独立，不同设备可并发操作；同一轨道同时只能有一个异步操作，后续调用返回 `OPERATION_IN_PROGRESS` 且不产生网络效果。`forget` 仅允许删除 `idle`、`completed`、`failed` 或 `disconnected` 轨道，不发送停止命令；新的 `stage` 会创建新轨道。

## 5. 操作语义

### 暂存

`stage(deviceId, routeId)` 校验输入和当前阶段，从航线源读取一次负载，创建任务 ID，进入 `staging`，复制字节并调用 `sendMission` 一次。航线源拒绝为 `ROUTE_UNAVAILABLE`，不创建或修改轨道。中继成功才以 `stage-succeeded` 进入 `staged`；其他结果以 `MISSION_TRANSFER_FAILED` 进入 `failed`。

暂存成功只表示**手机已接收并保存 KMZ**，绝不表示 DJI 或飞机已接收。

### 上传

`upload` 仅允许从 `staged` 执行。它进入 `uploading`，发送 `{ name: "wayline.upload", fields: { confirm: true } }`，仅在中继确认成功后进入 `uploaded`。非成功结果为 `WAYLINE_UPLOAD_FAILED`。

### 启动

`start` 仅允许从 `uploaded` 执行。在任何出站命令前，它读取当前遥测并调用 `PreflightCheck.evaluate`；仅有遥测快照时 `relayConnected` 才为真，绝不从 WebSocket 或会话对象推导飞机连接状态。预检阻塞时返回 `PREFLIGHT_BLOCKED`，保持 `uploaded` 且不发送命令。通过后进入 `starting`，发送 `wayline.start`。命令成功只表示手机端已确认 DJI 接受启动调用；只有当前任务收到 `ROUTE_EXECUTION_STARTED` 后才进入 `running`，否则为 `WAYLINE_START_FAILED`。

### 暂停、恢复和停止

`pause` 只允许 `running -> pausing -> paused`；`resume` 只允许 `paused -> resuming -> running`；`stop` 只允许从 `starting`、`running` 或 `paused` 进入 `stopping`，成功后回到 `idle`。其中 `pausing` 和 `resuming` 表示等待手机端确认 DJI 调用，不能显示成最终状态。它们均发送相应命令和 `{ confirm: true }`。失败分别为 `WAYLINE_PAUSE_FAILED`、`WAYLINE_RESUME_FAILED`、`WAYLINE_STOP_FAILED`，停止失败不得静默回到 `idle`。上传完成但尚未启动时不得发送 `wayline.stop`，因为飞机端执行器此时仍是未开始。`starting` 期间允许停止，以便中止已接受但尚未进入执行回报的航线。`ROUTE_EXECUTION_STARTED` 可在启动命令仍在等待结果时把任务从 `starting` 转入 `running`；此后迟到的启动失败不得把已在执行的任务写成失败。

## 6. 断线和遥测

`recordDisconnected(deviceId)` 是供父模块调用的断线协调接口，只能在设备从已确认中继快照消失时调用。它不发送命令：活动轨道进入 `disconnected`、发布快照并返回该快照；未知、终态或已断线轨道返回 `null` 且不发布。它绝不重试、自动恢复或启动任务。

命令和暂存结果中的 `disconnected` 仍是该操作失败，不能伪装为成功。`recordExecutionTerminal` 只接受由中继任务状态读取器校验后的 `completed` 或 `failed`：设备、当前安全文件名和本任务的活动阶段必须同时匹配；`completed` 只可使 `starting` 或 `running` 进入 `completed`，`failed` 只可使仍活动的任务进入 `failed`。未知设备、终态、文件名不匹配、重复或迟到事实一律返回 `null`，不发布也不发送命令。调度器不会由自由格式遥测推断完成或暂停；上游必须先将 Android 的封闭 `missionExecution` 枚举校验为上述两种终态。

## 7. 结果与错误码

```ts
type DispatchResult =
  | { readonly ok: true; readonly operation: DispatchOperation; readonly state: MissionDispatchSnapshot }
  | { readonly ok: false; readonly operation: DispatchOperation; readonly code: DispatchErrorCode; readonly state: MissionDispatchSnapshot | null; readonly blockers?: readonly PreflightBlocker[] };
```

错误码固定为：`INVALID_DEVICE_ID`、`INVALID_ROUTE_ID`、`ROUTE_UNAVAILABLE`、`MISSION_ID_UNAVAILABLE`、`ILLEGAL_PHASE`、`OPERATION_IN_PROGRESS`、`DEPENDENCY_FAILURE`、`MISSION_TRANSFER_FAILED`、`WAYLINE_UPLOAD_FAILED`、`PREFLIGHT_BLOCKED`、`WAYLINE_START_FAILED`、`WAYLINE_PAUSE_FAILED`、`WAYLINE_RESUME_FAILED`、`WAYLINE_STOP_FAILED`。

`blockers` 只出现在 `PREFLIGHT_BLOCKED`，以 `PreflightCheck` 给出的稳定顺序复制并冻结。任何拒绝都不自动重试；只有已经尝试出站效果且收到非成功结果时才进入 `failed`。

## 8. 验证要求

测试必须覆盖六种操作的成功/拒绝、精确命令和确认字段、航线拒绝、预检顺序、无效或抛错依赖、字节隔离、同轨道并发拒绝、跨设备并发、终态删除、不可变性、监听器隔离及无出站效果的场景。类型测试必须拒绝原始帧、DJI 对象、Socket、无航线负载的字节和缺少 `confirm` 的命令。架构测试禁止平台、协议、文件系统、UI 和 Android/DJI 导入；性能测试必须证明大量同步拒绝和读取处于界面响应预算内；决策与阶段推进的模块范围变异测试必须为 100%。
