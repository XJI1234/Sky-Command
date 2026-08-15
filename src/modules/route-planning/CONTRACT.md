# 航线规划一级模块契约（历史研究代码，未装配）

> 状态：已脱离当前 Sky Command 生产工作流。当前业务只导入、预览并执行 Wayline-master 或其他外部工具生成的航线文件；本目录不得被生产组合根、IPC、UI 或任务下发路径调用。保留代码和测试仅用于历史研究，重新启用前必须先取得业务批准并重新审查跨端契约。

`route-planning` 是电脑端的航线规划一级模块。它把操作员提供的地图取点和参数转换为不可变、引擎无关的航点计划与风险诊断；它的所有公开结果都能交给地图预览、任务门禁和手机端 WPMZ 生成流程消费。

## 对外接口

```ts
RoutePlanning.planOrbit(input: unknown) -> PlanningResult<OrbitPlan>
RoutePlanning.planBuildingFootprint(input: unknown) -> BuildingFootprintPlanningResult<BuildingFootprintPlan>
RoutePlanning.analyzeObstacles(input: unknown) -> ObstacleAnalysisResult<ObstacleAnalysis>
RoutePlanning.createWorkspace({ planner, map }) -> PlanWorkspaceInstance
```

前三个接口都是纯函数，调用之间不共享状态。`createWorkspace` 是唯一有状态入口，每次调用都会创建完全独立的交互状态和监听器集合。每个接口的字段范围、错误代码、数值单位与不可变规则由其二级模块中的中文 `CONTRACT.md` 定义；一级模块不复制或改变二级模块的错误语义。

## 二级模块

| 二级模块 | 唯一职责 | 明确不负责 |
| --- | --- | --- |
| `planning-domain` | 根据中心点、边缘点、高度和航点数量生成单目标环绕计划 | 地图取点、文件、障碍采样、任务下发 |
| `building-footprint-planner` | 根据二维建筑轮廓计算外立面拍摄草案 | 读取白模、射线采样、格式导出、任务下发 |
| `obstacle-analysis` | 根据已采样的每航段最高障碍物海拔计算安全、风险和碰撞诊断 | 加载白模、点云或瓦片、绕障、地图渲染、任务下发 |
| `plan-workspace` | 编排地图取点、环绕参数、领域规划、预览和定位 | 几何计算、领域校验、地图引擎、文件、网络、任务下发 |

`plan-workspace` 通过狭窄的规划器与地图端口与系统外部协作。生产适配器可以用 `geo-map` 的公开接口实现地图端口，但本模块绝不导入 Cesium、天地图、Vue、Electron、Node 或地图引擎类型。障碍物采样必须由本模块外的适配器完成后，以抽象样本喂给 `obstacle-analysis`；手机端 `wpmz-generator` 只消费航点计划，不能反向导入本模块。

## 职责边界

本模块不读取或保存 KML/KMZ/WPML，不生成 WPMZ 文件，不读写任何文件，不加载地图或白模，不建立网络连接，不保存任务，不连接手机、遥控器或无人机，也不直接调用 DJI SDK。

航线文件导入、多航线目录和预览模型属于 `route-library`；具体三维地图、底图及城市白模属于 `geo-map`；WPMZ 生成、上传和执行属于手机端 `wayline-mission` 与电脑端 `mission-control`；通过白模取得障碍物样本属于后续独立的采样适配器。调用方不得越过这些模块把文件路径、地图实例、WebSocket 或 DJI 对象传给本模块。

## 状态、错误与不可变性

除 `plan-workspace` 的实例内交互状态外，所有能力无状态且没有副作用。成功和失败结果、嵌套对象、数组与快照均为冻结副本；输入后续被修改，或调用方尝试改写结果，均不得改变已经产生的计划或诊断。无效输入、恶意 getter 和端口异常必须转换为各子模块契约中定义的稳定失败结果，不得泄露底层异常消息。

## 验收

每个二级模块必须先具备中文契约、失败测试、实现和边界测试。一级模块的验收还必须覆盖门面暴露、实例独立性与禁止依赖方向。完成前必须以新鲜输出通过完整类型检查、全局 100% 覆盖率、性能测试和每个纳入模块的 100% Stryker 变异测试。
