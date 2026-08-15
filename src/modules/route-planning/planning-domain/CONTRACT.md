# 航线规划领域模块契约

状态：已批准实施

## 职责

`planning-domain` 是 `route-planning` 内的纯几何二级模块。当前只生成“单目标环绕拍摄”航线草案：以中心点和边缘点确定水平半径，在固定相对高度上生成等角度、连续编号的 WGS84 航点序列。

它不读取地图、不加载白模、不采样障碍物、不处理建筑外轮廓、不调用 WASM、不输出 KML/KMZ/WPML、不保存任务、更不与无人机或手机通信。后续模块只能消费其不可变草案，不能修改或伪造其中的航点。

## 对外接口

```ts
RoutePlanningDomain.planOrbit(input: unknown): PlanningResult<OrbitPlan>
```

输入为 `{ center, edge, altitudeMeters, waypointCount }`。`center` 与 `edge` 均为 `{ longitude, latitude }`；`altitudeMeters` 是相对起飞点高度；`waypointCount` 是环绕采样数量。

成功时返回冻结的 `OrbitPlan`：

```ts
{
  kind: "orbit",
  center: { longitude, latitude },
  radiusMeters,
  altitudeMeters,
  waypoints: [{ sequence, longitude, latitude, altitudeMeters }, ...]
}
```

## 输入和生成规则

经度必须为有限数且在 [-180, 180]，纬度必须为有限数且在 [-90, 90]。高度必须为 1 至 500 米的有限数；航点数量必须是 4 至 360 的安全整数。中心点和边缘点的水平距离必须在 [1, 2,000] 米内。

航点从正北开始，顺时针均匀分布，不重复闭合首点；序号从 0 连续递增。距离使用 WGS84 球面近似（地球半径 6,378,137 米），跨越国际日期变更线时经度规范化到 [-180, 180]。输出中心点、所有航点、数组和结果均为冻结副本。调用方修改输入或任何返回数组均不能改变之后的规划结果。

## 错误契约

错误码仅有：`INVALID_INPUT`、`INVALID_COORDINATE`、`INVALID_ALTITUDE`、`INVALID_WAYPOINT_COUNT`、`INVALID_RADIUS`。详情只包含稳定的 `field` 与 `reason`，不得回显输入对象或 getter 异常。所有恶意 getter 和非法输入都返回错误，绝不抛异常。

## 依赖和验证

模块只依赖 ECMAScript 数学库；不导入地图、Node、网络、文件、UI、route-library、geo-map、任务控制或任何无人机 SDK。测试覆盖方向、半径、日期变更线、边界值、非法输入、getter、不可变性、架构隔离、类型边界、性能和 100% 变异测试。
