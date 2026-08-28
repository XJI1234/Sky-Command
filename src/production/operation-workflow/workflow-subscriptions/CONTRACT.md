# 工作流订阅协调模块契约

状态：已实施

## 唯一职责

`workflow-subscriptions` 只协调既有中继、任务、图传和飞控订阅，隔离监听器异常，并在设备从在线集合消失时通知父模块。它不轮询媒体、不保存业务状态、不发送任务或图传命令。

## 接口

```ts
WorkflowSubscriptions.create(sources, onChange) -> instance
instance.dispose() -> void
```

`sources` 是父模块已经选定的中继、任务、图传和飞控订阅源；`onChange` 是父模块提供的单一变更回调。模块创建时立即订阅每个源，并把任一事件归并为一次 `onChange` 调用。订阅建立或回调抛出的异常均被隔离。`dispose` 幂等，释放每个已建立订阅；之后任何迟到事件都被忽略。

## 验收

覆盖首次快照、单/多设备断连、重连、订阅者异常、退订幂等、依赖订阅失败、释放和迟到事件。
