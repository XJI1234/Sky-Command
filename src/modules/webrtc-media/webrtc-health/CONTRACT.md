# webrtc-health 二级模块契约

状态：实验设计，尚未实现。

## 唯一职责

`webrtc-health` 是无 I/O 的低延迟媒体健康判定器。它只根据上层报告的发布、发布断开、播放器首帧和进程退出事实维护状态并产生超时停止建议。

## 状态与事件

状态为 `awaiting-publisher`、`publisher-ready`、`failed`。事件至少包括 `publisher-connected`、`publisher-disconnected`、`first-frame-rendered`、`process-exited` 和 `stop`。

`publisher-connected` 只能使流进入 `publisher-ready`，不得被解释成 `first-frame-rendered`。输入超时和发布后断流超时各只能产生一次停止建议。重复事件必须幂等，未知流必须稳定拒绝。

公开快照只包含 streamId、修订号、状态、最近事件时间和固定诊断，不包含 URL、设备对象、进程信息或原始异常。

## 验收

契约测试覆盖全部状态迁移、重复/乱序事件、超时边界、停止建议单次性、未知流、无效时间和冻结副本。
