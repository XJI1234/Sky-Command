# 建筑轮廓规划模块契约

状态：已批准实施。

## 职责

`building-footprint-planner` 是 `route-planning` 内部的纯几何二级模块。它把建筑物的二维 WGS84 轮廓、飞行相对高度、与建筑立面的安全距离和沿立面最大航段长度，转换为一份确定性的建筑外立面拍摄路径草案。

该模块只计算几何结果。它不读取地图、白模或点云，不采样障碍物，不调用 WASM，不读写文件，不输出 KML/KMZ/WPML，不保存任务，也不与手机、遥控器或无人机通信。地图预览、障碍物分析、格式导出和任务下发必须消费本模块的不可变结果，而不能反向耦合到本模块。

## 对外接口

```ts
RoutePlanningBuildingFootprint.plan(input: unknown): BuildingFootprintPlanningResult<BuildingFootprintPlan>
```

输入对象必须为：

```ts
{
  footprint: readonly { longitude: number; latitude: number }[];
  altitudeMeters: number;
  standOffMeters: number;
  maxSegmentLengthMeters: number;
}
```

成功时返回：

```ts
{
  ok: true,
  value: {
    kind: "building-footprint",
    altitudeMeters: number,
    standOffMeters: number,
    sourceFootprint: readonly { longitude: number; latitude: number }[],
    envelope: readonly { longitude: number; latitude: number }[],
    waypoints: readonly {
      sequence: number,
      longitude: number,
      latitude: number,
      altitudeMeters: number,
      facadeIndex: number,
      facadeFraction: number
    }[]
  }
}
```

`sourceFootprint` 是去掉末尾重复闭合点和相邻重复点后的输入副本，保留调用方的轮廓语义。`envelope` 是基于该轮廓生成、按逆时针顺序排列的凸包安全包络；它不重复首点。`waypoints` 按 `envelope` 的逆时针外侧顺序排列，同样不重复首点。调用方如需闭环，应由导出或任务组合模块按照目标协议显式补闭环点，不能假定此模块隐式重复首点。

## 几何规则

所有输入坐标均为有限数；经度必须在 `[-180, 180]`，纬度必须在 `[-89.999, 89.999]`。轮廓至少包含 3 个有效且不重复的点，最多 1,000 个点。`altitudeMeters` 为 `[1, 500]` 米内的有限数；`standOffMeters` 和 `maxSegmentLengthMeters` 均为 `[1, 2,000]` 米内的有限数。

模块以轮廓坐标的算术中心为局部参考点，使用 WGS84 球面等距近似将轮廓映射为米制平面，先计算凸包，再将每一条凸包边向外平移 `standOffMeters`，并取相邻平移直线的交点形成拍摄包络。凸包用于保证凹形轮廓、输入方向和输入起点变化不会使路径切入建筑物；因此 `envelope` 可以少于输入轮廓的点数。

每条外扩包络边按不超过 `maxSegmentLengthMeters` 的均匀长度切分。每个航点的 `facadeIndex` 是其所属包络边的零基索引，`facadeFraction` 是该点在对应边上的开区间中点比例。模块拒绝会产生超过 10,000 个航点的输入，避免无界内存与下游无人机协议限制。

相同的有效输入必定产生相同顺序、相同数值的结果；轮廓顺时针/逆时针输入和不同起始顶点不改变 `envelope` 与 `waypoints` 的几何路径。跨国际日期变更线时，输出经度规范化到 `[-180, 180]`。

## 不可变性与错误

成功结果、所有嵌套对象和数组都必须冻结，并且必须是输入的副本；调用方修改输入或尝试修改结果，均不得影响既有计划。所有访问器异常和所有非法输入都返回失败结果，绝不向调用方抛出异常，也不得回显输入对象或异常消息。

失败结果只有以下代码：`INVALID_INPUT`、`INVALID_FOOTPRINT`、`INVALID_ALTITUDE`、`INVALID_STANDOFF`、`INVALID_SEGMENT_LENGTH`、`WAYPOINT_LIMIT_EXCEEDED`、`GEOMETRY_FAILURE`。错误详情固定为 `{ field, reason }`，用于调用端展示和日志分类。非对象输入为 `INVALID_INPUT`；不可读输入为 `INVALID_INPUT` 且原因为 `unreadable`；轮廓格式、坐标、点数、退化面积等问题为 `INVALID_FOOTPRINT`；其他数值字段分别使用对应错误代码；凸包或外扩几何无法生成有限点时使用 `GEOMETRY_FAILURE`。

## 依赖与验证

实现只能依赖 ECMAScript 数学和集合能力，不得导入地图、Node、网络、文件、UI、`route-library`、`geo-map`、任务控制或无人机 SDK。测试必须覆盖顺逆时针与起点规范化、凸包、外扩距离、边分段、日期变更线、输入错误、恶意 getter、不可变性、结果上限、类型边界、性能和 100% 变异测试。
