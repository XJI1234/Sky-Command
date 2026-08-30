# D3 航线库与预览模块契约

状态：已批准（0.2.3 修订待审阅）  
契约版本：0.2.3  
所属程序：Sky Command 电脑端  
模块标识：`route-library`

> **0.2.3 修订摘要（随电脑端根契约生效）**
>
> - §11 由"地图预览契约"改为"预览模型交接契约"：本模块不再定义 `RouteMapAdapter`、Viewer 生命周期、底图和三维白模，这些属于一级模块 `geo-map`。
> - §17 移除 `MAP_INITIALIZATION_FAILED`、`BASEMAP_LOAD_FAILED`、`CITY_MODEL_LOAD_FAILED` 三个错误码和两个地图警告码，它们属于 `geo-map`。
> - §12 `RouteFilePickerAdapter` 改为经 `app-shell/ipc-bridge` 取得文件，不直接调用 Electron。
> - §18 依赖图改为工作区只经 D3 一级接口调用，不再直接指向二级模块。
> - 全文 `D4` 改为 `mission-control`，`M4` 改为 `wayline-mission`，`D3.6` 引用移除。

## 1. 阅读方法

本文是 D3 一级模块的使用说明书，也是实现和测试的唯一验收依据。

调用方只需要理解本文定义的公开接口、数据、状态、不变量和错误，不应依赖模块内部文件、解析步骤、Cesium 对象或 ZIP/XML 库的行为。

在本文被明确批准前，不得编写模块实现。在 D3 的每个二级模块开始实现前，还必须在对应二级模块目录中创建独立的 `CONTRACT.md` 并完成审阅。

## 2. 模块目的

D3 负责接收 Wayline 项目导出的 KML/KMZ 文件，将它们保存为当前桌面会话中的航线资产，提取可预览的航点数据，管理多条航线及当前选择，并向三维地图提供与地图引擎无关的预览模型。

D3 解决以下业务问题：

1. 用户可以导入一条或多条 Wayline 航线。
2. 用户可以清楚地区分“只能预览”和“可以提交手机进一步校验”的文件。
3. 用户可以在航线列表中选择、定位和删除航线。
4. 地图在任何时刻只显示当前选中的航线。
5. 飞行任务模块能够取得未经修改的原始 KMZ 字节，并发送给指定 Android relay。

## 3. 模块明确不负责的内容

D3 不负责：

- 在电脑端规划、绘制或编辑航线。
- 修改航点、速度、高度、动作、云台或相机参数。
- 从航点重新生成 KML、KMZ 或 WPML。
- 判断某架飞机是否支持 Waypoint Mission。
- 使用 DJI WPMZManager 完成最终任务合法性校验。
- 把文件发送到手机或飞机。
- 上传、开始、暂停、继续或停止飞行任务。
- 保存飞机任务状态。
- 自动返航、起飞、降落或人工操纵飞机。

这些职责分别属于 Wayline 项目、电脑端一级模块 `mission-control`（航线任务调度）、`route-planning`（航点规划）和手机端一级模块 `wayline-mission`（航线任务执行）。

## 4. 术语

### 4.1 航线文件 RouteFile

用户选中的原始文件，由文件名和完整字节组成。模块不得修改调用方传入的字节。

### 4.2 航线资产 RouteAsset

成功导入后存放在航线库中的对象，包含内部 ID、摘要、分类、解析结果和原始文件副本。

### 4.3 航点 RouteWaypoint

用于预览的 WGS84 坐标：经度、纬度和文件提供的高度。高度只代表文件中的数值；D3 不把它解释为相对地面高度、椭球高或海拔高，也不进行高度基准转换。

### 4.4 预览航线 Preview-only Route

可以从文件中提取至少两个有效航点，但不能由 D3 提交给飞行任务模块上传。

所有 KML 都属于这一分类。缺少 `waylines.wpml`，或 `waylines.wpml` 缺少同目录 `template.kml`，但仍能提取航点的 KMZ 也属于这一分类。

### 4.5 可上传候选 Upload Candidate

满足以下桌面侧条件的 KMZ：

- ZIP 容器安全且可读取；
- 包含可识别的 `waylines.wpml` 和同目录 `template.kml`；
- 能提取至少两个有效航点；
- 文件大小、条目数和解压大小未超过限制。

“可上传候选”不等于“可执行航线”。最终是否可执行只能由手机端 DJI WPMZ 校验、飞机 capability、固件状态和 MSDK 上传结果共同决定。

### 4.6 当前航线 Selected Route

当前被用户选中并显示在地图上的唯一航线。航线库为空时当前航线为 `null`。

### 4.7 任务载荷 MissionPayload

D3 向 `mission-control` 提供的只读对象，包含航线 ID、经过安全化的文件名、文件大小、SHA-256 和原始 KMZ 字节副本。

## 5. 一级模块公开接口

公开接口使用以下概念形式描述；具体 TypeScript 命名必须保持语义一致，不得扩大职责。

```text
RouteLibrary.create(config) -> RouteLibrary

RouteLibrary.importFile(input) -> Promise<ImportRouteResult>
RouteLibrary.list() -> RouteSummary[]
RouteLibrary.get(routeId) -> RouteDetail
RouteLibrary.getSelected() -> RouteDetail | null
RouteLibrary.select(routeId) -> RouteSelection
RouteLibrary.remove(routeId) -> RouteSelection
RouteLibrary.getPreview(routeId) -> RoutePreview
RouteLibrary.getMissionPayload(routeId) -> MissionPayload
RouteLibrary.clear() -> void
```

除上述接口外，调用方不得直接调用任何二级模块。

## 6. 配置契约

```text
RouteLibraryConfig {
  maxFileBytes: number = 104857600
  maxArchiveEntries: number = 1000
  maxExpandedBytes: number = 209715200
  maxWaypoints: number = 100000
}
```

规则：

- 配置在 `create` 时验证并固定，实例运行期间不可修改。
- 所有限制必须为正整数。
- `maxExpandedBytes` 不得小于 `maxFileBytes`。
- 非法配置导致创建失败，错误码为 `INVALID_CONFIGURATION`。
- 默认最大文件大小为 100 MiB，与电脑到手机的航线传输限制一致。

## 7. 输入契约

```text
ImportRouteInput {
  fileName: string
  bytes: Uint8Array
}
```

输入规则：

- `fileName` 必须非空，并且去除首尾空白后仍有内容。
- 只接受 `.kml` 和 `.kmz`，扩展名不区分大小写。
- 文件名可能包含中文、空格、括号和 Unicode 字符。
- 文件名不得包含路径层级、绝对路径、盘符、NUL 或控制字符。
- `bytes` 必须非空且不得超过 `maxFileBytes`。
- 模块在开始异步解析前必须复制字节；调用方之后修改原数组不得影响航线库。
- 文件格式以扩展名和实际内容共同判断，不能只相信扩展名。

## 8. 输出数据契约

### 8.1 RouteSummary

```text
RouteSummary {
  routeId: string
  displayName: string
  format: "kml" | "kmz"
  classification: "preview-only" | "upload-candidate"
  waypointCount: number
  sha256: string
  sizeBytes: number
  importedAt: ISO-8601 UTC string
}
```

`list()` 只返回摘要，不返回原始字节或可变内部对象。

### 8.2 RouteDetail

```text
RouteDetail extends RouteSummary {
  sourceDocument: string
  waypoints: readonly RouteWaypoint[]
  warnings: readonly RouteWarning[]
}
```

返回的对象和数组必须不可变，或者是不会影响内部状态的深拷贝。

### 8.3 RouteWaypoint

```text
RouteWaypoint {
  longitude: number
  latitude: number
  altitude: number | null
  sequence: integer
}
```

规则：

- 经度必须在 `[-180, 180]`。
- 纬度必须在 `[-90, 90]`。
- 高度缺失时为 `null`，不得擅自补成零。
- `sequence` 从 0 开始连续递增。
- NaN、Infinity 和无法解析的数字均为非法值。

### 8.4 RoutePreview

```text
RoutePreview {
  routeId: string
  polyline: readonly GeoPoint3D[]
  startMarker: GeoPoint3D
  endMarker: GeoPoint3D
  cameraBounds: GeoBounds3D
}
```

该对象不得包含任何 Cesium、DOM、Vue 或 Electron 类型。

### 8.5 MissionPayload

```text
MissionPayload {
  routeId: string
  fileName: string
  sizeBytes: number
  sha256: string
  bytes: Uint8Array
}
```

规则：

- 只有 `upload-candidate` 可以取得任务载荷。
- 返回的 `bytes` 必须是独立副本。
- `fileName` 必须是安全的 basename，并以 `.kmz` 结尾。
- `sha256` 必须针对返回字节计算。
- 对 `preview-only` 调用时返回 `ROUTE_NOT_UPLOADABLE`。

## 9. 导入行为契约

### 9.1 KML

导入 KML 时必须：

1. 使用不解析外部实体、不访问网络和本地文件的 XML 解析器。
2. 优先读取 `LineString/coordinates`。
3. 没有 LineString 时，按文档顺序读取包含坐标的 Placemark。
4. 保留航点原始顺序。
5. 忽略与航线无关的样式、图标和说明文本。
6. 成功时分类始终为 `preview-only`。

### 9.2 KMZ

导入 KMZ 时必须：

1. 验证 ZIP 结构、条目数和总解压大小。
2. 拒绝加密归档和不安全路径。
3. 查找 `waylines.wpml`，优先使用 `wpmz/waylines.wpml`。
4. 如果没有 WPML，再查找 `template.kml` 或其他 KML 作为预览来源。
5. `waylines.wpml` 可安全解析、存在同目录 `template.kml` 且包含至少两个有效航点时，分类为 `upload-candidate`；这仍不代表通过 DJI WPMZ 校验。
6. 不存在 WPML但存在有效预览航迹时分类为 `preview-only`，并产生 `WPML_MISSING` 警告；WPML 缺少同目录模板时同样为 `preview-only`，并产生 `DJI_TEMPLATE_MISSING` 警告。
7. 归档检查和内容解析必须在内存中完成，不得把 ZIP 条目解压到任何磁盘目录。

### 9.3 航点数量

- 少于 2 个有效航点时导入失败。
- 超过 `maxWaypoints` 时导入失败。
- 非法航点不得静默删除后继续成功，除非全部坐标记录中只有空白记录。
- 错误必须指出第一个非法航点的位置和原始值摘要，但不得输出整个文件内容。

### 9.4 重复导入

- SHA-256 相同的文件视为同一份航线内容。
- 重复导入不创建新条目，而是返回已有条目并把它设为当前航线。
- `ImportRouteResult.duplicate` 为 `true`。
- 文件名相同但内容不同的文件必须作为两条不同航线保存。

### 9.5 导入成功后的选择

- 首次导入后自动选中该航线。
- 后续成功导入后自动选中新导入或已去重的航线。
- 导入失败不得改变目录和当前选择。

## 10. 目录和选择行为契约

- `list()` 按首次成功导入时间升序返回。
- `select(routeId)` 只允许选择存在的航线。
- 选择成功后，`getSelected()` 与 `getPreview(routeId)` 必须指向同一航线。
- 删除非当前航线不改变当前选择。
- 删除当前航线后，优先选择删除位置后面的航线；没有后项时选择前一项；目录为空时选择 `null`。
- `clear()` 删除当前会话中的所有航线并把选择设为 `null`。
- 删除或清空只影响电脑内存中的航线库，不得向手机或飞机发送删除命令。
- 航线目录在本契约版本中只存在于当前桌面会话；应用重启后为空。

## 11. 与地图的交接契约

地图渲染不属于本模块。三维地图引擎、底图、三维白模和图层生命周期全部属于一级模块 `geo-map`，其契约见电脑端根契约 §2.2。

本节只定义本模块**交给** `geo-map` 的东西，以及本模块自己必须保证的预览侧规则。

### 11.1 交接方式

本模块通过一级公开接口 `getPreview(routeId)` 产出 `RoutePreview`，由 `route-workspace` 交给 `geo-map` 的公开接口显示。

交接约束：

- `RoutePreview` 必须与地图引擎无关：不含 Cesium 类型、图元对象、Viewer 引用或瓦片地址；
- 本模块不引用 `geo-map`，不知道地图引擎存在，也不定义地图适配器接口；
- `geo-map` 不得反向读取航线库内部状态，只接受传入的 `RoutePreview`；
- 地图初始化或渲染失败不得改变航线库状态。地图不可用时航线库仍必须可导入、可选择、可交出任务载荷。

### 11.2 本模块保证的预览侧规则

以下规则由本模块负责，因为它们是航线业务规则，删掉地图后依然成立：

- `getPreview` 在任意时刻只描述一条航线，与 `route-catalog` 的当前选择一致；
- 预览包含完整航点序列，并标明起点和终点；
- 高度存在时原样使用文件高度；高度为 `null` 时在 `RoutePreview` 中显式表示"无高度"，不得填入猜测值，也不得回写领域数据；
- 定位所需的边界范围由本模块计算并随预览提供，不由地图反推。

### 11.3 明确属于 `geo-map` 的规则

以下规则不在本契约内，仅列出以避免重复定义：Viewer 生命周期与资源释放、底图选择与降级、三维白模加载与失败处理、图层清理、视野动画。本模块不得对这些行为作出承诺。

## 12. 工作区交互契约

航线工作区负责组合文件选择、航线库一级接口和 `geo-map` 的公开地图接口。按根契约 §2.4，它属于工作区层，是本模块唯一位于系统边缘的部分。

`route-workspace` 对外是一个完整的航线工作区 Adapter，其内部允许存在以下 seam，但不得把它们升级为 D3 外部可见接口：

```text
RouteWorkspaceController   把用户意图编排为 D3 一级接口调用
RouteWorkspaceView         只负责 Vue 渲染和用户事件
RouteFilePickerPort        把已选择的文件名和字节转换为 ImportRouteInput
```

`RouteFilePickerPort` 只接收"文件名 + 字节"这一种输入。它**不得**调用 Electron 对话框 API、不得访问 `dialog`、`app`、`process` 或任何 Node 文件系统 API。系统文件选择对话框由 `app-shell/ipc-bridge` 显式暴露的方法提供，本模块只消费其结果。这条约束来自根契约 §2.3"除 `app-shell` 以外的任何模块不得依赖 Electron 全局对象"和"渲染进程代码只能经过 `ipc-bridge`"。

工作区不得实现去重、分类、坐标验证、删除后选择或任务载荷规则。这些行为只能由 D3 一级接口返回结果驱动。工作区调用 `geo-map` 时只传入 D3 一级接口返回的 `RoutePreview`，不得自行构造或修改预览数据。

用户可见行为：

- 点击“导入 KML/KMZ”后打开系统文件选择器。
- 用户取消选择属于正常结果，不显示错误，不改变状态。
- 导入期间阻止重复提交，并显示进行中状态。
- 导入成功后显示文件名、航点数和分类。
- 右侧选择框只显示一个当前值，展开后显示全部航线。
- 选择航线后立即只显示该航线。
- 点击定位按钮后定位到当前航线。
- 删除操作必须明确针对当前航线；删除后地图和选择同步更新。
- 所有失败必须显示可理解的中文信息，同时保留稳定错误码用于日志和测试。

## 13. 状态与原子性

模块只存在两种顶层状态：

```text
EMPTY: routes = [], selectedRouteId = null
READY: routes.length > 0, selectedRouteId 指向存在的航线
```

不允许出现以下中间状态：

- 有航线但 `selectedRouteId` 为 null。
- `selectedRouteId` 指向不存在的航线。
- 导入失败后留下半条航线。
- 摘要、详情、预览和任务载荷使用不同的 SHA-256。
- 地图显示的航线与当前选择不一致。

每次导入、选择、删除和清空必须是原子操作。调用成功时状态整体更新；调用失败时状态完全保持不变。

## 14. 并发和取消

- 航线库必须串行提交状态变更，保证导入顺序确定。
- 工作区默认同一时间只允许一个导入操作。
- 如果将来允许并发解析，最终提交顺序仍按用户发起顺序确定。
- 用户关闭页面或应用时，尚未提交的解析可以取消。
- 取消不得产生航线条目，也不得报告为系统错误。
- 地图 `focus` 请求可以被更新的选择或新的 `focus` 请求取消。

## 15. 性能和资源限制

- 不得在渲染线程同步解析大型 KMZ 或计算大型 SHA-256。
- 小于 1 MiB 的文件可以直接异步解析；更大的文件应使用 worker 或等价的非阻塞实现。
- 导入过程中内存峰值应受到 `maxFileBytes` 和 `maxExpandedBytes` 约束。
- 航点渲染可以在地图适配器内部做仅用于显示的抽稀，但原始 RouteDetail 和任务字节不得改变。
- 列表、选择和删除操作应在普通航线数量下立即完成，不进行磁盘或网络访问。

## 16. 安全契约

- XML 解析不得启用外部实体、DTD 网络加载或脚本执行。
- ZIP 条目路径经过规范化后不得逃出虚拟归档根目录。
- 拒绝绝对路径、盘符、`..` 路径穿越和 NUL 字符。
- 不信任文件扩展名、MIME、XML 标签内容或 ZIP 元数据。
- 不把天地图 Key、文件完整内容或潜在敏感路径写入错误信息。
- 原始航线字节只通过 `getMissionPayload` 暴露给 `mission-control`。
- D3 不直接访问 Android relay、DJI MSDK 或飞机。

## 17. 错误契约

所有失败使用统一结构：

```text
RouteLibraryError {
  code: RouteErrorCode
  message: string
  recoverable: boolean
  details?: read-only structured data
}
```

稳定错误码：

| 错误码 | 含义 | 可恢复 |
|---|---|---|
| `INVALID_CONFIGURATION` | 模块配置非法 | 否 |
| `INVALID_FILE_NAME` | 文件名为空或包含不安全路径 | 是 |
| `UNSUPPORTED_FORMAT` | 不是 KML/KMZ | 是 |
| `EMPTY_FILE` | 文件没有内容 | 是 |
| `FILE_TOO_LARGE` | 原始文件超过限制 | 是 |
| `FORMAT_MISMATCH` | 扩展名与实际内容冲突 | 是 |
| `INVALID_XML` | KML/WPML 不是可解析 XML | 是 |
| `EXTERNAL_ENTITY_FORBIDDEN` | XML 请求外部实体或 DTD | 是 |
| `CORRUPT_KMZ` | ZIP 结构损坏 | 是 |
| `ENCRYPTED_KMZ` | KMZ 已加密 | 是 |
| `ARCHIVE_ENTRY_LIMIT` | ZIP 条目数超过限制 | 是 |
| `ARCHIVE_EXPANSION_LIMIT` | 解压后总大小超过限制 | 是 |
| `UNSAFE_ARCHIVE_PATH` | ZIP 包含不安全路径 | 是 |
| `ROUTE_DOCUMENT_MISSING` | 找不到 KML/WPML 航迹文档 | 是 |
| `INSUFFICIENT_WAYPOINTS` | 有效航点少于两个 | 是 |
| `INVALID_COORDINATE` | 坐标缺失、越界或非有限数 | 是 |
| `TOO_MANY_WAYPOINTS` | 航点超过限制 | 是 |
| `DOMAIN_INVARIANT_VIOLATION` | 内部调用方提供了不满足领域不变量的数据 | 否 |
| `ROUTE_NOT_FOUND` | routeId 不存在 | 是 |
| `ROUTE_NOT_UPLOADABLE` | 预览航线被请求为任务载荷 | 是 |

本表是封闭集合。地图相关错误（引擎初始化失败、底图不可用、三维白模加载失败）不属于本模块，由 `geo-map` 定义并归它自己的错误集合，不得出现在 `RouteLibraryError` 中。

警告不是失败。本模块只定义以下警告：

- `route-domain` `RouteWarningCode.WPML_MISSING`：KMZ 可以预览但不能作为上传候选。
- `route-domain` `RouteWarningCode.DJI_TEMPLATE_MISSING`：KMZ 含有 WPML，但缺少与其同目录的 DJI `template.kml`，可以预览但不能作为上传候选。
- `route-domain` `RouteWarningCode.ALTITUDE_MISSING`：部分或全部航点没有高度。

地图侧警告（当前使用备用底图、三维白模不可用）由 `geo-map` 定义，本模块不产生也不转发。

## 18. 二级模块及依赖方向

> **契约变更记录（随根契约 v1.0 生效）**
>
> 电脑端总契约 [`../../../CONTRACT.md`](../../../CONTRACT.md) 生效后，本模块有两处调整：
>
> 1. **`map-adapter` 移出本模块，提升为一级模块 `geo-map`。** 原因是它出现了第二个真实调用方（`route-planning` 需要在同一张地图上交互），满足本文第 18 节"存在不止一个真实调用方"的提升条件。本模块只负责产出与引擎无关的 `RoutePreview`，由 `geo-map` 渲染。原 D3.6 的职责说明整体迁移到 `geo-map` 契约，本文不再定义它。
> 2. **编号将改为语义名。** `route-library` 的规范名称已在根契约中固定；`D3.x` 编号是过渡写法，后续修订会逐个替换为语义名（`route-domain`、`route-importer`、`route-qualification`、`route-catalog`、`preview-model`、`route-workspace`）。在替换完成前，`D3.x` 与语义名指同一个模块，不得据此创建两套实现。
>
> 本节以下内容已按第 1 条更新。

```text
D3.1 route-domain
   ↑
   ├── D3.2 route-importer
   ├── D3.3 route-qualification
   ├── D3.4 route-catalog
   └── D3.5 preview-model
             ↓
   D3 一级实现（编排节点，见 §19"D3 一级实现的编排职责"）
             ↓
       D3.7 route-workspace
             ↓
       一级模块 geo-map（消费 RoutePreview）
```

图中的箭头方向就是允许的调用方向，不允许跳级。

- D3.2 至 D3.5 只被 **D3 一级实现**调用。它们互相之间不直接调用，也不被 D3.7 调用。
- **D3.7 只调用 D3 一级公开接口**（§5 列出的那些），不得直接调用 D3.2 至 D3.5 中的任何一个。这与 §5"除上述接口外，调用方不得直接调用任何二级模块"、§12"把用户意图编排为 D3 一级接口调用"和 §23"一级公开接口是调用方和测试的唯一 seam"是同一条规则的三种说法。
- D3 一级实现本身不是二级模块，它是编排层，只负责按固定顺序调用二级模块，不含自己的业务规则。

`preview-model` 产出的 `RoutePreview` 由一级模块 `geo-map` 消费。本模块内部不引用 `geo-map`，也不知道地图引擎存在；只有 D3.7 作为工作区层，把从 D3 一级接口取得的 `RoutePreview` 交给 `geo-map`。这一分层规则见电脑端总契约 §2.4"核心层与工作区层"。

依赖规则：

- D3.1 至 D3.5 不得导入 Vue、Electron、DOM 或 Cesium。
- D3.1 不得依赖其他 D3 二级模块。
- D3.2 通过一个深接口隐藏文件接收、格式探测、SHA-256、KML 解析和 KMZ 安全读取；不得把内部 Parser、Reader 或第三方类型暴露给调用方。
- D3.3 只接收 D3.2 的解析结果和 D3.1 的领域值，负责整份航线的合格性与分类，不直接控制 UI。
- D3.4 不解析文件、不访问磁盘、不控制地图。
- D3.5 不依赖具体地图引擎，也不依赖 `geo-map`。
- 本模块内任何二级模块都不得导入 Cesium、天地图或 3D Tiles；这些只属于一级模块 `geo-map`。
- 只有 D3.7 可以依赖 Vue 和文件选择 Adapter；业务规则不得进入 View、Controller 或文件选择 Adapter。
- `mission-control` 只能通过本模块一级公开接口取得 `MissionPayload`，不得访问 importer 或 catalog。

正式二级模块只保留 D3.1 至 D3.5 和 D3.7。只有同时满足以下条件之一时，才允许在修改本契约后新增正式二级模块：

1. 存在不止一个真实调用方，并且它们需要同一稳定接口。
2. 存在至少两个真实 Adapter，需要在同一个 seam 上替换。
3. 该行为可以通过独立接口完成有业务价值的契约测试，而不是只转发另一个模块调用。

仅仅因为实现文件较长、使用了第三方库或便于分类，不构成新增正式模块的理由。

## 19. 二级模块职责

### D3.1 route-domain

这是 D3 的领域内核，不是只存放 TypeScript 类型的浅模块。它负责通过受控构造接口创建合法、规范化、不可变的领域值。

```text
RouteDomain.createRouteId(raw) -> DomainResult<RouteId>
RouteDomain.createWaypoint(input) -> DomainResult<RouteWaypoint>
RouteDomain.createQualifiedRoute(input) -> DomainResult<QualifiedRoute>
RouteDomain.createRouteAsset(input) -> DomainResult<RouteAsset>
RouteDomain.createError(code, details?) -> RouteLibraryError
```

D3.1 必须保证：

- RouteId 非空、不可变并满足安全格式；ID 的生成与目录唯一性分别由注入的 IdProvider 和 D3.4 保证。
- 经度、纬度和高度满足本文定义的数值规则。
- sequence 从零开始且只能是非负整数；整条航线的连续性由 D3.3 检查。
- RouteAsset 的摘要、分类、警告和航点集合不可变。
- 错误码属于契约定义的封闭集合。
- 调用方不能通过对象字面量或类型断言绕过构造过程制造非法领域对象。

D3.1 不解析文件、不管理集合、不访问时间、随机数、磁盘、网络或 UI。需要生成 ID 或时间时由上层注入原始值，再由 D3.1 验证和封装。

### D3 一级实现的编排职责

D3 一级实现负责组合二级模块，但这不是新的二级模块。`importFile` 必须按照以下顺序执行：

```text
1. D3.2 ingest：复制并安全解析文件；`parsed` 时得到 ParsedRouteDocument 和 SHA-256，`rejected` 或 `cancelled` 时停止
2. D3.4 duplicate lookup：相同 SHA-256 已存在时只选中已有航线并返回
3. D3.3 qualify：验证整份文档并确定分类，得到 QualifiedRoute
4. 注入的 IdProvider 和 Clock 产生原始 ID 与 importedAt
5. D3.1 RouteId/RouteAsset 构造器验证并创建不可变 RouteAsset
6. D3.4 add：原子加入目录并选中新航线
7. D3.5 在调用 getPreview 时按 RouteDetail 生成 RoutePreview
```

任一步骤失败都不得执行后续步骤，并且 D3.4 状态保持不变。`IdProvider` 和 `Clock` 是 D3 一级实现接受的测试依赖，不属于新的业务模块，也不得被公开接口调用方直接操作。

### D3.2 route-importer

把不可信的 KML/KMZ 字节安全转换为结构化的中间文档，并计算文件摘要。它不决定目录状态，也不直接创建最终 RouteAsset。

对外深接口只有：

```text
RouteImporter.ingest(fileName, bytes, limits, cancellation?) -> Promise<RouteIngestOutcome>

RouteIngestOutcome =
  | { status: "parsed", document: ParsedRouteDocument }
  | { status: "rejected", error: RouteLibraryError }
  | { status: "cancelled" }
```

`cancelled` 是正常结果，不是文件或系统错误。D3 一级编排收到它时不得继续去重、合格性判断或目录提交，也不得向界面报告失败。取消参数使用只有只读 `aborted` 字段的最小结构，不把 DOM `AbortSignal` 类型泄漏到核心模块。

D3.2 内部可以使用以下 seam：

```text
FileIntake          复制字节、清理文件名、格式探测、大小限制和 SHA-256
KmlDocumentParser   安全解析 KML/XML 并输出原始航点记录
KmzArchiveReader    安全检查 ZIP，并选择 WPML/KML 文档交给解析器
```

这些 seam 只属于 D3.2 的实现和内部测试。D3.2 以外的代码不得导入它们。Hash、ZIP 和 XML 第三方类型不得出现在 `ParsedRouteDocument` 中。

### D3.3 route-qualification

负责判断一整份解析文档是否具备成为航线资产的资格，并决定它是 `preview-only` 还是 `upload-candidate`。

```text
RouteQualification.qualify(parsedDocument, limits) -> QualifiedRoute
```

D3.3 负责：

- 使用 D3.1 构造并验证每个 RouteWaypoint。
- 检查航点数量、sequence 连续性和整条航线结构。
- 根据源格式、WPML 与同目录模板存在性和解析结果确定分类。
- 生成 `WPML_MISSING`、`DJI_TEMPLATE_MISSING`、`ALTITUDE_MISSING` 等领域警告。
- 失败时返回稳定错误，不产生部分 QualifiedRoute。

D3.3 不读取 ZIP/XML，不计算摘要，不决定 routeId，不管理目录，不访问地图或 UI。

### D3.4 route-catalog

实现去重、顺序、选择、删除和原子状态变更。它只处理 D3.3 已经判定合格并经 D3.1 构造的领域对象。它必须把复杂的选择修复规则隐藏在自己的接口后面。

### D3.5 preview-model

从 RouteDetail 生成与地图引擎无关的折线、起终点标记和相机范围。它可以包含纯几何算法，但不得包含 Cesium 类型、地图网络请求或 UI 状态。

### D3.7 route-workspace

组合文件选择、导入反馈和航线选择。它是位于系统边缘的 Adapter，允许实现较薄，但不得包含解析、校验、去重、分类、目录选择修复或任务载荷规则。

它把当前选中航线的 `RoutePreview` 交给一级模块 `geo-map` 显示，自己不创建 Viewer、不装载底图、不引用 Cesium。地图交互（定位、图层生命周期、底图回退）全部属于 `geo-map`。

## 20. 测试契约

### 20.1 测试层级

1. 每个二级模块通过自己的公开接口进行单元和契约测试。
2. D3 一级模块通过一级公开接口进行集成测试。
3. D3.2 的 KML/KMZ 内部 Adapter 通过 D3.2 深接口进行合约测试；不得要求一级测试导入内部 seam。
4. 地图适配器使用 Adapter 合约测试和真实浏览器视觉测试，并覆盖每个内部故障域。
5. 航线工作区使用用户行为测试，不测试 Vue 内部实现细节，也不复制领域规则测试。

### 20.2 必测输入类别

- 标准 KML LineString。
- 多个 Placemark。
- WPML 不同高度标签。
- UTF-8、BOM、中文文件名和大小写扩展名。
- 标准 `wpmz/waylines.wpml` KMZ。
- WPML 位于可接受的嵌套路径。
- 只有 template.kml 的预览 KMZ。
- 空文件、伪装扩展名、损坏 ZIP、无 XML、无航点。
- 加密 ZIP、ZIP bomb、超多条目和路径穿越。
- 经度/纬度边界值、越界值、NaN、Infinity、空高度和负高度。
- 1 个、2 个、最大数量和超过最大数量的航点。
- 相同内容重复导入。
- 同名不同内容导入。
- 选择存在或不存在的 routeId。
- 删除当前、之前、之后、最后一条和不存在的航线。
- 调用 `getMissionPayload` 处理 KML、预览 KMZ 和上传候选 KMZ。
- 调用方修改输入和输出字节、数组、对象的情况。
- 并发导入、取消导入和解析失败时的原子性。
- 主底图失败、备用底图失败、三维白模失败和地图销毁。

### 20.3 属性和模糊测试

- 随机合法坐标始终可以往返领域验证。
- 任意非有限数字始终被拒绝。
- 任意导入序列后，目录始终满足选择不变量。
- 任意删除序列后，不存在悬空 selectedRouteId。
- 任意输入字节不得导致工作区外文件写入。
- 解析器面对随机无效字节不得崩溃进程或无限运行。

### 20.4 覆盖要求

- D3.1 至 D3.5 要求 100% 分支覆盖，并通过属性测试。
- 所有稳定错误码至少有一个直接测试。
- 每条不变量至少有一个正向和一个反向测试。
- 地图渲染与降级路径的覆盖要求属于 `geo-map` 契约，本文不重复规定。本文只要求 `RoutePreview` 的产出在高度缺失、单条、多条和最大航点数场景下都有测试。
- D3.7 必须覆盖用户取消、忙碌、防重复提交、成功、失败、切换、定位和删除流程。
- 每次缺陷修复必须先增加能够复现该缺陷的回归测试。

## 21. 一级验收场景

### 场景 A：导入 KML 预览

导入合法 KML后，航线自动选中、地图显示航迹，分类为 `preview-only`；请求任务载荷明确失败且目录状态不变。

### 场景 B：导入完整 KMZ

导入包含 `waylines.wpml` 的合法 KMZ后，分类为 `upload-candidate`；任务载荷与原文件 SHA-256 一致，但界面不得声称飞机一定能执行。

### 场景 C：多航线管理

连续导入至少三条不同航线，可以自然切换；地图只显示当前航线；定位按钮覆盖完整航迹；删除当前航线后自动选择契约规定的相邻航线。

### 场景 D：失败隔离

已有合法航线时导入损坏 KMZ，错误清楚可见，原有航线、选择和地图保持不变。

### 场景 E：地图降级

天地图或杭州白模不可用时，航线数据不丢失；可用备用底图时继续显示航线，不可用时显示明确地图错误但航线目录仍可操作。

### 场景 F：与任务模块交接

`mission-control` 只能为 `upload-candidate` 取得 MissionPayload；取得的文件名、大小、摘要和字节一致，且修改返回字节不影响 D3 内部副本。

## 22. 可维护性要求

- 一级公开接口是调用方和测试的唯一 seam。
- 不为只有一个实现且没有变化需求的依赖创建多余 Adapter。
- 第三方库只允许存在于负责它的二级模块内部。
- 任何接口变更必须先修改契约并说明兼容性影响。
- 错误码在契约版本内稳定，不得通过解析中文消息判断错误类型。
- 不允许把临时调试开关、测试后门或真实地图 Key 提交到实现。
- 不允许保留绕过 D3 的旧航线解析或目录路径。

## 23. 完成定义

D3 只有同时满足以下条件才算完成：

- 本契约和全部二级契约已批准。
- 所有二级模块只通过规定接口协作。
- 所有契约测试、属性测试、集成测试和视觉测试通过。
- D3.1 至 D3.5 达到规定分支覆盖率。
- 没有 Vue、Electron、Cesium 依赖泄漏到核心模块。
- KML 不能取得任务载荷。
- KMZ 不会在桌面端被错误宣称为已通过 DJI 执行校验。
- 多航线选择与地图显示始终一致。
- 失败不会破坏已有状态。
- `mission-control` 可以只通过 D3 一级接口取得安全、不可变的任务载荷。
- 旧实现中绕过新契约的航线代码已被删除或完全停止使用。

## 24. 已批准业务决策

以下业务决策已于 2026-08-09 获得批准；修改时必须先更新契约版本并重新审阅：

1. 航线库在本版本中只保留当前桌面会话，重启后需要重新导入。
2. 相同 SHA-256 的文件重复导入时去重并选中已有航线。
3. 同名但内容不同的文件允许同时存在。
4. KML 和缺少 WPML 的 KMZ 只允许预览。
5. 电脑端只产生 `upload-candidate`，不使用“已验证可执行”描述。
6. 删除当前航线后优先选择其后相邻航线。
7. 最大原始文件 100 MiB，最大解压数据 200 MiB，最大 100,000 个航点。
8. 航点缺失高度时保存为 null，不擅自填零。
9. 杭州三维白模失败不影响航线库和基础预览能力。
