# 起飞前检查模块契约

状态：已实施；航线启动前置条件已由定向契约测试验证

## 1. 职责

`preflight-check` 是直接飞行动作与航线启动的纯决策模块。它评估脱离引用的桌面端设备快照、任务阶段和最低电量策略，并按固定顺序返回全部阻塞原因。开始型动作采用完整安全前置条件；收尾型飞行动作只确认命令能送达已就绪的 MSDK，把当前飞行条件交给 DJI Action 回调裁决。

它不发送命令、不改变设备状态、不上传文件、不读取航线字节，也不调用中继、Android、DJI、Electron 或 UI。调度器必须在发送 `wayline.start` 前立即调用它，调用方不得把拒绝结果简化为一个布尔值。

## 2. 对外接口

```ts
PreflightCheck.evaluate(input, policy?) -> PreflightResult
PreflightCheck.evaluateUpload(input) -> PreflightResult
```

调用同步、确定、可重入，对不可信输入不抛异常。`policy.minimumBatteryPercent` 默认 `20`，只能是 `1..100` 的整数；无效策略返回 `INVALID_POLICY` 阻塞项。输入只读，返回对象和数组均为冻结副本。

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

`sdkAvailability`、`remoteController` 和 `flightController` 必须直接来自同一次手机 MSDK 遥测。预检只把 `READY`、`CONNECTED` 视为满足条件；`UNKNOWN`、缺失或非 MSDK 值均阻塞。旧的 `sdkRegistered`、`remoteControllerConnected` 和 `flightControllerConnected` 只允许迁移期兼容输入，不能覆盖存在的原始字段。

缺失或畸形的安全字段一律视为阻塞，不得采用“默认安全”。`missionPhase` 必须为 `uploaded`；本模块绝不推进状态机。

`evaluateUpload(input)` 复用同一输入结构，但只评估中继、MSDK、遥控器、飞控与航线能力；它不读取任务阶段、电量、飞行状态或电机状态。它是航线从手机上传到飞机前的唯一纯门禁，避免把启动航线的地面条件错误施加到上传阶段。

## 4. 直接飞行动作接口

```ts
PreflightCheck.evaluateFlightAction(input, policy?) -> PreflightResult
```

`input.action` 只能是 `takeoff`、`land`、`confirm-landing`、`return-home`、`stop-takeoff` 或 `stop-auto-landing`。它不读取任务阶段或航线能力。所有动作都要求当前中继会话存在且 MSDK 明确为 `READY`；这是桌面可以确认命令能送达并安全调用 MSDK 的最小条件。其余要求按动作分离，不能复用航线预检后再删除部分阻塞项：

- `takeoff` 是开始型动作。它额外要求遥控器和飞控明确连接、有效电量不低于策略下限、明确 `isFlying === false`、明确 `motorsOn === false`。飞行状态未知为 `FLIGHT_STATE_UNKNOWN`；已在飞行为 `AIRCRAFT_ALREADY_FLYING`；电机状态未知为 `MOTOR_STATE_UNKNOWN`；电机已开为 `MOTORS_RUNNING`。
- `land`、`confirm-landing`、`return-home`、`stop-takeoff`、`stop-auto-landing` 是收尾或恢复型动作。它们不因遥控器/飞控连接、飞行状态、飞行模式、降落确认需求、电量或电机状态被桌面端硬拦截。只要最小可达性已确认，就必须把准确的 Action 交给 MSDK；MSDK 拒绝时保留其原始错误，未获得终态时报告结果未确认。它们绝不由本模块自动调用。

直接飞行动作仍必须由 `flight-control` 创建一次性确认。确认消费前，调度器重新读取原始遥测并再次调用本接口；`takeoff` 的完整启动条件或任一动作的最小可达性不再满足时均不得发送命令。

## 5. 阻塞项和顺序

结果必须按以下顺序输出且不重复：

1. `INVALID_INPUT`
2. `INVALID_POLICY`
3. `RELAY_DISCONNECTED`
4. `SDK_NOT_READY`
5. `REMOTE_CONTROLLER_DISCONNECTED`
6. `AIRCRAFT_DISCONNECTED`（兼容原因码；唯一物理来源是 `FlightControllerKey.KeyConnection`，不读取 `ProductKey.KeyConnection`）
7. `WAYPOINT_UNSUPPORTED`
8. `MISSION_NOT_UPLOADED`
9. `BATTERY_UNKNOWN`
10. `BATTERY_LOW`
11. `FLIGHT_STATE_UNKNOWN`
12. `AIRCRAFT_ALREADY_FLYING`
13. `MOTOR_STATE_UNKNOWN`
14. `MOTORS_RUNNING`
15. `AIRCRAFT_ON_GROUND`（仅 `land`、`confirm-landing` 与 `return-home`）
16. `LANDING_CONFIRMATION_NOT_REQUIRED`（仅 `confirm-landing`）

`evaluateUpload` 仅可返回前七项中的 `RELAY_DISCONNECTED`、`SDK_NOT_READY`、`REMOTE_CONTROLLER_DISCONNECTED`、`AIRCRAFT_DISCONNECTED`、`WAYPOINT_UNSUPPORTED`；它不产生 `MISSION_NOT_UPLOADED` 或任何动态飞行事实阻塞项。收尾型直接飞行动作只可返回 `RELAY_DISCONNECTED` 或 `SDK_NOT_READY`（非法输入/策略除外）。

`ProductKey.KeyConnection` 的原始值保留在 Relay 诊断遥测中，但不属于任一预检输入，也不得作为飞行器、飞控、航线、直接飞行或设置操作的门禁。

每项为 `{ code, message }`；消息短小、可显示，且不得泄露 payload、路径、设备 ID 或第三方错误。对频是连接新飞机或更换遥控器时的独立维护操作，不属于已上传航线的启动前置条件。电量缺失、非数值或不在 `0..100` 时为 `BATTERY_UNKNOWN`；仅有效电量低于策略下限时为 `BATTERY_LOW`。对于 `takeoff`，`isFlying` 与 `motorsOn` 都必须严格为布尔值 `false`；缺失、字符串、数值、null 或其他畸形值分别为未知状态，不能用任何默认值放行。

## 6. 结果

```ts
type PreflightResult =
  | { readonly ok: true; readonly blockers: readonly [] }
  | { readonly ok: false; readonly blockers: readonly PreflightBlocker[] };
```

仅当阻塞列表为空时 `ok` 才为真。结果不保留输入对象引用。

## 7. 依赖边界和验证

本模块只使用语言标准库。禁止导入平台、传输、航线、UI、文件系统和 DJI 实现。

测试必须覆盖上传、航线启动与全部直接动作的完全通过、每个阻塞项、组合阻塞顺序、电量边界、动作隔离（上传不读取地面、电量或电机事实；起飞不可在电机已开时放行；收尾型动作只因中继不可达或 MSDK 未就绪被拦截）、无效策略、缺失字段、抛错 getter、不可变性及重复评估；并纳入类型、覆盖率、性能、审计和模块范围 100% 变异测试。
