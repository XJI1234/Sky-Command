# 地图引擎适配器模块契约

状态：已批准实施

## 职责

`map-engine-adapter` 是 `geo-map` 内唯一管理具体三维地图引擎生命周期的二级模块。它创建和释放场景，按稳定图层标识替换或移除图层，并把引擎无关的地理边界转换为视角定位请求。

它不选择底图、不读取或泄露凭据、不加载城市模型、不理解航线/规划/飞机业务语义，不访问 DOM、Electron、文件系统或网络，也不导入 Cesium、天地图或其他引擎包。

## 对外接口

```ts
MapEngineAdapter.create({ factory }) -> MapEngineAdapterInstance

instance.initialize(target) -> MapEngineResult<void>
instance.replaceLayer(layer) -> MapEngineResult<void>
instance.removeLayer(layerId) -> MapEngineResult<void>
instance.focus(bounds) -> MapEngineResult<void>
instance.snapshot() -> MapEngineSnapshot
instance.dispose() -> void
```

`target` 只有稳定的非空 `identity`；它不是 DOM 或引擎对象。`layer` 只有已验证的非空 `id` 和引擎无关的 `payload`；同一 ID 的替换不会增加图层数量。`bounds` 包含有限且有序的经纬度范围，高度范围要么均为有限数值，要么均为 `null`。

## 生命周期和结果

实例初始为 `new`。`initialize` 成功后为 `ready`，且只允许成功一次；失败保持 `new`，允许重试。`dispose` 可重复调用，首次释放引擎场景后状态为 `disposed`；之后所有非释放操作返回 `DISPOSED`，绝不调用引擎。

所有引擎异常转换为 `ENGINE_FAILURE`，输入问题为 `INVALID_TARGET`、`INVALID_LAYER` 或 `INVALID_BOUNDS`，非法生命周期为 `NOT_INITIALIZED`、`ALREADY_INITIALIZED` 或 `DISPOSED`。失败不改变已提交图层或状态。快照及其图层标识数组均为冻结副本。

## 依赖和验证

唯一可变依赖是注入的 `MapEngineFactory`/`MapEngineScene` 端口。生产层可用 Cesium 实现该端口，测试使用内存实现；其具体对象永不穿过本模块接口。

测试覆盖初始化、重试、图层替换/移除、视角定位、全部输入和生命周期拒绝、引擎异常、不可变快照、释放幂等、架构隔离、类型边界、性能和 100% 变异测试。
