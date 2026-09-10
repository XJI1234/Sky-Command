# 起飞前检查模块契约

状态：已实施；航线启动前置条件已由定向契约测试验证

## 1. 职责

`preflight-check` 是直接飞行动作与航线命令可达性的纯决策模块。对航线上传和启动，它只判断桌面是否已知命令能进入当前手机会话中的已就绪 MSDK，并对启动保留已上传任务这一业务顺序；它绝不以本地电量、地面状态、遥控器、飞控或机型能力替 DJI 预先裁决。全部直接飞行动作同样只确认命令能送达已就绪的 MSDK；当前硬件条件及拒绝原因均由对应 DJI Action 的完成回调裁决。

它不发送命令、不改变设备状态、不上传文件、不读取航线字节，也不调用中继、Android、DJI、Electron 或 UI。调度器必须在发送 `wayline.start` 前立即调用它，调用方不得把拒绝结果简化为一个布尔值。

## 2. 对外接口

```ts
PreflightCheck.evaluate(input) -> PreflightResult
PreflightCheck.evaluateUpload(input) -> PreflightResult
```

For source compatibility, both methods may receive an optional `PreflightPolicy`
with `minimumBatteryPercent`; the value is retained but ignored. Battery and other
device-safety conditions are decided by DJI after the command reaches MSDK.

调用同步、确定、可重入，对不可信输入不抛异常。输入只读，返回对象和数组均为冻结副本。

## 3. 输入契约

```ts
interface PreflightInput {
  readonly relayConnected: boolean;
  readonly payload: {
    readonly sdkAvailability?: "STOPPED" | "STARTING" | "READY" | "FAILED" | "UNKNOWN";
    readonly remoteController?: "CONNECTED" | "DISCONNECTED" | "UNKNOWN";
    readonly flightController?: "CONNECTED" | "DISCONNECTED" | "UNKNOWN";
    readonly isFlying?: boolean;
    readonly motorsOn?: boolean;
    readonly batteryPercent?: number;
  };
  readonly capabilities: {
    readonly waypointMission?: boolean;
    readonly waypointMissionSupport?: "supported" | "unsupported";
  };
  readonly missionPhase: MissionPhase;
}
```

`sdkAvailability` 必须直接来自同一次手机 MSDK 生命周期观察。旧的 `sdkRegistered` 只允许迁移期兼容输入，不能覆盖存在的原始字段。航线和直接飞行的可达性只将 `sdkAvailability === READY` 视为已知可以调用 MSDK；`UNKNOWN`、缺失或非 MSDK 值均阻塞。遥控器、飞控、电量、飞行、电机和能力字段可以随同遥测传入，但本模块不得读取它们，避免将显示事实或无关读取错误变成命令阻断。

航线启动的 `missionPhase` 必须为 `uploaded`、`starting`、`pausing` 或 `resuming`：前两者表示当前任务身份已经由本系统上传确认，启动已发出或回执未确认但文件身份仍然有效；后两者表示暂停或恢复的回执未确认，任务文件身份仍然有效，允许改发启动。这些都不是 DJI 设备安全判断。本模块绝不推进状态机。不得把已确认的 `running` 或 `paused` 当成可启动阶段。

`evaluateUpload(input)` 复用同一输入结构，但只评估中继与 MSDK 可达性。它不读取任务阶段、遥控器、飞控、机型能力、电量、飞行状态或电机状态；任务调度器也复用这条无任务阶段的可达性检查来保护暂停、恢复和停止等其它 DJI 航线命令。航线是否可上传、机型是否支持、飞控是否接受以及 DJI 的具体拒绝原因，必须通过对应 MSDK 回调如实返回。

`evaluate(input)` 是航线启动的唯一纯门禁：除中继与 MSDK 可达性外，仅要求 `missionPhase` 为 `uploaded`、`starting`、`pausing` 或 `resuming`。航线是否符合机型、是否满足飞行条件、是否已能执行及其具体拒绝原因，必须由 `startMission` 的完成回调裁决。回调中的 `IDJIError` 必须作为受限的错误码与说明传回桌面；无终态不得伪装成拒绝。

## 4. 直接飞行动作接口

```ts
PreflightCheck.evaluateFlightAction(input) -> PreflightResult
```

`input.action` 只能是 `takeoff`、`land`、`confirm-landing`、`return-home`、`stop-takeoff` 或 `stop-auto-landing`。它不读取任务阶段、航线能力、遥控器、飞控、电量、飞行状态、电机或降落确认状态。所有动作都要求当前中继会话存在且 MSDK 明确为 `READY`；这是桌面可以确认命令能送达并安全调用 MSDK 的最小条件。只要该条件满足，就必须把准确的 Action 交给 MSDK；MSDK 拒绝时保留其原始错误，未获得终态时报告结果未确认。本模块绝不自动调用动作。

直接飞行动作仍必须由 `flight-control` 创建一次性确认。确认消费前，调度器重新读取原始遥测并再次调用本接口；任一动作的最小可达性不再满足时均不得发送命令。

## 5. 阻塞项和顺序

结果必须按以下顺序输出且不重复：

1. `INVALID_INPUT`
2. `RELAY_DISCONNECTED`
3. `SDK_NOT_READY`
4. `MISSION_NOT_UPLOADED`

`evaluateUpload` 仅可返回 `RELAY_DISCONNECTED` 或 `SDK_NOT_READY`（非法输入除外）。`evaluate` 仅可在此基础上返回 `MISSION_NOT_UPLOADED`。二者不产生任何设备能力、连接或动态飞行事实阻塞项。全部直接飞行动作只可返回 `RELAY_DISCONNECTED` 或 `SDK_NOT_READY`（非法输入除外）。

`ProductKey.KeyConnection` 的原始值保留在 Relay 诊断遥测中，但不属于任一预检输入，也不得作为飞行器、飞控、航线、直接飞行或设置操作的门禁。

每项为 `{ code, message }`；消息短小、可显示，且不得泄露 payload、路径、设备 ID 或第三方错误。对频是连接新飞机或更换遥控器时的独立维护操作，不属于已上传航线的启动前置条件。

## 6. 结果

```ts
type PreflightResult =
  | { readonly ok: true; readonly blockers: readonly [] }
  | { readonly ok: false; readonly blockers: readonly PreflightBlocker[] };
```

仅当阻塞列表为空时 `ok` 才为真。结果不保留输入对象引用。

## 7. 依赖边界和验证

本模块只使用语言标准库。禁止导入平台、传输、航线、UI、文件系统和 DJI 实现。

测试必须覆盖上传、航线启动与全部直接动作的完全通过、每个阻塞项、组合阻塞顺序，以及动作隔离（上传、启动和全部直接动作均不读取遥控器、飞控、能力、地面、电量或电机事实）。还必须覆盖缺失字段、抛错 getter、不可变性及重复评估，并纳入类型、覆盖率、性能、审计和模块范围 100% 变异测试。
