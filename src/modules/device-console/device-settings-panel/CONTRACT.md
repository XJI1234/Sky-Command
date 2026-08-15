# 设备设置面板模块契约

状态：已实施

## 1. 职责

`device-settings-panel` 是 `device-console` 中负责单台设备图传和相机设置读写的业务二级模块。它维护每台手机最后一次已确认的设置快照、单设备单设置域的请求互斥，并将设置读写意图交给注入的设置传输端口。

它不调用 DJI SDK，不建立 WebSocket，不解析协议帧，不读取或推导链路状态，不判断设备能力，不伪造读取结果，也不把写入请求成功当成飞行器一定已应用。调用方必须先使用 `capability-gate` 判定 `transmission-settings` 或 `camera-settings` 可用；手机端必须在 DJI 回调确认后才向设置传输端口返回已确认快照。

## 2. 已接入的跨端前置条件

手机端 `MSDK-relay` 已注册以下命令处理器：

```text
device.settings.transmission.read
device.settings.transmission.write
device.settings.camera.read
device.settings.camera.write
```

协议 `command-result` 已支持经过协议校验的可选结构化 `result` 对象。桌面端由 `adapters/relay-device-settings` 将这四条命令映射为本模块的 `DeviceSettingsPort`，再由生产层 `relay-operations-adapter.settingsGateway()` 提供受限命令出口。

只有手机端确认 DJI 读写结果并返回与请求域匹配的完整快照，且桌面端适配器成功解码 `result` 后，本模块才更新快照。旧版不带 `result` 的命令结果仍可用于其他命令，但绝不能被当作设置读取或写入成功。

不得将无结构化的 `detail` 字符串解析为设置值；不同机型、语言和 SDK 版本下的数据不可维护且可能误导操作员，违反本项目的真实状态原则。

## 3. 对外接口

```ts
DeviceSettingsPanel.create({ port }) -> DeviceSettingsPanelInstance

instance.snapshot(deviceId) -> DeviceSettingsSnapshot
instance.readTransmission(deviceId) -> Promise<DeviceSettingsResult>
instance.writeTransmission(deviceId, patch) -> Promise<DeviceSettingsResult>
instance.readCamera(deviceId) -> Promise<DeviceSettingsResult>
instance.writeCamera(deviceId, patch) -> Promise<DeviceSettingsResult>
```

```ts
interface DeviceSettingsPort {
  readTransmission(deviceId: string): Promise<PortResult<TransmissionSettings>>;
  writeTransmission(deviceId: string, patch: TransmissionSettingsPatch): Promise<PortResult<TransmissionSettings>>;
  readCamera(deviceId: string): Promise<PortResult<CameraSettings>>;
  writeCamera(deviceId: string, patch: CameraSettingsPatch): Promise<PortResult<CameraSettings>>;
}
```

每个方法只操作其传入的 `deviceId`。同一设备的同一设置域有请求进行中时，新的读或写返回 `busy`，且不得调用端口；图传与相机、不同设备之间允许并行。端口异常、超时、拒绝或结构不合法均返回稳定失败，并保留最后一次已确认快照。

## 4. 数据模型

```ts
interface TransmissionSettings {
  readonly frequencyBand: string;
  readonly channelSelectionMode: string;
  readonly bandwidth: string;
  readonly dynamicDataRateMbps: number | null;
}
interface TransmissionSettingsPatch {
  readonly frequencyBand?: string;
  readonly channelSelectionMode?: string;
  readonly bandwidth?: string;
}
interface CameraSettings {
  readonly autoExposureLockEnabled: boolean;
  readonly focusMode: string;
  readonly cameraIndex: string;
}
interface CameraSettingsPatch {
  readonly autoExposureLockEnabled?: boolean;
  readonly focusMode?: string;
}
```

枚举值由手机端根据当前 DJI 产品和 SDK 原样返回，桌面端不维护会随机型漂移的枚举白名单。设置令牌必须为长度 `1..64`、仅含大写字母、数字和下划线的字符串；`dynamicDataRateMbps` 为非负有限数或 `null`。写入补丁至少包含一个字段，且不得包含只读字段 `dynamicDataRateMbps`、`cameraIndex`。

图传对应旧项目已验证的 DJI 值：`FrequencyBand`、`ChannelSelectionMode`、`Bandwidth`；相机对应 `KeyAELockEnabled`、`KeyCameraFocusMode` 和主相机索引。手机端适配器负责将这些 DJI 类型映射为上述平台无关字符串，桌面端不得导入 DJI 枚举。

## 5. 状态和结果

初始快照：

```ts
{
  deviceId,
  transmission: null,
  camera: null,
  transmissionPending: false,
  cameraPending: false,
  lastFailure: null
}
```

只有端口返回 `ok: true` 且设置对象完全通过本模块校验时才替换对应快照。成功写入后保存端口返回的完整确认快照，不在桌面端用补丁乐观拼接状态。失败只记录稳定错误码，不回显 DJI、协议或异常细节。

结果错误码固定为：`invalid-device`、`invalid-patch`、`busy`、`rejected`、`timed-out`、`transport-failed`、`invalid-result`、`adapter-failed`。所有结果、快照及嵌套对象均为冻结副本。

## 6. 依赖和验证

核心模块只能依赖 ECMAScript 基础能力和本契约定义的端口。`adapters/relay-device-settings` 是本模块的组合层，不得把帧 JSON、命令 ID、WebSocket 或 DJI 类型泄露到核心接口。

测试必须覆盖两种设置域的正常读写、全部字段边界、按设备和设置域的并发规则、端口拒绝/超时/异常、无效结构化结果、失败时保留最后确认快照、不可变性、类型边界、架构隔离、性能、全局覆盖率和 100% Stryker。跨端测试必须验证请求字段、`result` 结构、手机端 DJI 回调成功与失败，以及未知机型字段的安全拒绝。
