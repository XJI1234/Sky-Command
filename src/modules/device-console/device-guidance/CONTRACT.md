# 设备连接引导模块契约

状态：已实施

## 1. 职责

`device-guidance` 是 `device-console` 中的纯决策二级模块。它消费已经由 `link-chain` 归一化的单台手机链路快照，以及手机端遥测提供的配对状态，给出当前唯一应向操作员展示的连接步骤。

它不建立或关闭电脑与手机的连接，不发送配对命令，不修改链路或配对状态，不保存遥测，不读取配置，也不依赖 Electron、Vue、WebSocket、Android、DJI SDK、文件系统或网络库。它不根据命令接受结果声称设备已经配对；设备就绪只能由已归一化的链路快照确定。

## 2. 对外接口

```ts
DeviceGuidance.evaluate(input: unknown): DeviceGuidanceResult<DeviceGuidanceSnapshot>
```

调用同步、确定、可重入。对任意不可信输入和 getter 异常均不得抛异常。输入不会被保留，成功及失败结果和所有嵌套对象均为冻结副本。

## 3. 输入

```ts
interface DeviceGuidanceInput {
  readonly link: {
    readonly deviceId: string;
    readonly overall: "ready" | "degraded" | "offline";
    readonly computerToPhone: "connected" | "disconnected";
    readonly phoneToRemoteController: "connected" | "disconnected" | "unknown";
    readonly remoteControllerToAircraft: "connected" | "disconnected" | "unknown";
  };
  readonly pairingState?: string;
}
```

`link` 必须符合 `link-chain` 的公开快照不变量：电脑到手机断开时总状态必须为 `offline`，其余两段均为 `unknown`；电脑到手机连接后，总状态只能按三段状态组合为 `degraded` 或 `ready`。不符合该不变量的输入返回 `INVALID_INPUT`，避免错误来源伪造“可用”引导。

手机端已定义的配对状态为 `UNKNOWN`、`IDLE`、`PAIRING`、`PAIRED`、`STOPPING`、`FAILED`。缺失状态或未来新增的未知字符串不能导致异常，也不能被误认为已配对；在需要使用该信息时按未知状态安全处理。非字符串状态为非法输入。

## 4. 成功结果和优先级

```ts
interface DeviceGuidanceSnapshot {
  readonly deviceId: string;
  readonly code:
    | "CONNECT_PHONE"
    | "WAIT_FOR_SDK"
    | "CONNECT_REMOTE_CONTROLLER"
    | "START_PAIRING"
    | "WAIT_FOR_PAIRING"
    | "PAIRING_FAILED"
    | "CONNECT_AIRCRAFT"
    | "READY";
  readonly action:
    | "reconnect-phone"
    | "wait-for-sdk"
    | "connect-remote-controller"
    | "start-pairing"
    | "wait-for-pairing"
    | "resolve-pairing-failure"
    | "connect-aircraft"
    | null;
  readonly title: string;
  readonly message: string;
}
```

结果只能选择一个当前步骤，按以下优先级判定：

1. 电脑到手机未连接：`CONNECT_PHONE`。
2. 手机连接但遥控器状态未知：`WAIT_FOR_SDK`。
3. 遥控器未连接：`CONNECT_REMOTE_CONTROLLER`。
4. 遥控器已连接、飞行器未连接且状态为 `PAIRING` 或 `STOPPING`：`WAIT_FOR_PAIRING`。
5. 同一链路下状态为 `FAILED`：`PAIRING_FAILED`。
6. 同一链路下状态为 `PAIRED`：`CONNECT_AIRCRAFT`；该状态绝不代表飞行器已连接。
7. 同一链路下状态缺失、`UNKNOWN`、`IDLE` 或未知未来值：`START_PAIRING`。
8. 遥控器已连接、飞行器状态未知：`WAIT_FOR_SDK`。
9. 三段链路均已连接：`READY`。

文案是稳定、可显示的中文文本，不得包含 `deviceId`、内部异常、网络地址、DJI 原始状态或命令结果。

## 5. 失败结果

```ts
type DeviceGuidanceResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "INVALID_INPUT";
        readonly details: {
          readonly field: string;
          readonly reason: "invalid-container" | "invalid-value" | "unreadable";
        };
      };
    };
```

失败详情只能定位字段和失败类别，不能回显输入、异常消息或配对状态原文。

## 6. 依赖和验证

本模块只能依赖 ECMAScript 基础能力。它不导入 `link-chain` 的内部实现；调用方只传入其公开快照。

测试必须覆盖每个优先级分支、已配对但尚未连接飞行器、未知未来配对状态、非法和矛盾链路、恶意 getter、不可变性、重复评估、架构隔离、类型边界、性能、全局覆盖率和模块范围 100% 变异测试。
