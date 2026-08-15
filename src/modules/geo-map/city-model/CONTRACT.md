# 城市模型目录模块契约

状态：已批准实施

## 职责

`city-model` 是 `geo-map` 内唯一负责维护三维城市模型“资源声明”的二级模块。它校验模型目录、按稳定 ID 检索模型，并提供杭州建筑白模的默认目录。它输出的是引擎无关的 3D Tiles 资源描述，供上层交给 `map-engine-adapter` 的具体引擎实现加载。

它不读取 `tileset.json`，不检查文件是否存在，不请求网络，不创建 Cesium 对象，不加载或渲染 3D 模型，不做高度采样、点选、碰撞分析、地图定位或航线规划。资源是否可用只能由未来的引擎实现异步确认；本模块绝不把“目录中已声明”误报为“资源已加载”。

## 对外接口

```ts
interface CityModelRegistration {
  readonly id: string;
  readonly displayName: string;
  readonly tilesetUrl: string;
}

interface CityModelDescriptor extends CityModelRegistration {
  readonly format: "3d-tiles";
}

CityModelCatalog.create(input: unknown): CityModelCatalogResult<CityModelCatalogInstance>;
CityModelCatalog.createHangzhou(): CityModelCatalogInstance;

catalog.list(): readonly CityModelDescriptor[];
catalog.resolve(id: unknown): CityModelCatalogResult<CityModelDescriptor>;
```

`create` 是唯一接受外部目录的入口。成功时创建不可变实例；实例持有自身私有的冻结副本，`list` 和 `resolve` 每次都返回新的冻结值，因此调用者无法以对象引用、数组变异或类型断言影响之后的查询。`createHangzhou` 返回一个只包含杭州建筑白模的等价目录：ID 为 `hangzhou-white-model`，显示名称为 `杭州建筑白模`，资源 URL 为 `/hangzhou-3dtiles/tileset.json`。

## 输入规则

目录输入必须是非空数组，最多 32 项；每项必须是可读取对象，且只读取 `id`、`displayName`、`tilesetUrl` 各一次。ID 为 1 至 64 个 Unicode 码点的 ASCII 小写字母、数字和连字符，不能以连字符开头或结尾，且目录内不可重复。显示名称为移除首尾空白后长度 1 至 80 个 Unicode 码点的字符串，不能包含控制字符；输出使用该规范化名称。

`tilesetUrl` 必须是以单个 `/` 开头的本地绝对路径，长度不超过 512 个 Unicode 码点，不能包含空白、控制字符、`?`、`#`、反斜杠、`//` 或路径段 `.`、`..`，并且必须以 `/tileset.json` 结尾。它不是任意远程 URL：禁止协议、主机和查询参数，避免模型目录绕过桌面应用的静态资源边界。

## 查询和错误规则

`resolve` 只接受合法 ID；非法类型、空字符串、超长、包含控制字符或不符合 ID 语法均返回 `INVALID_MODEL_ID`。合法但不在当前目录的 ID 返回 `MODEL_NOT_FOUND`。目录配置问题返回 `INVALID_CATALOG`；详情只使用稳定的 `field` 和 `reason`，不回显用户文本或 getter 异常文字。所有公有函数都不抛出输入引起的异常。

模型按创建时的顺序列出；相同 ID 的解析结果稳定。模型间不得共享可变的 `CityModelDescriptor`、字符串数组或外部输入引用。一个目录被创建后，调用方随后修改输入数组或对象，不得改变目录内容。

## 依赖和验证

模块是纯 TypeScript，不导入 Cesium、3D Tiles SDK、地图引擎、网络、Node、文件系统、DOM、Electron、设置模块、航线模块、任务模块或 UI。它与具体引擎的唯一契约是输出的 `format: "3d-tiles"` 和本地 `tilesetUrl`。

测试仅调用公开接口，覆盖杭州默认目录、自定义目录、顺序、快照隔离、所有输入拒绝、恶意 getter、路径穿越、重复 ID、未知模型、错误保密、架构隔离、类型边界和批量检索性能。语句、分支、函数、行覆盖率及有效变异杀灭率均为 100%。
