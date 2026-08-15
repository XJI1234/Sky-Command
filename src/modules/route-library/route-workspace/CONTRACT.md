# 航线工作区模块契约

状态：已批准实施

## 职责与接口

`route-workspace` 是航线库页面的框架无关编排边界：协调文件选择器、D3 航线库一级接口和地图一级接口，向 Vue/Electron 适配层提供不可变视图快照和命令结果。它不解析文件、不校验坐标、不分类/去重航线、不修复删除后的选择、不创建任务负载，也不渲染地图。

```text
RouteWorkspace.create(dependencies) -> RouteWorkspaceInstance
instance.snapshot() -> RouteWorkspaceSnapshot
instance.subscribe(listener) -> unsubscribe
instance.importFromPicker() -> Promise<WorkspaceCommandResult>
instance.select(routeId) -> WorkspaceCommandResult
instance.remove(routeId) -> WorkspaceCommandResult
instance.locateSelected() -> WorkspaceCommandResult
```

公开入口仅为 `route-workspace/index.ts`。端口为航线库、`pick() -> FileSelection | null` 的选择器，以及只接收引擎无关预览/边界的地图；不得暴露路径、Electron 对象、Viewer、底图或三维模型。

## 状态和命令

快照为 `{ phase: ready|picking|importing, routes, selectedRouteId, preview, notice }`，所有内容冻结。初始为空且 `ready`；失败命令保留原航线数据、选择和预览，只更新通知。

导入按 `picking -> importing` 进行，取消保持原数据且无通知；进行中再次导入返回 `busy`，不得调用端口。成功后从航线库刷新列表/选择并显示预览；失败为 `import-failed`。选择成功时刷新详情和预览；未知 ID 保持当前视图。删除成功时刷新列表，若无选择则清空地图；绝不向手机/飞机发删除命令。定位只在当前预览存在时调用地图，否则为 `no-selection`。端口异常转为 `adapter-failed`、可读通知和 `ready`，保留既有数据。

每个命令每次阶段变化最多发布一份快照；移除的监听器不再收到事件，监听器异常隔离。模块除选择/导入外同步，不保留文件字节，不依赖文件系统、网络、Electron、Vue、Cesium 或 DJI；每次 `create` 独立且可重入。

## 验证

覆盖取消、忙碌保护、导入成败、选择成败、删除、定位、适配器异常、监听器隔离、不可变快照、独立实例和架构/类型边界。
