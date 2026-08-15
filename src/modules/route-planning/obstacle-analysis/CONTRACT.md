# 障碍物分析模块契约

状态：已批准实施。

## 职责

`obstacle-analysis` 是 `route-planning` 的纯分析二级模块。它消费一个规划后的二维航点路径和一个由上游模型适配器提供的“每航段最高障碍海拔”样本，计算每一段的飞行高度、净空和风险等级，输出稳定、不可变的诊断结果。

它不加载白模、点云、Cesium 图层或地图瓦片；不射线采样、不生成绕障航点、不读写文件、不导出航线、不保存任务，也不与手机或无人机通信。白模采样适配器只负责把模型数据转换为本模块的样本；绕障规划模块只消费本模块的 `collision` 风险，不得把这两种职责混在一起。

## 对外接口

```ts
RoutePlanningObstacleAnalysis.analyze(input: unknown): ObstacleAnalysisResult<ObstacleAnalysis>
```

输入必须为：

```ts
{
  path: readonly { longitude: number; latitude: number; altitudeMeters: number }[];
  samples: readonly { segmentIndex: number; highestObstacleAltitudeMeters: number | null }[];
  requiredClearanceMeters: number;
}
```

路径至少有两个航点；每一对相邻航点构成一个零基航段。样本可以任意顺序提供，但每个 `segmentIndex` 必须恰好出现一次，范围为 `[0, path.length - 2]`。`highestObstacleAltitudeMeters: null` 表示上游模型在该段没有障碍物；它不是“采样失败”。

成功结果为：

```ts
{
  collisionCount: number,
  riskCount: number,
  safeCount: number,
  segments: readonly {
    segmentIndex: number,
    flightAltitudeMeters: number,
    highestObstacleAltitudeMeters: number | null,
    clearanceMeters: number | null,
    status: "safe" | "risk" | "collision"
  }[]
}
```

每段 `flightAltitudeMeters` 等于两端航点高度的算术平均值。无障碍物时 `clearanceMeters` 为 `null` 且状态为 `safe`。有障碍物时净空等于飞行高度减去障碍高度：净空小于等于零为 `collision`；净空大于零但小于 `requiredClearanceMeters` 为 `risk`；其余为 `safe`。结果按 `segmentIndex` 升序排列。

## 校验与错误

经度、纬度和高度必须为有限数；经度在 `[-180, 180]`，纬度在 `[-90, 90]`，路径高度在 `[1, 500]`。`requiredClearanceMeters` 为 `[0.5, 100]` 的有限数。样本索引必须是安全整数，障碍高度为 `null` 或有限数。

所有结果及其嵌套对象和数组都是冻结副本。调用方修改输入或尝试修改输出，均不得改变已有分析。所有非法输入和所有 getter 异常只返回失败结果，绝不抛出异常，也不回显异常消息。

错误代码只有：`INVALID_INPUT`、`INVALID_PATH`、`INVALID_SAMPLE`、`INVALID_CLEARANCE`。错误详情固定为 `{ field, reason }`。重复、缺失或越界样本均是 `INVALID_SAMPLE`。

## 依赖与验证

模块只能依赖 ECMAScript 基础能力。测试必须覆盖安全、风险、碰撞、空障碍、样本排序、重复/缺失/越界样本、路径与净空边界、恶意 getter、不可变性、类型边界、性能、全局覆盖率和 100% 变异测试。
