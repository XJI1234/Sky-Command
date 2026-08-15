# 工作流订阅协调模块契约

状态：已批准设计，待实施

## 唯一职责

`workflow-subscriptions` 只协调既有中继、任务、图传和飞控订阅，隔离监听器异常，并在设备从在线集合消失时通知父模块。它不轮询媒体、不保存业务状态、不发送任务或图传命令。

## 接口

```ts
WorkflowSubscriptions.create(dependencies, callbacks) -> instance
instance.subscribe(listener) -> unsubscribe
instance.dispose() -> void
```

第一次中继快照只建立在线基线，不能误判断连。后续设备消失必须只通知对应设备；订阅、退订和监听器异常均被隔离。`dispose` 幂等，之后任何迟到事件都被忽略。

## 验收

覆盖首次快照、单/多设备断连、重连、订阅者异常、退订幂等、依赖订阅失败、释放和迟到事件。
