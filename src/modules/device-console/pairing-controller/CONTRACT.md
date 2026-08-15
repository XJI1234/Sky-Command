# 遥控器配对控制模块契约

状态：已批准实施。

`pairing-controller` 只负责把操作员的开始、停止和查询配对意图，转换为 `pairing.start`、`pairing.stop`、`pairing.status` 命令，并以 `deviceId` 为键维护每台手机的一项进行中请求。它不自行判断 DJI 链路是否允许配对，不伪造 `PAIRED`/`IDLE`，也不保存遥测；调用方必须先取得 `capability-gate` 的允许结果，最终配对状态只能由手机遥测的 `pairingState` 显示。

```ts
PairingController.create({ relay }) -> PairingControllerInstance
instance.snapshot(deviceId) -> PairingRequestSnapshot
instance.start(deviceId) -> Promise<PairingRequestResult>
instance.stop(deviceId) -> Promise<PairingRequestResult>
instance.refresh(deviceId) -> Promise<PairingRequestResult>
```

`relay.sendCommand(deviceId, { name, fields: {} })` 是唯一端口。命令的成功只表示手机端接受/完成本次请求，`snapshot` 随后回到 `idle`，不得把任何成功转换为已配对。相同设备在一个请求未完成时，任何动作都返回 `busy` 且不得调用端口；不同 `deviceId` 可并行。端口抛出、拒绝或超时都转换为稳定失败，不泄漏底层详情。每个快照和结果都是冻结副本，监听器异常不影响状态。
