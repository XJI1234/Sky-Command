# 航线规划工作区模块契约

状态：已批准实施。

## 职责

`plan-workspace` 是 `route-planning` 一级模块中唯一的工作区二级模块。它协调操作员在地图上指定环绕中心点和边缘点、调整拍摄高度与航点数量、调用注入的环绕规划器，并把成功的不可变计划交给注入的地图预览端口。

它不计算半径、方位角或航点几何，不校验规划器的领域输入，不读取 KML/KMZ 文件，不保存计划，不生成 WPMZ 文件，不调用 `route-library`、`relay-link`、手机或无人机。它不导入 Vue、Electron、Cesium、Node API 或网络库。地图引擎细节只能被生产适配器隐藏在 `map` 端口之后。

## 对外接口

```ts
PlanWorkspace.create({ planner, map }) -> PlanWorkspaceInstance

instance.snapshot() -> PlanWorkspaceSnapshot
instance.subscribe(listener) -> unsubscribe
instance.setCenter(point) -> PlanWorkspaceCommandResult
instance.setEdge(point) -> PlanWorkspaceCommandResult
instance.setParameters({ altitudeMeters, waypointCount }) -> PlanWorkspaceCommandResult
instance.buildOrbit() -> PlanWorkspaceCommandResult
instance.locatePlan() -> PlanWorkspaceCommandResult
instance.clear() -> PlanWorkspaceCommandResult
```

`planner` 端口只有 `planOrbit(input)`，其输入和结果逐字采用 `planning-domain` 的公开契约。`map` 端口只有 `showPlan(plan)`、`clearPlan()` 和 `locate(bounds)`；它接收引擎无关的计划和边界，不能接收 DOM、Viewer、图层或文件路径。

## 状态、顺序与结果

初始快照为：

```ts
{
  center: null,
  edge: null,
  altitudeMeters: 80,
  waypointCount: 36,
  plan: null,
  notice: null
}
```

中心点与边缘点只接受有限、范围合法的 WGS84 经纬度；不合法时命令返回 `invalid-point` 并保留原状态。参数只接受高度 `[1, 500]` 米和航点数 `[4, 360]` 的安全整数；不合法时返回 `invalid-parameters`。这些工作区输入检查只保护交互边界，不替代领域模块的最终验证。

`buildOrbit` 在中心点和边缘点齐全时调用一次规划器。缺任一点时不调用端口，返回 `incomplete-input`。规划器失败时保留已有成功计划，写入可显示的 `planning-failed` 通知；规划器抛出时返回 `adapter-failed`。规划成功时替换计划、调用一次 `map.showPlan`，清空通知，并返回成功。地图预览调用失败时，工作区保留新计划，写入 `adapter-failed` 通知并返回失败，避免用户丢失刚刚算出的计划。

每次合法状态变更发布一份冻结快照。`locatePlan` 仅当有计划时调用地图端口；没有计划时返回 `no-plan`。`clear` 始终清除计划与通知并调用一次 `map.clearPlan`；地图异常时仍清除本地计划，返回 `adapter-failed`。调用一次取消订阅后不得再收到通知，监听器异常必须隔离，不得阻止其他监听器或命令。

## 数据与错误

所有快照、计划、点、数组、通知和命令结果均为冻结副本。调用方对输入点、参数对象、地图或规划器返回对象的后续修改不得影响工作区状态。返回错误原因仅为 `invalid-point`、`invalid-parameters`、`incomplete-input`、`planning-failed`、`no-plan`、`adapter-failed`；通知只提供稳定 `code` 和可显示 `message`，不得回显第三方异常信息。

每个 `create` 产生完全独立的状态与监听器集合。工作区没有启动、网络重连或销毁生命周期；宿主负责销毁实际地图引擎，工作区只负责停止订阅。

## 验证

测试必须覆盖初始状态、中心/边缘取点、参数边界、完整规划、领域失败、端口异常、预览异常时保留计划、定位、清除、监听器隔离、不可变性、独立实例、架构隔离、类型边界、性能、全局 100% 覆盖率和 100% 变异测试。
