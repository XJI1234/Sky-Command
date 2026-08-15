# 航线预览模型模块契约

状态：已批准实施

## 职责与接口

`preview-model` 将一条已可信的 `RouteDetail` 转换为不可变、与地图引擎无关的 `RoutePreview`：完整折线、起终点标记及供地图定位镜头的三维边界。

```text
RoutePreviewModel.createPreview(detail: RouteDetail) -> DomainResult<RoutePreview>
```

唯一公开接口为 `route-library/preview/index.ts`。无效或伪造详情返回 `DOMAIN_INVARIANT_VIOLATION`，`details.field` 为 `detail`；不得抛异常或泄露部分预览。

## 数据和规则

预览包含 `routeId`、顺序折线、首末点防御副本和 `{min/maxLongitude, min/maxLatitude, min/maxAltitude}`。经纬度原样复制，不做坐标转换。所有点有数值高度时计算高度最小/最大值；任何点高度为 `null` 时，两个高度边界均为 `null`，不得以零替代或插值。合法详情至少有两点，所以经纬度边界有限且有序。

所有对象和数组冻结；修改输入或结果均不能影响其他结果或领域状态。构建为 O(n)、同步、无状态、确定且可重入；不保留输入/输出引用。

## 边界和验证

不创建/修改航线资产，不查询目录，不解析文件，不校验原始坐标，不访问文件系统/网络，不渲染地图；禁止导入 Vue、Electron、Cesium、天地图、3D Tiles、DJI、ZIP 或 XML。测试覆盖高度、点数、伪造输入、不可变性、随机坐标、线性工作量、架构限制以及 100% 覆盖率和变异门禁。
