# 起飞前检查模块契约

状态：已批准实施

## 1. 职责

`preflight-check` 是单条已上传航线在启动前的纯决策模块。它评估脱离引用的桌面端设备快照、任务阶段和最低电量策略，并按固定顺序返回全部阻塞原因。

它不发送命令、不改变设备状态、不上传文件、不读取航线字节，也不调用中继、Android、DJI、Electron 或 UI。调度器必须在发送 `wayline.start` 前立即调用它，调用方不得把拒绝结果简化为一个布尔值。

## 2. 对外接口

```ts
PreflightCheck.evaluate(input, policy?) -> PreflightResult
```

调用同步、确定、可重入，对不可信输入不抛异常。`policy.minimumBatteryPercent` 默认 `20`，只能是 `1..100` 的整数；无效策略返回 `INVALID_POLICY` 阻塞项。输入只读，返回对象和数组均为冻结副本。

## 3. 输入契约

```ts
interface PreflightInput {
  readonly relayConnected: boolean;
  readonly payload: {
    readonly sdkRegistered?: boolean;
    readonly remoteControllerConnected?: boolean;
    readonly flightControllerConnected?: boolean;
    readonly connected?: boolean;
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

缺失或畸形的安全字段一律视为阻塞，不得采用“默认安全”。`missionPhase` 必须为 `uploaded`；本模块绝不推进状态机。

## 4. 阻塞项和顺序

结果必须按以下顺序输出且不重复：

1. `INVALID_INPUT`
2. `INVALID_POLICY`
3. `RELAY_DISCONNECTED`
4. `SDK_NOT_READY`
5. `REMOTE_CONTROLLER_DISCONNECTED`
6. `AIRCRAFT_DISCONNECTED`
7. `WAYPOINT_UNSUPPORTED`
8. `MISSION_NOT_UPLOADED`
9. `BATTERY_UNKNOWN`
10. `BATTERY_LOW`
11. `FLIGHT_STATE_UNKNOWN`
12. `AIRCRAFT_ALREADY_FLYING`
13. `MOTOR_STATE_UNKNOWN`
14. `MOTORS_RUNNING`

每项为 `{ code, message }`；消息短小、可显示，且不得泄露 payload、路径、设备 ID 或第三方错误。电量缺失、非数值或不在 `0..100` 时为 `BATTERY_UNKNOWN`；仅有效电量低于策略下限时为 `BATTERY_LOW`。缺失 `isFlying` 或 `motorsOn` 分别为未知状态，不能误报为正在飞行或电机运行。

## 5. 结果

```ts
type PreflightResult =
  | { readonly ok: true; readonly blockers: readonly [] }
  | { readonly ok: false; readonly blockers: readonly PreflightBlocker[] };
```

仅当阻塞列表为空时 `ok` 才为真。结果不保留输入对象引用。

## 6. 依赖边界和验证

本模块只使用语言标准库。禁止导入平台、传输、航线、UI、文件系统和 DJI 实现。

测试必须覆盖完全通过、每个阻塞项、组合阻塞顺序、电量边界、无效策略、缺失字段、抛错 getter、不可变性及重复评估；并纳入类型、覆盖率、性能、审计和模块范围 100% 变异测试。
