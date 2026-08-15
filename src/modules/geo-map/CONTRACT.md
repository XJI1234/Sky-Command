# 地图模块契约

状态：已批准实施

## 职责

`geo-map` 是电脑端地图能力的一级模块。它是调用方唯一需要了解的地图接口：初始化地图场景、应用底图、显示或隐藏三维城市模型、定位地理范围、读取快照和释放资源。它把 `map-engine-adapter`、`basemap-provider` 与 `city-model` 组合在内部，向上屏蔽具体地图引擎、WMTS 图层细节和 3D Tiles 资源路径。

它不导入 Cesium、天地图 SDK、DOM、Electron、网络或文件系统；不直接加载瓦片或白模；不解析航线、规划任务或无人机数据。具体引擎由注入的 `MapEngineFactory` 实现，实际资源加载结果仍由该实现报告。

## 对外接口

```ts
GeoMap.create({ factory, cityModels? }) -> GeoMapInstance

map.initialize(target) -> GeoMapResult<void>
map.applyBasemap(request) -> GeoMapResult<void>
map.showCityModel(id) -> GeoMapResult<void>
map.hideCityModel() -> GeoMapResult<void>
map.focus(bounds) -> GeoMapResult<void>
map.snapshot() -> GeoMapSnapshot
map.dispose() -> void
```

`factory` 是唯一必须注入的可变依赖。`cityModels` 可选，缺失时使用仅包含杭州白模的默认目录。调用方不直接访问引擎、底图描述器或模型目录；组合、错误映射、稳定图层标识和状态同步全部由本模块承担。

## 行为和状态

初始化前，除 `snapshot` 和 `dispose` 之外的所有操作都返回 `NOT_INITIALIZED`；释放后都返回 `DISPOSED`，且不会访问引擎。初始化成功后，底图使用固定引擎图层 ID `basemap`，其载荷是完整的两层 WMTS 描述；城市模型使用固定 ID `city-model`，其载荷是完整 3D Tiles 描述。使用单一替换操作使一次底图或模型更新在组合层中保持原子性。

应用底图成功后快照记录当前 `basemap`；显示城市模型成功后记录当前 `cityModelId`；隐藏成功后清除它。任何失败都不改变这些已提交快照字段。`dispose` 清除所有组合层状态并释放引擎场景。快照及其中数组均为冻结副本。

## 错误契约

引擎生命周期、图层、边界或引擎异常错误码按原样透传：`INVALID_TARGET`、`INVALID_LAYER`、`INVALID_BOUNDS`、`NOT_INITIALIZED`、`ALREADY_INITIALIZED`、`DISPOSED`、`ENGINE_FAILURE`。底图输入问题统一为 `INVALID_BASEMAP`，未提供凭据为 `CREDENTIAL_REQUIRED`；模型 ID 问题按 `INVALID_MODEL_ID` 与 `MODEL_NOT_FOUND` 返回。内部底图或模型细节、凭据、URL 和异常文本不向外暴露。

## 依赖与验证

实现只导入本一级模块内部的三个已完成子模块及其类型。测试经公开接口覆盖生命周期、底图切换、凭据缺失、模型显示/隐藏、默认和注入目录、边界定位、失败后的状态保持、冻结快照、架构隔离、类型边界、性能与 100% 变异测试。
