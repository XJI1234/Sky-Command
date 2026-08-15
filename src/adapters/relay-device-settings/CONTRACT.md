# 中继设备设置适配器契约

状态：已批准实施

## 职责

`relay-device-settings` 是电脑端 `relay-link` 与 `device-settings-panel` 之间唯一的适配器。它把四个稳定的设置调用转换成 Android 中继命令，并只在中继返回已确认、结构正确、域匹配的 `command-result.result` 快照时向设置面板返回成功。

它不维护设备状态，不建立网络连接，不解析字节帧，不调用 DJI SDK，不判断设备能力，也不解释 UI。设置面板仍是设置快照和同域请求互斥的唯一所有者；`relay-link` 仍是命令生命周期和超时的唯一所有者。

## 对外接口

```ts
RelayDeviceSettings.create({ relay }) -> DeviceSettingsPort

port.readTransmission(deviceId)
port.writeTransmission(deviceId, patch)
port.readCamera(deviceId)
port.writeCamera(deviceId, patch)
```

命令映射固定如下：

| 调用 | 命令 | 字段 |
| --- | --- | --- |
| `readTransmission` | `device.settings.transmission.read` | `{}` |
| `writeTransmission` | `device.settings.transmission.write` | 图传补丁 |
| `readCamera` | `device.settings.camera.read` | `{}` |
| `writeCamera` | `device.settings.camera.write` | 相机补丁 |

图传成功快照必须为 `{ domain: "transmission", settings: { frequencyBand, channelSelectionMode, bandwidth, dynamicDataRateMbps } }`，其中前三项是令牌字符串，最后一项是有限非负数或 `null`。相机成功快照必须为 `{ domain: "camera", settings: { autoExposureLockEnabled, focusMode, cameraIndex } }`。适配器不接受跨域结果、缺字段、额外语义替代、数值文本或任意业务字符串。

## 结果与失败

只有中继 `status === "succeeded"` 且结果快照完全匹配本次调用的域时返回 `{ ok: true, value }`。其他中继终态映射为稳定、无敏感信息的 `{ ok: false, reason }`：`timed-out` 映射为 `timed-out`，`disconnected` 映射为 `transport-failed`，`rejected` 或无效/缺失结果映射为 `rejected`。

调用、读取结果或转换过程发生异常时也返回 `transport-failed`，不得抛出或泄露底层详情。输入补丁由设置面板先校验；适配器仍对不可信调用输入做防御性拷贝，并且只发送白名单字段。成功值、发出的字段和适配器门面均为冻结副本。

## 依赖与验收

实现只能依赖 `relay-link` 的公开接口和 `device-settings-panel` 的公开类型，不得导入其内部实现、Node、Electron、WebSocket、DJI 或 UI 包。测试必须覆盖四条命令映射、两个成功快照、所有终态映射、缺失和跨域结果、畸形 JSON、异常隔离、冻结/输入隔离与架构边界；类型、覆盖率、性能和变异测试必须通过。
