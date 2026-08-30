# 航线任务阶段领域模块契约

状态：已批准实施

## 1. 职责

`mission-phase-domain` 是单条航线任务的纯状态机。它接收明确的生命周期事件，返回下一个不可变状态或稳定的转换错误，并且只定义哪些阶段转换合法。

它不发送命令、不读取航线文件、不检查遥测和设备能力、不访问 Electron、WebSocket、Android、DJI 或界面。调度器只在外部效果已请求或已收到结果后调用它，因此一次命令失败绝不能被误写成任务成功阶段。

## 2. 对外接口

```ts
MissionPhaseDomain.create(initialState?) -> MissionPhaseMachine

machine.state() -> MissionPhaseState
machine.transition(event) -> TransitionResult
machine.reset() -> MissionPhaseState
```

`MissionPhaseDomain` 是冻结的工厂。每个状态机同一时间只拥有一个任务；所有返回状态和错误都与调用方输入脱离引用且不可变。非法事件或非法转换绝不抛出异常。

## 3. 状态模型

`MissionPhaseState` 为 `{ missionId, phase, failureCode }`：

| 阶段 | 含义 |
| --- | --- |
| `idle` | 没有已暂存或正在执行的任务。 |
| `staging` | 正在把任务文件发送到手机。 |
| `staged` | 手机已接收并保存任务文件。 |
| `uploading` | 手机正在把任务上传到飞机。 |
| `uploaded` | 飞机已接收任务，可以启动。 |
| `starting` | 启动命令已发出或其回执不确定，等待可信的进入执行状态或人工停止。 |
| `running` | 任务正在执行。 |
| `pausing` | 暂停请求已发送且尚未获得确定回执；不能重发暂停，但可以停止。 |
| `paused` | 任务已暂停，可以恢复或停止。 |
| `resuming` | 继续请求已发送且尚未获得确定回执；不能重发继续，但可以停止。 |
| `stopping` | 停止请求已发送且尚未获得确定回执；不能重发或暂存替换。 |
| `completed` | 飞机正常完成任务。 |
| `failed` | 某项已尝试操作失败。 |
| `disconnected` | 活动任务期间手机或飞机链路消失。 |

除 `idle` 外每个阶段必须带有效 `missionId`，但本模块不解释其内容。`failureCode` 只允许出现在 `failed`；其他阶段必须为 `null`。

## 4. 事件和合法转换

| 事件 | 允许来源 | 目标 |
| --- | --- | --- |
| `stage-requested { missionId }` | `idle`、`completed`、`failed`、`disconnected` | `staging` |
| `stage-succeeded { missionId }` | `staging` | `staged` |
| `upload-requested` / `upload-succeeded` | `staged` / `uploading` | `uploading` / `uploaded` |
| `start-requested` / `start-succeeded` | `uploaded` / `starting` | `starting` / `running` |
| `pause-requested` / `pause-succeeded` | `running` / `pausing` | `pausing` / `paused` |
| `resume-requested` / `resume-succeeded` | `paused` / `resuming` | `resuming` / `running` |
| `stop-requested` / `stop-succeeded` | `starting`、`running`、`pausing`、`paused`、`resuming`、`disconnected` / `stopping` | `stopping` / `idle` |
| `mission-completed` | `starting`、`running`、`disconnected` | `completed` |
| `operation-failed { code }` | `staging`、`uploading`、`starting`、`running`、`pausing`、`paused`、`resuming`、`stopping`、`disconnected` | `failed` |
| `connection-lost` | 任一活动阶段 | `disconnected` |
| `reset` | 任意阶段 | `idle` |

`pausing` 与 `resuming` 都表示命令请求中，界面不得把它们显示成已完成。暂停或继续的命令结果成功后，调度器才发送对应的 `*-succeeded` 事件。对于已经发出的启动、暂停、继续或停止，非成功传输结果不能证明 DJI 动作未生效，调度器必须保留该中间阶段而非发送 `operation-failed`；这些阶段仅允许一次 `stop-requested` 作为保守处置。`disconnected` 不能自动恢复、上传或启动；手机已重新在线时，它只允许操作者显式发送一次停止，或接收带完全匹配任务身份的 DJI 终态。`mission-completed` 与 `stop-succeeded` 不同：前者表示飞机完成任务，后者表示操作者终止任务。允许从 `starting` 或 `disconnected` 进入 `completed` 仅适用于已经绑定同一手机任务身份的终态遥测；它不伪造 `running`。

带其他任务标识的事件返回 `MISSION_ID_MISMATCH`；没有标识的事件作用于当前任务。只有 `reset` 可以清除任务标识。

## 5. 结果和错误

```ts
type TransitionResult =
  | { ok: true; state: MissionPhaseState }
  | { ok: false; error: MissionPhaseError }

type MissionPhaseErrorCode =
  | "INVALID_EVENT"
  | "INVALID_MISSION_ID"
  | "MISSION_ID_MISMATCH"
  | "ILLEGAL_TRANSITION";
```

错误包含当前阶段和简短稳定的说明，但不含文件内容、路径、连接标识、设备细节或第三方异常。失败转换不改变当前状态。

## 6. 安全和依赖边界

`create()` 默认构造 `idle`；畸形初始状态回退为新的 `idle`，工厂本身不抛异常。`transition()` 同步、确定且可重入；重复事件除 `reset` 外均被拒绝。本模块无副作用，可安全运行于 Node、浏览器和测试进程。

禁止导入 `relay-link`、`route-library`、`desktop-settings`、Electron、WebSocket、Node 文件/网络 API、Android、DJI 及 UI 框架。

## 7. 验证要求

测试必须覆盖所有合法边、全部错误码、任务标识隔离、不可变快照、每个阶段的重置、重入读取和有界的大量转换序列。必须参与类型、覆盖率、性能、依赖审计及模块范围 100% 变异测试。
